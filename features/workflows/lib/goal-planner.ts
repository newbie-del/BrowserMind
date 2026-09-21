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

function intentHints(goal: string) {
  const normalized = goal.toLowerCase()

  return {
    involvesForm:
      /\b(form|application|apply|fill|upload|submit|certificate|document)\b/.test(
        normalized
      ),
    involvesEmail:
      /\b(email|outreach|sponsor|contact|draft|send)\b/.test(normalized),
    involvesResearch:
      /\b(find|search|research|collect|shortlist|opportunit|company|companies)\b/.test(
        normalized
      ),
  }
}

function firstUrl(goal: string): string | undefined {
  const match = goal.match(
    /\b(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i
  )

  if (!match) return undefined

  return match[0].startsWith("http")
    ? match[0]
    : `https://${match[0]}`
}

export function buildDraftGraphFromGoal(goal: string): WorkflowGraph {
  const hints = intentHints(goal)
  const url = firstUrl(goal)
  const nodes: StepNodeType[] = [
    stepNode({
      id: "start",
      type: "start",
      title: "Start",
      position: { x: 0, y: 0 },
    }),
    stepNode({
      id: "browser-agent",
      type: "agent",
      title: "Work on goal",
      values: {
        instruction: [
          "Work toward this browser workflow goal:",
          goal,
          "",
          "Use safe, reversible steps. Do not submit forms, send messages, make purchases, change account settings, or bypass OTP/CAPTCHA without human approval.",
        ].join("\n"),
      },
      position: { x: url ? 560 : 280, y: 0 },
    }),
  ]

  const edges: Edge[] = [edge("start-to-browser-agent", "start", "browser-agent")]

  let previousNodeId = "start"
  let nextX = 280

  if (url) {
    nodes.splice(
      1,
      0,
      stepNode({
        id: "open-goal-url",
        type: "open-url",
        title: "Open goal URL",
        values: { url },
        position: { x: 280, y: 0 },
      })
    )
    edges[0] = edge("start-to-open-goal-url", "start", "open-goal-url")
    edges.push(edge("open-goal-url-to-browser-agent", "open-goal-url", "browser-agent"))
    previousNodeId = "browser-agent"
    nextX = 840
  } else {
    edges[0] = edge("start-to-browser-agent", "start", "browser-agent")
    previousNodeId = "browser-agent"
    nextX = 560
  }

  if (hints.involvesForm) {
    nodes.push(
      stepNode({
        id: "review-form-state",
        type: "observe",
        title: "Review form state",
        values: {
          instruction:
            "Identify required fields, upload controls, validation messages, OTP/CAPTCHA prompts, and any final submission control. Do not submit.",
        },
        position: { x: nextX, y: -110 },
      })
    )
    edges.push(edge("browser-agent-to-review-form-state", previousNodeId, "review-form-state"))
    previousNodeId = "review-form-state"
    nextX += 280
  }

  if (hints.involvesResearch || hints.involvesEmail) {
    nodes.push(
      stepNode({
        id: "extract-findings",
        type: "extract",
        title: "Extract findings",
        values: {
          instruction:
            "Extract the useful findings, sources, eligibility or fit notes, duplicates, risks, and recommended next steps as structured text.",
        },
        position: { x: nextX, y: 0 },
      })
    )
    edges.push(edge("previous-to-extract-findings", previousNodeId, "extract-findings"))
    previousNodeId = "extract-findings"
    nextX += 280
  }

  if (hints.involvesEmail) {
    nodes.push(
      stepNode({
        id: "draft-message",
        type: "extract",
        title: "Draft message",
        values: {
          instruction:
            "Draft the email or outreach message only. Include recipients, subject, body, personalization notes, and approval questions. Do not send anything.",
        },
        position: { x: nextX, y: 110 },
      })
    )
    edges.push(edge("previous-to-draft-message", previousNodeId, "draft-message"))
    previousNodeId = "draft-message"
  }

  if (previousNodeId === "browser-agent") {
    nodes.push(
      stepNode({
        id: "summarize-result",
        type: "extract",
        title: "Summarize result",
        values: {
          instruction:
            "Summarize what was completed, what evidence was found, and what still needs human review.",
        },
        position: { x: nextX, y: 0 },
      })
    )
    edges.push(edge("browser-agent-to-summarize-result", "browser-agent", "summarize-result"))
  }

  return { nodes, edges }
}
