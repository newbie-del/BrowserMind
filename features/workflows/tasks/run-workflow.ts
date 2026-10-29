import toposort from "toposort"
import { logger, metadata, task, wait } from "@trigger.dev/sdk"
import type { DeserializedJson } from "@trigger.dev/core"
import Browserbase from "@browserbasehq/sdk"
import {
  getSurfacedItemKeys,
  getWorkflow,
  getWorkflowAttachments,
  enqueueWorkflowApplications,
  listWorkflowApplications,
  recordSurfacedItems,
  updateWorkflowApplication,
} from "@/features/workflows/data"
import type { NodeType } from "@/features/workflows/nodes/node-registry"
import {
  runBrowserUseAgent,
  type BrowserAgentAttachment,
  type BrowserUseResult,
} from "@/features/workflows/lib/run-browser-use-agent"
import { runDesktopAgent } from "@/features/workflows/lib/run-desktop-agent"
import type { DesktopAgentResult } from "@/features/workflows/lib/run-desktop-agent"
import {
  explicitlyProhibitsSending,
  extractWorkflowAttachmentContext,
  isDocumentOnlyTask,
} from "@/features/workflows/lib/extract-workflow-attachments"
import {
  directInternshipListingUrl,
  isInternshipApplicationGoal,
} from "@/features/workflows/lib/goal-planner"
import {
  canProcessInternshipApplication,
  MAX_INTERNSHIP_APPLICATIONS,
  parseInternshipQueueLimit,
  processInternshipQueue,
  persistedInternshipOutcome,
  rankInternships,
} from "@/features/workflows/lib/internship-queue"
import { sendEmail } from "@/features/workflows/nodes/send-email"
import {
  verifyShortlist,
  type VerificationSummary,
} from "@/features/workflows/lib/verify-shortlist"
import { renderResultsEmail } from "@/features/workflows/lib/format-results-email"
import { diffAgainstSeen } from "@/features/workflows/lib/workflow-memory"

// One entry per node the run will walk, published to the run's metadata under
// "steps" so the canvas and run console can watch each node move through its
// lifecycle and inspect what it produced.
export type RunStep = {
  nodeId: string
  type: NodeType
  title: string
  status: "pending" | "running" | "done" | "failed"
  durationMs?: number
  output?: unknown
  error?: string
}

// The Trigger.dev task the Run button fires.
export const runWorkflowTask = task({
  id: "run-workflow",

  // A browser run must not silently retry: each retry launches a fresh browser
  // and re-does the same work (that is the "another browser opens" symptom).
  retry: { maxAttempts: 1 },
  // Match the one-hour project limit; the subprocess timeout leaves cleanup
  // time before Trigger.dev terminates the task.
  maxDuration: 3600,

  run: async (
    {
      workflowId,
      orgId,
    }: {
      workflowId: string
      orgId: string
    },
    { signal, ctx }
  ) => {
    const workflow = await getWorkflow(orgId, workflowId)

    if (!workflow?.graph) {
      throw new Error(`Workflow ${workflowId} has no graph`)
    }

    const { nodes, edges } = workflow.graph
    const byId = new Map(nodes.map((n) => [n.id, n]))

    // Run only connected nodes. Orphans on the canvas are skipped.
    const connected = new Set(
      edges.flatMap((edge) => [edge.source, edge.target])
    )

    const order = toposort
      .array(
        nodes.map((node) => node.id),
        edges.map((edge) => [edge.source, edge.target])
      )
      .filter((id) => connected.has(id))

    logger.log(`Running workflow ${workflow.name}`, {
      steps: order.length,
    })

    // Seed every step as pending so the canvas can render the full run.
    const steps: RunStep[] = order.map((nodeId) => {
      const node = byId.get(nodeId)!

      return {
        nodeId,
        type: node.data.type,
        title: node.data.title,
        status: "pending",
      }
    })
    const setStartStatus = (status: RunStep["status"]) => {
      for (const step of steps) {
        if (step.type === "start") step.status = status
      }
    }

    // Trigger metadata expects JSON-compatible values.
    const publishSteps = () =>
      metadata.set(
        "steps",
        steps as unknown as DeserializedJson[]
      )

    publishSteps()

    const localAgentStep = steps.find((step) => step.type === "agent")
    const desktopControlStep = steps.find(
      (step) => step.type === "desktop-control"
    )
    if (localAgentStep && desktopControlStep) {
      throw new Error(
        "A workflow cannot mix cloud browser automation with local Desktop Agent control."
      )
    }
    const taskStep = desktopControlStep ?? localAgentStep
    if (!taskStep) {
      throw new Error(
        "A workflow must contain an Agent or Desktop Agent node for execution."
      )
    }
    if (
      desktopControlStep &&
      steps.some((step) => step.type === "send-email")
    ) {
      throw new Error(
        "Desktop Agent workflows cannot include cloud email actions. Remove the Send Email node."
      )
    }

    const approvalNode = nodes.find((node) => node.data.type === "approval")
    const approvalStep = steps.find((step) => step.type === "approval")
    const approvalPrecedesAgent = Boolean(
      localAgentStep &&
        approvalNode &&
        approvalStep &&
        order.indexOf(approvalNode.id) < order.indexOf(localAgentStep.nodeId)
    )
    const applicationApprovalRequired =
      approvalPrecedesAgent &&
      isInternshipApplicationGoal(workflow.goalText ?? "")
    let approvalOutcome: "approved" | "rejected" | "timed-out" | undefined
    let queuedApplicationCount = 0
    let applicationQueueRows: Awaited<
      ReturnType<typeof listWorkflowApplications>
    > = []
    let applicationsForCurrentBatch: Awaited<
      ReturnType<typeof listWorkflowApplications>
    > = []
    let directApplication:
      | Awaited<ReturnType<typeof listWorkflowApplications>>[number]
      | undefined
    let activeCdpUrl: string | undefined
    const processedApplicationResults: Array<{
      id: string
      company: string
      role: string
      status: string
      url: string
      error?: string
    }> = []

    const requestApproval = async () => {
      if (!approvalNode) return
      const baseApprovalReason =
        approvalNode.data.values.reason?.trim() ||
        "A sensitive action needs your approval before the workflow continues."
      const approvalReason =
        queuedApplicationCount > 0
          ? `Approve processing ${queuedApplicationCount} ranked internship application(s). Blocked or unsupported forms will be skipped; no fees will be paid.`
          : baseApprovalReason
      const token = await wait.createToken({
        timeout: "1h",
        tags: [`workflow:${workflowId}`],
      })
      if (approvalStep) {
        approvalStep.status = "running"
        approvalStep.output = { status: "waiting", reason: approvalReason }
      }
      metadata.set("approval", {
        status: "pending",
        tokenId: token.id,
        reason: approvalReason,
        requestedAt: new Date().toISOString(),
      })
      publishSteps()
      await metadata.flush()

      const outcome = await wait.forToken<{
        approved: boolean
        reason?: string
      }>(token.id)
      const approved = outcome.ok && outcome.output.approved === true
      approvalOutcome = !outcome.ok
        ? "timed-out"
        : approved
          ? "approved"
          : "rejected"
      const decidedReason = outcome.ok
        ? outcome.output.reason
        : "Approval request timed out."

      if (approvalStep) {
        approvalStep.status =
          approvalOutcome === "approved" ? "done" : "failed"
        approvalStep.output = {
          status: approvalOutcome,
          reason: decidedReason ?? null,
        }
        approvalStep.error =
          approvalOutcome === "approved"
            ? undefined
            : `Final action not approved (${approvalOutcome}).`
      }
      metadata.set("approval", {
        status: approvalOutcome,
        reason: decidedReason ?? null,
        decidedAt: new Date().toISOString(),
      })
      publishSteps()
      await metadata.flush()
    }

    setStartStatus("running")
    if (!applicationApprovalRequired) taskStep.status = "running"
    publishSteps()
    await metadata.flush()

    let browserbaseSessionId: string | undefined
    let browserbaseClient: Browserbase | undefined

    try {
      if (applicationApprovalRequired) {
        const directUrl = directInternshipListingUrl(workflow.goalText ?? "")
        if (directUrl) {
          const [candidate] = rankInternships(
            [{ sourceUrl: directUrl }],
            workflow.goalText ?? "",
            1
          )
          await enqueueWorkflowApplications({
            orgId,
            workflowId,
            runId: ctx.run.id,
            items: candidate ? [candidate] : [],
          })
          applicationQueueRows = await listWorkflowApplications(orgId, workflowId)
          directApplication = applicationQueueRows.find(
            (application) => application.applicationKey === candidate?.applicationKey
          )
          if (directApplication?.status === "processing") {
            await updateWorkflowApplication({
              orgId,
              workflowId,
              id: directApplication.id,
              status: "uncertain",
              lastError: "Previous run ended while processing; submission result is unknown, so it will not be retried automatically.",
            })
            directApplication = {
              ...directApplication,
              status: "uncertain",
              lastError: "Previous run ended while processing; submission result is unknown, so it will not be retried automatically.",
            }
          }
          if (
            !directApplication ||
            !(
              directApplication.status === "pending" ||
              (directApplication.status === "failed" &&
                directApplication.attempts < 2)
            )
          ) {
            taskStep.status = "done"
            taskStep.output = {
              skipped: "This listing was already processed or has an uncertain submission. It was not submitted again.",
              application: directApplication ?? null,
            }
            for (const step of steps) {
              if (step.status === "pending") {
                step.status = "done"
                step.output = { skipped: "Duplicate submission protection." }
              }
            }
            setStartStatus("done")
            publishSteps()
            await metadata.flush()
            return {
              steps,
              approval: "not-required" as const,
              email: { status: "not-configured" as const },
            }
          }
          queuedApplicationCount = 1
        }
      } else if (isInternshipApplicationGoal(workflow.goalText ?? "")) {
        applicationQueueRows = await listWorkflowApplications(orgId, workflowId)
        for (const application of applicationQueueRows) {
          if (application.status === "processing") {
            await updateWorkflowApplication({
              orgId,
              workflowId,
              id: application.id,
              status: "uncertain",
              lastError: "Previous run ended while processing; submission result is unknown, so it will not be retried automatically.",
            })
          }
        }
      }

      if (applicationApprovalRequired) {
        await requestApproval()
        if (approvalOutcome !== "approved") {
          taskStep.status = "done"
          taskStep.output = {
            skipped: `Application not submitted — approval ${approvalOutcome}.`,
          }
          for (const step of steps) {
            if (step.status === "pending") {
              step.status = "done"
              step.output = {
                skipped: `Application not submitted — approval ${approvalOutcome}.`,
              }
            }
          }
          setStartStatus("done")
          publishSteps()
          await metadata.flush()
          return {
            steps,
            approval: approvalOutcome,
            email: { status: "not-configured" as const },
          }
        }
        taskStep.status = "running"
        publishSteps()
        await metadata.flush()
        if (directApplication) {
          await updateWorkflowApplication({
            orgId,
            workflowId,
            id: directApplication.id,
            status: "processing",
            runId: ctx.run.id,
            incrementAttempt: true,
          })
        }
      }

      const goal =
        workflow.goalText ??
        nodes
          .filter((node) => node.data.type !== "start")
          .map((node) => {
            const values = Object.entries(node.data.values)
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n")
            return `${node.data.title}\n${values}`
          })
          .join("\n\n")
      const internshipApplicationRequested =
        isInternshipApplicationGoal(goal)
      const emailDraftNode = nodes.find(
        (node) => node.data.type === "send-email"
      )
      const documentTask = emailDraftNode
        ? [
            goal,
            "Current email draft settings from the workflow canvas (use these exact values in the draft; this is not permission to send):",
            `To: ${emailDraftNode.data.values.to ?? ""}`,
            `Subject: ${emailDraftNode.data.values.subject ?? ""}`,
            `Additional email instructions: ${emailDraftNode.data.values.body ?? ""}`,
          ].join("\n\n")
        : goal

      const attachments = desktopControlStep
        ? []
        : await getWorkflowAttachments(orgId, workflowId)
      const documentOnlyTask =
        attachments.length > 0 &&
        !steps.some((step) =>
          ["open-url", "act", "observe"].includes(step.type)
        ) &&
        isDocumentOnlyTask(goal)
      const attachmentContext = internshipApplicationRequested
        ? ""
        : await extractWorkflowAttachmentContext(
            attachments,
            documentTask,
            documentOnlyTask ? "answer" : "context"
          )
      const browserAttachments: BrowserAgentAttachment[] = attachments.map(
        (attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          contentBase64: attachment.contentBase64,
        })
      )
      const agentInstruction = byId.get(taskStep.nodeId)?.data.values.instruction?.trim()
      const task = [
        goal,
        internshipApplicationRequested && agentInstruction
          ? `Browser task instructions:\n${agentInstruction}`
          : "",
        internshipApplicationRequested && !applicationApprovalRequired
          ? "Discovery only: find and rank suitable open internships with direct application URLs. Do not fill or submit applications until BrowserMind reaches its approval step."
          : "",
        internshipApplicationRequested && attachments.length > 0
          ? [
              "Attached application documents are user-provided source files. Use Browser-Use's read_file action on the listed files for facts as needed; do not use OpenAI document extraction. These files may be uploaded only if requested by the approved application form.",
              ...attachments.map(
                (attachment) => `Attached file: ${attachment.filename}`
              ),
            ].join("\n")
          : "",
        emailDraftNode
          ? "IMPORTANT: Do NOT send any email or message yourself, and do NOT open a mail client or navigate to a mailto:/webmail link. BrowserMind sends the results email automatically after you finish — your only job is to gather the information and return the final shortlist/answer as the json block."
          : "",
        attachmentContext
          ? [
              "Reference document context (already read from the files attached to this workflow; do not ask a website or user to upload them again):",
              attachmentContext,
              applicationApprovalRequired
                ? "Use these documents only as factual source material. The approval is limited to submitting this one internship application; do not invent missing information or take any other consequential action."
                : "Use these documents as the primary source for document-based requests. Clearly separate document facts from recommendations and do not invent missing information. Do not send messages, submit forms, or change accounts; provide requested drafts in the run result.",
            ].join("\n\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n\n")

      let result: BrowserUseResult | DesktopAgentResult
      if (desktopControlStep) {
        result = await (async () => {
          const desktopNode = byId.get(desktopControlStep.nodeId)
          const instruction =
            desktopNode?.data.values.instruction?.trim() || goal.trim()
          if (!instruction) {
            throw new Error("The Desktop Agent node needs an instruction.")
          }
          if (
            steps.some(
              (step) => step.type !== "start" && step.type !== "desktop-control"
            )
          ) {
            throw new Error(
              "Desktop Agent workflows currently support only a Start node and one Desktop Agent node."
            )
          }
          if (
            steps.filter((step) => step.type === "desktop-control").length !== 1
          ) {
            throw new Error(
              "A Desktop Agent workflow must contain exactly one Desktop Agent node."
            )
          }
          return runDesktopAgent(instruction)
        })()
      } else if (documentOnlyTask) {
        result = {
          success: true,
          completed: true,
          message: attachmentContext,
          steps: 2,
          urls: [],
          actions: ["Read attached source documents"],
          errors: [],
          data: {
            sourceFiles: attachments.map((attachment) => attachment.filename),
            answer: attachmentContext,
          },
        }
      } else {
        let cdpUrl: string | undefined
        const useBrowserbase =
          process.env.BROWSER_USE_BROWSERBASE === "true"
        if (useBrowserbase && !process.env.BROWSERBASE_API_KEY) {
          throw new Error(
            "BROWSER_USE_BROWSERBASE is enabled but BROWSERBASE_API_KEY is not configured."
          )
        }

        if (useBrowserbase) {
          browserbaseClient = new Browserbase({
            apiKey: process.env.BROWSERBASE_API_KEY,
          })
          const session = await browserbaseClient.sessions.create({
            keepAlive: false,
            api_timeout: 3600,
            browserSettings: { recordSession: true },
            userMetadata: { workflowId, orgId },
          })
          browserbaseSessionId = session.id
          cdpUrl = session.connectUrl
          activeCdpUrl = cdpUrl
          metadata.set("browserbaseSessionId", session.id)

          try {
            const liveUrls = await browserbaseClient.sessions.debug(session.id, {
              expiresIn: 3600,
            })
            metadata.set("liveViewUrl", liveUrls.debuggerFullscreenUrl)
          } catch (error) {
            logger.warn("Could not create Browserbase Live View URL", {
              sessionId: session.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
          await metadata.flush()
        } else {
          logger.log(
            "Using a local browser; Browserbase minutes and session replay are disabled."
          )
        }
        // Light up the browser-phase nodes on the canvas as the agent actually
        // works: map each real browser action to its matching node and advance
        // it running -> done. The Agent node (taskStep) stays running throughout.
        const browserPhaseTypes = new Set<NodeType>([
          "open-url",
          "act",
          "observe",
          "extract",
        ])
        const helperSteps = steps.filter((step) =>
          browserPhaseTypes.has(step.type)
        )
        const actionToType = (action: string): NodeType | null => {
          const a = action.toLowerCase()
          if (/nav|go_to|goto|open|search|url|visit/.test(a)) return "open-url"
          if (/extract|scrape|content|read_page/.test(a)) return "extract"
          if (/click|input|type|select|dropdown|key|press|fill|upload/.test(a))
            return "act"
          if (/find|observe|locate|screenshot/.test(a)) return "observe"
          return null
        }
        result = await runBrowserUseAgent({
          cdpUrl,
          signal,
          task,
          allowFormSubmission:
            applicationApprovalRequired && approvalOutcome === "approved",
          attachments: applicationApprovalRequired ? browserAttachments : [],
          profileKey: workflowId,
          onProgress: ({ action }) => {
            const targetType = actionToType(action)
            if (!targetType) return
            const target = helperSteps.find(
              (step) => step.type === targetType && step.status !== "done"
            )
            if (!target || target.status === "running") return
            let changed = false
            for (const step of helperSteps) {
              if (step === target) {
                step.status = "running"
                changed = true
                break
              }
              if (step.status !== "done") {
                step.status = "done"
                changed = true
              }
            }
            if (changed) {
              publishSteps()
              metadata.flush().catch(() => {})
            }
          },
        })
        for (const step of helperSteps) {
          if (step.status !== "failed") step.status = "done"
        }
      }

      // Dual-agent verification: an independent Checker re-verifies each
      // shortlisted item against the goal's eligibility criteria and can reject
      // the browser agent's choice. Only runs when the agent produced a
      // structured shortlist; a Checker failure leaves items unverified, never
      // crashes the run.
      let verification: VerificationSummary | undefined
      let memoryInfo: { newCount: number; seenCount: number } | undefined
      if (internshipApplicationRequested) {
        if (directApplication) {
          const applicationStatus =
            persistedInternshipOutcome(
              "applicationStatus" in result
                ? result.applicationStatus
                : undefined
            )
          const applicationError =
            "applicationMessage" in result && result.applicationMessage
              ? result.applicationMessage
              : "The browser agent did not report a confirmed application submission."
          await updateWorkflowApplication({
            orgId,
            workflowId,
            id: directApplication.id,
            status: applicationStatus,
            lastError: applicationStatus === "applied" ? null : applicationError,
            runId: ctx.run.id,
          })
          steps.push({
            nodeId: `application-${directApplication.id}`,
            type: "agent",
            title: `${directApplication.company || "Internship"}: ${applicationStatus}`,
            status: applicationStatus === "applied" ? "done" : "failed",
            output: { url: directApplication.sourceUrl },
            error: applicationStatus === "applied" ? undefined : applicationError,
          })
          processedApplicationResults.push({
            id: directApplication.id,
            company: directApplication.company,
            role: directApplication.role,
            status: applicationStatus,
            url: directApplication.sourceUrl,
            ...(applicationStatus === "applied"
              ? {}
              : { error: applicationError }),
          })
        } else if ("shortlist" in result && Array.isArray(result.shortlist)) {
          const ranked = rankInternships(
            result.shortlist,
            [
              goal,
              ...attachments.map((attachment) => attachment.filename),
            ].join(" "),
            parseInternshipQueueLimit(goal)
          )
          await enqueueWorkflowApplications({
            orgId,
            workflowId,
            runId: ctx.run.id,
            items: ranked,
          })
          applicationQueueRows = await listWorkflowApplications(orgId, workflowId)
          applicationsForCurrentBatch = applicationQueueRows
            .filter((application) =>
              canProcessInternshipApplication(
                application.status,
                application.attempts
              )
            )
            .slice(0, parseInternshipQueueLimit(goal))
          queuedApplicationCount = applicationsForCurrentBatch.length
          metadata.set("applicationQueue", {
            discovered: result.shortlist.length,
            unique: ranked.length,
            ready: queuedApplicationCount,
            maxPerRun: MAX_INTERNSHIP_APPLICATIONS,
            limit: parseInternshipQueueLimit(goal),
          })
          await metadata.flush()
        }
      }

      if (
        "shortlist" in result &&
        Array.isArray(result.shortlist) &&
        result.shortlist.length > 0
      ) {
        if (!internshipApplicationRequested) {
          verification = await verifyShortlist({
            goal,
            items: result.shortlist,
            signal,
          })
          result.shortlist = verification.items
          metadata.set("verification", {
            checked: verification.checked,
            passed: verification.passed,
            rejected: verification.rejected,
            ranVerifier: verification.ranVerifier,
            note: verification.note ?? null,
          })
        }

        // Cross-run memory: flag items already surfaced in a previous run and
        // remember the genuinely-new, verified ones so the next run skips them.
        // Best-effort — a memory failure must not fail the whole run.
        try {
          const seenKeys = await getSurfacedItemKeys(orgId, workflowId)
          const memoryDiff = diffAgainstSeen(result.shortlist, seenKeys)
          result.shortlist = memoryDiff.items
          if (memoryDiff.newKeys.length > 0) {
            await recordSurfacedItems({
              orgId,
              workflowId,
              items: memoryDiff.newKeys,
            })
          }
          memoryInfo = {
            newCount: memoryDiff.newCount,
            seenCount: memoryDiff.seenCount,
          }
          metadata.set("memory", memoryInfo)
          await metadata.flush()
        } catch (memoryError) {
          logger.warn("Cross-run memory step failed; continuing without it", {
            error:
              memoryError instanceof Error
                ? memoryError.message
                : String(memoryError),
          })
        }
      }

      // Human-in-the-loop approval: if the workflow has an Approval node, pause
      // the run with a real Trigger.dev waitpoint before the final action and
      // wait for a human to approve or reject it in the console. This genuinely
      // suspends the run (not a prompt) and resumes only when the token is
      // completed by resolveWorkflowApprovalAction (or it times out).
      if (approvalNode && !applicationApprovalRequired) {
        if (internshipApplicationRequested && queuedApplicationCount === 0) {
          if (approvalStep) {
            approvalStep.status = "done"
            approvalStep.output = {
              skipped: "No new internship applications are ready for approval.",
            }
          }
          metadata.set("approval", {
            status: "not-required",
            reason: "No pending applications were discovered.",
            decidedAt: new Date().toISOString(),
          })
          publishSteps()
          await metadata.flush()
        } else {
          await requestApproval()
        }
      }

      if (
        internshipApplicationRequested &&
        !applicationApprovalRequired &&
        approvalOutcome === "approved"
      ) {
        const applicationResults = await processInternshipQueue({
          applications: applicationsForCurrentBatch,
          updateApplication: ({ id, ...update }) =>
            updateWorkflowApplication({
              orgId,
              workflowId,
              id,
              ...update,
              runId: ctx.run.id,
            }),
          runApplication: (application) =>
            runBrowserUseAgent({
              cdpUrl: activeCdpUrl,
              signal,
              task: [
                `Apply to exactly this approved internship listing: ${application.sourceUrl}`,
                `Company: ${application.company}`,
                `Role: ${application.role}`,
                "Use only facts supported by the user's goal and attached documents. Do not invent answers. Read attached files only when needed. Fill and submit this application once, and report applied only after a visible confirmation. Do not pay, bypass CAPTCHA/OTP, or guess credentials. If login, verification, payment, unsupported upload, unknown required information, or any other blocker occurs, stop this listing and report needs_attention. Do not continue to another application within this browser task.",
              ].join("\n"),
              allowFormSubmission: true,
              attachments: browserAttachments,
              profileKey: workflowId,
              onProgress: ({ action }) => {
                metadata.set("currentApplication", {
                  id: application.id,
                  company: application.company,
                  action,
                })
              },
            }),
        })
        processedApplicationResults.push(...applicationResults)
        for (const application of applicationResults) {
          steps.push({
            nodeId: `application-${application.id}`,
            type: "agent",
            title: `${application.company || "Internship"}: ${application.status}`,
            status: application.status === "applied" ? "done" : "failed",
            output: { url: application.url },
            error: application.error,
          })
        }
        metadata.set("applicationResults", processedApplicationResults)
        publishSteps()
        await metadata.flush()
      }

      const finalActionBlocked =
        approvalOutcome !== undefined && approvalOutcome !== "approved"

      // Email only when the workflow actually contains a Send Email node, so
      // the canvas and the behaviour agree: no email node means no email sent.
      const sendingProhibited = explicitlyProhibitsSending(goal)
      const emailNode = sendingProhibited
        ? undefined
        : nodes.find((node) => node.data.type === "send-email")
      const emailStep = sendingProhibited
        ? undefined
        : steps.find((step) => step.type === "send-email")

      let emailError: string | undefined
      let emailId: string | undefined
      let emailTo: string | undefined

      if (emailNode && !finalActionBlocked) {
        emailTo =
          emailNode.data.values.to?.trim() ||
          process.env.WORKFLOW_RESULTS_EMAIL?.trim()
        const subject =
          emailNode.data.values.subject?.trim() || `${workflow.name} results`

        try {
          if (!emailTo) {
            throw new Error(
              "Set a recipient in the Send Email node or WORKFLOW_RESULTS_EMAIL."
            )
          }
          const sent = await sendEmail({
            to: emailTo,
            subject,
            body: renderResultsEmail({
              workflowName: workflow.name,
              result,
              verification,
              memory: memoryInfo,
            }),
          })
          emailId = sent.id
        } catch (error) {
          emailError = error instanceof Error ? error.message : String(error)
          logger.warn("Workflow completed but results email failed", {
            recipient: emailTo,
            error: emailError,
          })
        }
      }

      const producedShortlist =
        "shortlist" in result &&
        Array.isArray(result.shortlist) &&
        result.shortlist.length > 0
      taskStep.status =
        result.success === false && !producedShortlist ? "failed" : "done"
      if (internshipApplicationRequested) {
        const applications = await listWorkflowApplications(orgId, workflowId)
        taskStep.output = {
          ...result,
          applicationResults: processedApplicationResults,
          applications: applications.map((application) => ({
            id: application.id,
            company: application.company,
            role: application.role,
            url: application.sourceUrl,
            matchScore: application.matchScore,
            status: application.status,
            attempts: application.attempts,
            lastError: application.lastError,
            updatedAt: application.updatedAt.toISOString(),
          })),
        }
      } else {
        taskStep.output = result
      }
      taskStep.durationMs = undefined

      for (const step of steps) {
        if (step === emailStep) {
          if (finalActionBlocked) {
            step.status = "done"
            step.output = {
              skipped: `Final action skipped — approval ${approvalOutcome}.`,
            }
          } else {
            step.status = emailError ? "failed" : "done"
            step.error = emailError
            step.output = emailError
              ? { error: emailError }
              : { id: emailId, to: emailTo }
          }
        } else if (step.type === "send-email" && sendingProhibited) {
          step.status = "done"
          step.output = {
            skipped: "The user requested a draft only; no email was sent.",
          }
        } else if (step.status === "pending") {
          step.status = "done"
          step.output = {
            skipped: "Completed by the Browser-Use Agent workflow runner.",
          }
        }
      }

      // Surface the Checker as its own step in the run console (dual-agent).
      if (verification?.ranVerifier) {
        steps.push({
          nodeId: "checker",
          type: "agent",
          title: "Dual-agent verification (Checker)",
          status: "done",
          output: {
            checked: verification.checked,
            verified: verification.passed,
            rejected: verification.rejected,
          },
        })
      }

      setStartStatus("done")
      publishSteps()
      await metadata.flush()

      return {
        steps,
        browserbaseSessionId,
        approval: approvalOutcome ?? ("not-required" as const),
        email: finalActionBlocked
          ? { status: "skipped" as const, reason: `approval ${approvalOutcome}` }
          : emailStep
            ? emailError
              ? { status: "failed" as const, to: emailTo, error: emailError }
              : { status: "sent" as const, to: emailTo, id: emailId }
            : { status: "not-configured" as const },
      }
    } catch (error) {
      setStartStatus("failed")
      taskStep.status = "failed"
      taskStep.error = error instanceof Error ? error.message : String(error)
      publishSteps()
      await metadata.flush()
      throw error
    } finally {
      if (browserbaseClient && browserbaseSessionId) {
        try {
          await browserbaseClient.sessions.update(browserbaseSessionId, {
            status: "REQUEST_RELEASE",
          })
        } catch (error) {
          logger.warn("Could not release Browserbase session", {
            sessionId: browserbaseSessionId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  },
})
