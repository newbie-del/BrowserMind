import type { Edge } from "@xyflow/react"

import type { WorkflowGraph } from "@/lib/db/schema"
import {
  nodeRegistry,
  type NodeType,
  type StepNodeType,
} from "@/features/workflows/nodes/node-registry"

function stepNode({
  id,
  type,
  title,
  values = {},
  position,
}: {
  id: string
  type: NodeType
  title?: string
  values?: Record<string, string>
  position: { x: number; y: number }
}): StepNodeType {
  const definition = nodeRegistry[type]

  return {
    id,
    type: "step",
    position,
    data: {
      type,
      kind: definition.kind,
      title: title ?? definition.label,
      values,
    },
  }
}

function edge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    type: "smoothstep",
    style: { stroke: "var(--border)" },
  }
}

// Goals routinely spell out what NOT to do ("Do not submit forms, apply, or send
// messages"). Those clauses must not trigger form/email steps. A prohibition
// usually reads as a list — "Do not purchase, register, apply, submit forms" —
// where only the first item carries the "do not". So within each sentence, once
// a negation appears, drop that clause and every clause after it in the sentence.
function positiveText(goal: string): string {
  const negation =
    /\b(do not|don'?t|never|must not|mustn'?t|should not|shouldn'?t|avoid)\b/i
  const kept: string[] = []

  for (const sentence of goal.split(/(?<=[.!?])\s+|\n+/)) {
    let negated = false
    for (const clause of sentence.split(/,\s*/)) {
      if (negation.test(clause)) negated = true
      if (!negated) kept.push(clause)
    }
  }

  return kept.join(" ")
}

function intentHints(goal: string) {
  const text = positiveText(goal).toLowerCase()

  return {
    // Real form work: filling/uploading/submitting a form or application.
    involvesForm:
      /\b(fill|upload|attach)\b/.test(text) ||
      /\b(form|application|apply)\b/.test(text) &&
        /\b(fill|upload|submit|complete|register)\b/.test(text),
    // Actually sending an email/message, not merely mentioning one.
    involvesEmail:
      /\b(e-?mail|mail)\b/.test(text) &&
        /\b(send|email|share|deliver|report|forward)\b/.test(text) ||
      /\b(send|share)\b.*\b(report|results?|summary|findings|message)\b/.test(
        text
      ),
    involvesResearch:
      /\b(find|search|research|collect|compare|list|shortlist|gather|opportunit|compan(y|ies)|certificat|job)\b/.test(
        text
      ),
    // A consequential action the user should approve before it happens:
    // payment, a registration fee, a purchase, enrolment. ₹/Rs/INR counts too.
    involvesSensitive:
      /\b(pay|payment|fee|registration|register|purchase|buy|checkout|deposit|enrol|enroll|subscribe|donate)\b/.test(
        text
      ) || /₹|\brs\.?\b|\binr\b/.test(text),
  }
}

function firstUrl(goal: string): string | undefined {
  const match = positiveText(goal).match(
    /\bhttps?:\/\/(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i
  )

  return match?.[0]
}

function explicitlyProhibitsApplication(goal: string): boolean {
  const negation =
    /\b(do not|don'?t|never|must not|mustn'?t|should not|shouldn'?t|avoid)\b/i

  for (const sentence of goal.split(/(?<=[.!?])\s+|\n+/)) {
    let negated = false
    for (const clause of sentence.split(/,\s*/)) {
      const match = negation.exec(clause)
      if (
        match &&
        /\b(apply|submit)\b/i.test(
          clause.slice(match.index + match[0].length)
        )
      ) {
        return true
      }
      if (match) negated = true
      if (negated && /\b(apply|submit)\b/i.test(clause)) return true
    }
  }

  return false
}

export function isInternshipApplicationGoal(goal: string): boolean {
  const text = positiveText(goal)
  return (
    !explicitlyProhibitsApplication(goal) &&
    /\binternships?\b/i.test(text) &&
    /\b(?:apply|application|submit)\b/i.test(text)
  )
}

export function directInternshipListingUrl(goal: string): string | undefined {
  const urls =
    positiveText(goal).match(
      /\bhttps?:\/\/(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi
    ) ?? []
  return urls.length === 1 ? urls[0] : undefined
}

export function buildInternshipApplicationGraph(goal: string): WorkflowGraph {
  const url = directInternshipListingUrl(goal)
  if (!url) {
    throw new Error("An internship application workflow needs a direct listing URL.")
  }

  const nodes: StepNodeType[] = [
    stepNode({
      id: "start",
      type: "start",
      title: "Start",
      position: { x: 0, y: 0 },
    }),
    stepNode({
      id: "internship-approval",
      type: "approval",
      title: "Approve one application",
      values: {
        reason: `Approve BrowserMind to submit one internship application at ${url}. Review the goal and attached documents before approving.`,
      },
      position: { x: 300, y: 0 },
    }),
    stepNode({
      id: "internship-agent",
      type: "agent",
      title: "Complete internship application",
      values: {
        instruction: [
          "Apply to exactly ONE internship: use only this direct listing URL:",
          url,
          "",
          "Use only facts explicitly provided in the user's goal or attached documents. Check that the listing is still open and is the requested role. Fill the application accurately and submit it once only after checking every answer.",
          "Do not invent answers, apply to other listings, or retry a submission whose result is unclear. Upload only a user-attached, allowlisted file when the approved form requires it; if that file is unavailable (including on Browserbase), report the blocker. Do not guess login credentials or bypass OTP/CAPTCHA. Stop without submitting for payment, unexpected consent, unrelated account changes, or missing facts.",
        ].join("\n"),
      },
      position: { x: 600, y: 0 },
    }),
  ]

  return {
    nodes,
    edges: [
      edge("start-to-internship-approval", "start", "internship-approval"),
      edge("internship-approval-to-agent", "internship-approval", "internship-agent"),
    ],
  }
}

export function buildInternshipQueueGraph(goal: string): WorkflowGraph {
  const nodes: StepNodeType[] = [
    stepNode({
      id: "start",
      type: "start",
      title: "Start",
      position: { x: 0, y: 0 },
    }),
    stepNode({
      id: "internship-agent",
      type: "agent",
      title: "Discover and rank internships",
      values: {
        instruction: [
          "Discover internship listings that match the user's profile and criteria:",
          goal,
          "",
          "Visit real listing pages from multiple permitted sources. Collect up to 100 distinct, currently open internships with direct application URLs. Extract company, role, eligibility, deadline, and source URL when stated. Exclude duplicates and closed roles. Do NOT fill or submit any application during discovery; the next workflow step is the batch approval gate.",
        ].join("\n"),
      },
      position: { x: 300, y: 0 },
    }),
    stepNode({
      id: "internship-approval",
      type: "approval",
      title: "Approve application queue",
      values: {
        reason:
          "Approve BrowserMind to process up to 100 ranked internship applications using only your attached documents and stated profile facts. It will skip blocked forms and never make a payment.",
      },
      position: { x: 600, y: 0 },
    }),
  ]

  return {
    nodes,
    edges: [
      edge("start-to-internship-agent", "start", "internship-agent"),
      edge("internship-agent-to-approval", "internship-agent", "internship-approval"),
    ],
  }
}

// A short, human subject line derived from the goal's first line.
function subjectFromGoal(goal: string): string {
  const [firstLine = ""] = goal.trim().split(/\r?\n/)
  const normalized = firstLine.replace(/\s+/g, " ").trim()
  const base = normalized.length > 70 ? `${normalized.slice(0, 67).trim()}…` : normalized

  return base ? `${base} — results` : "BrowserMind results"
}

const DESKTOP_INTENT =
  /\b(desktop|this pc|my pc|my computer|my laptop|this machine|this computer|calculator|notepad|file explorer|installed app|open the app)\b/i

export function buildDraftGraphFromGoal(goal: string): WorkflowGraph {
  // Desktop Agent workflows must be Start + exactly one Desktop Agent node.
  if (DESKTOP_INTENT.test(positiveText(goal))) {
    return {
      nodes: [
        stepNode({ id: "start", type: "start", title: "Start", position: { x: 0, y: 0 } }),
        stepNode({
          id: "desktop",
          type: "desktop-control",
          title: "Desktop Agent",
          values: { instruction: goal },
          position: { x: 300, y: 0 },
        }),
      ],
      edges: [edge("start-to-desktop", "start", "desktop")],
    }
  }

  const hints = intentHints(goal)
  const url = firstUrl(goal)

  // Build a single left-to-right chain. Each node connects to the one before
  // it, so the graph always reflects the order the run will actually walk.
  const nodes: StepNodeType[] = []
  const edges: Edge[] = []
  let previousId: string | null = null
  let x = 0

  const append = (
    node: Omit<Parameters<typeof stepNode>[0], "position">
  ) => {
    const created = stepNode({ ...node, position: { x, y: 0 } })
    nodes.push(created)
    if (previousId) {
      edges.push(edge(`${previousId}-to-${created.id}`, previousId, created.id))
    }
    previousId = created.id
    x += 300
  }

  append({ id: "start", type: "start", title: "Start" })

  if (url) {
    append({
      id: "open-goal-url",
      type: "open-url",
      title: "Open goal URL",
      values: { url },
    })
  }

  append({
    id: "browser-agent",
    type: "agent",
    title: "Work on goal",
    values: {
      instruction: [
        "Work toward this goal using the browser:",
        goal,
        "",
        "Use safe, reversible steps. Do not submit forms, send messages, make purchases, change account settings, or bypass OTP/CAPTCHA without human approval.",
      ].join("\n"),
    },
  })

  if (hints.involvesForm) {
    append({
      id: "review-form-state",
      type: "observe",
      title: "Review form state",
      values: {
        instruction:
          "Identify required fields, upload controls, validation messages, OTP/CAPTCHA prompts, and the final submission control. Do not submit.",
      },
    })
  }

  if (hints.involvesResearch || hints.involvesEmail) {
    append({
      id: "extract-findings",
      type: "extract",
      title: "Extract findings",
      values: {
        instruction:
          "Extract the useful findings as structured text: the requested fields/table, sources with direct links, eligibility or fit notes, duplicates, risks, and recommended next steps.",
      },
    })
  }

  if (hints.involvesSensitive) {
    append({
      id: "human-approval",
      type: "approval",
      title: "Human approval",
      values: {
        reason:
          "A sensitive action (payment, registration, or fee) was detected. Approve before BrowserMind proceeds with it.",
      },
    })
  }

  if (hints.involvesEmail) {
    // A real Send Email node so the canvas shows the emailing step the goal
    // asked for. `to` is left blank on purpose: the runner falls back to the
    // configured results address, and the user can set a specific recipient
    // here in the inspector.
    append({
      id: "send-report",
      type: "send-email",
      title: "Send report",
      values: {
        to: "",
        subject: subjectFromGoal(goal),
        body: "Send the completed findings — the full table, the roadmap, and all source links — as the email body.",
      },
    })
  }

  // A pure browser task with no research/email/form still deserves a closing
  // summary so the run produces something reviewable.
  if (nodes.length <= (url ? 3 : 2)) {
    append({
      id: "summarize-result",
      type: "extract",
      title: "Summarize result",
      values: {
        instruction:
          "Summarize what was completed, what evidence was found, and what still needs human review.",
      },
    })
  }

  return { nodes, edges }
}
