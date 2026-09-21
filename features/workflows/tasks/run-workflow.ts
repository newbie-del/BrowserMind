import toposort from "toposort"
import { logger, metadata, task } from "@trigger.dev/sdk"
import type { DeserializedJson } from "@trigger.dev/core"
import { getWorkflow } from "@/features/workflows/data"
import type { NodeType } from "@/features/workflows/nodes/node-registry"
import { runBrowserUseAgent } from "@/features/workflows/lib/run-browser-use-agent"
import { sendEmail } from "@/features/workflows/nodes/send-email"

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

  run: async ({
    workflowId,
    orgId,
  }: {
    workflowId: string
    orgId: string
  }) => {
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

    // Trigger metadata expects JSON-compatible values.
    const publishSteps = () =>
      metadata.set(
        "steps",
        steps as unknown as DeserializedJson[]
      )

    publishSteps()

    const localAgentStep = steps.find((step) => step.type === "agent")
    if (!localAgentStep) {
      throw new Error("A workflow must contain an Agent node for local execution.")
    }

    for (const step of steps) {
      if (step.type === "start") {
        step.status = "done"
      }
    }
    localAgentStep.status = "running"
    publishSteps()
    await metadata.flush()

    try {
      const task = workflow.goalText ??
        nodes
          .filter((node) => node.data.type !== "start")
          .map((node) => {
            const values = Object.entries(node.data.values)
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n")
            return `${node.data.title}\n${values}`
          })
          .join("\n\n")

      const result = await runBrowserUseAgent({
        task,
      })

      let emailError: string | undefined
      try {
        await sendEmail({
          to: process.env.WORKFLOW_RESULTS_EMAIL ?? "mreverything1823@gmail.com",
          subject: `${workflow.name} results`,
          body: [
            `<h2>${escapeHtml(workflow.name)} results</h2>`,
            `<p>${escapeHtml(result.message ?? "The browser task completed.")}</p>`,
            `<p><strong>Actions:</strong> ${escapeHtml(result.actions.join(", "))}</p>`,
            `<p><strong>Source domains:</strong> ${escapeHtml(result.sourceDomains?.join(", ") || "Not available")}</p>`,
            `<p><strong>Sources visited:</strong> ${escapeHtml(result.urls.join("\n"))}</p>`,
          ]
            .join("")
            .replace(/\n/g, "<br />"),
        })
      } catch (error) {
        emailError = error instanceof Error ? error.message : String(error)
        logger.warn("Workflow completed but results email failed", {
          recipient:
            process.env.WORKFLOW_RESULTS_EMAIL ??
            "mreverything1823@gmail.com",
          error: emailError,
        })
      }

      localAgentStep.status = result.success === false ? "failed" : "done"
      localAgentStep.output = emailError ? { ...result, emailError } : result
      localAgentStep.durationMs = undefined

      for (const step of steps) {
        if (step.status === "pending") {
          step.status = "done"
          step.output = {
            skipped: "Completed by the Browser-Use Agent workflow runner.",
          }
        }
      }

      publishSteps()
      await metadata.flush()

      return { steps, browserbaseSessionId: undefined }
    } catch (error) {
      localAgentStep.status = "failed"
      localAgentStep.error =
        error instanceof Error ? error.message : String(error)
      publishSteps()
      await metadata.flush()
      throw error
    }

  },
})

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character
  )
}