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
  }
}

function firstUrl(goal: string): string | undefined {
  const match = positiveText(goal).match(
    /\bhttps?:\/\/(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i
  )

  return match?.[0]
}

// A short, human subject line derived from the goal's first line.
function subjectFromGoal(goal: string): string {
  const [firstLine = ""] = goal.trim().split(/\r?\n/)
  const normalized = firstLine.replace(/\s+/g, " ").trim()
  const base = normalized.length > 70 ? `${normalized.slice(0, 67).trim()}…` : normalized

  return base ? `${base} — results` : "BrowserMind results"
}

export function buildDraftGraphFromGoal(goal: string): WorkflowGraph {
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
