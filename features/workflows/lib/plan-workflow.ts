import type { Edge } from "@xyflow/react"
import toposort from "toposort"

import type { WorkflowGraph } from "@/lib/db/schema"
import {
  nodeRegistry,
  type NodeType,
  type StepNodeType,
} from "@/features/workflows/nodes/node-registry"
import {
  buildDraftGraphFromGoal,
  buildInternshipApplicationGraph,
  buildInternshipQueueGraph,
  directInternshipListingUrl,
  isInternshipApplicationGoal,
} from "@/features/workflows/lib/goal-planner"

// Shape the model is asked to return. Kept intentionally loose (values is a free
// map) and validated afterwards rather than constrained by a response schema,
// which varies across Gemini versions.
type PlannedNode = {
  id?: string
  type?: string
  title?: string
  values?: Record<string, unknown>
}
type PlannedEdge = { source?: string; target?: string }
type PlannedGraph = { nodes?: PlannedNode[]; edges?: PlannedEdge[] }

const NODE_TYPES = Object.keys(nodeRegistry) as NodeType[]

const SAFETY_GUARDRAIL =
  "Use safe, reversible steps. Do not submit forms, send messages, make purchases, change account settings, or bypass OTP/CAPTCHA without human approval."

function nodeCatalog(): string {
  return NODE_TYPES.map((type) => {
    const def = nodeRegistry[type]
    const fields =
      def.fields
        .map((field) => `${field.key}${"required" in field && field.required ? "*" : ""}`)
        .join(", ") || "none"
    return `- "${type}" (${def.kind}) — ${def.label}. fields: ${fields}`
  }).join("\n")
}

function buildPrompt(goal: string): string {
  return `You convert a user's natural-language goal into a browser-automation workflow graph.

Available node types (fields marked * are required and must be filled):
${nodeCatalog()}

Rules:
1. Output exactly one "start" node (id "start"), the entry trigger. It has no fields.
2. Model the real steps needed to achieve the goal, in the order they run, as action nodes connected after "start".
3. Use one "agent" node for the open-ended browser work (searching, navigating, multi-step research or interaction). Its "instruction" should restate the concrete task.
3a. Use "desktop-control" ONLY when the user explicitly asks to operate THIS computer's own desktop or installed apps (e.g. "open Calculator on my PC"). Anything that happens on a website — paying a fee, registering, submitting a form, logging in, checking out — is NOT desktop-control; use an "agent" (plus an "approval" node for the sensitive step) instead. A "desktop-control" workflow must contain ONLY a Start node and exactly one "desktop-control" node — never combine it with "agent", "approval", "send-email", or any other node.
4. Add an "open-url" node (with the "url" field) as the first action ONLY when the goal names a specific website/URL to open.
5. Add an "extract" node when the goal asks to collect, list, compare or return structured data — its "instruction" says exactly what to extract.
6. Add an "observe" node only when the goal genuinely needs to inspect a page/form's state before acting.
7. Add an "act" node only for a specific single UI action (click/type) the goal calls for.
8. Add a "send-email" node ONLY if the goal explicitly asks to email/send/share the results. Set "to" to the address if the goal gives one, otherwise "". Set a clear "subject" and a short "body" describing what to send.
8a. Add an "approval" node immediately BEFORE any sensitive or irreversible action the user must authorize — a payment, a registration/participation fee, a purchase, or a final submission. Set its "reason" to what needs approving (e.g. "Pay the ₹500 registration fee"). The run pauses there until a human approves.
9. Do NOT add a step for anything the user said NOT to do (respect prohibitions like "do not submit", "do not apply", "do not send", "do not purchase").
10. Fill every required field with a concrete value derived from the goal. Instruction fields must be directive sentences, not restatements of these rules.
11. Connect the nodes into ONE connected flow via "edges" (source -> target ids), starting at "start". Keep it linear unless parallel branches are truly needed.
12. Keep it minimal: only the nodes the goal needs, usually 2 to 6 total.

Return ONLY JSON of this shape (no markdown, no commentary):
{"nodes":[{"id":"start","type":"start","title":"Start","values":{}}, ...],"edges":[{"source":"start","target":"..."}]}

Goal:
"""
${goal}
"""`
}

async function callOpenAI(goal: string): Promise<PlannedGraph | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.WORKFLOW_PLANNER_OPENAI_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: buildPrompt(goal) }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    })

    if (!response.ok) return null

    const data = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[]
    }
    const text = data.choices?.[0]?.message?.content
    return text ? parseJson(text) : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// Tolerant JSON extraction: prefer a clean parse, otherwise pull the first
// balanced object out of the text (models occasionally wrap it in prose).
function parseJson(text: string): PlannedGraph | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as PlannedGraph
  } catch {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as PlannedGraph
    } catch {
      return null
    }
  }
}

function toValues(values: Record<string, unknown> | undefined) {
  const result: Record<string, string> = {}
  if (!values) return result
  for (const [key, value] of Object.entries(values)) {
    if (value == null) continue
    result[key] = typeof value === "string" ? value : String(value)
  }
  return result
}

function goalWantsDesktop(goal: string): boolean {
  return /\b(desktop|this pc|my pc|my computer|my laptop|this machine|this computer|on-?screen|calculator|notepad|file explorer|operate (my|the) (pc|computer|desktop)|local app)\b/i.test(
    goal
  )
}

// The LLM planner sometimes mislabels a WEB action (e.g. "complete the payment")
// as a Desktop Agent node. desktop-control can't coexist with other nodes, so a
// stray one makes the whole workflow invalid. Unless the goal is explicitly about
// operating this PC's own desktop, drop desktop-control nodes and bridge their
// edges so the remaining web flow stays connected.
function stripDesktopNodes(plan: PlannedGraph, goal: string): PlannedGraph {
  if (goalWantsDesktop(goal)) return plan
  const nodes = plan.nodes ?? []
  const desktopIds = new Set(
    nodes
      .filter((node) => node?.type === "desktop-control")
      .map((node) => (node.id ?? "").trim())
      .filter(Boolean)
  )
  if (desktopIds.size === 0) return plan

  let edges = (plan.edges ?? []).map((edge) => ({
    source: (edge.source ?? "").trim(),
    target: (edge.target ?? "").trim(),
  }))
  for (const id of desktopIds) {
    const preds = edges.filter((edge) => edge.target === id).map((e) => e.source)
    const succs = edges.filter((edge) => edge.source === id).map((e) => e.target)
    for (const source of preds) {
      for (const target of succs) {
        if (source && target && source !== target) {
          edges.push({ source, target })
        }
      }
    }
  }
  edges = edges.filter(
    (edge) => !desktopIds.has(edge.source) && !desktopIds.has(edge.target)
  )
  return {
    nodes: nodes.filter((node) => !desktopIds.has((node.id ?? "").trim())),
    edges,
  }
}

// A clean Start → Desktop Agent graph. desktop-control must be the only action
// node, so for a desktop goal we build exactly this and ignore any extra nodes
// the model may have added.
function desktopOnlyGraph(instruction: string): WorkflowGraph {
  const definition = nodeRegistry["desktop-control"]
  return {
    nodes: [
      {
        id: "start",
        type: "step",
        position: { x: 0, y: 0 },
        data: { type: "start", kind: "trigger", title: "Start", values: {} },
      },
      {
        id: "desktop",
        type: "step",
        position: { x: 300, y: 0 },
        data: {
          type: "desktop-control",
          kind: definition.kind,
          title: definition.label,
          values: { instruction },
        },
      },
    ],
    edges: [
      {
        id: "start-to-desktop",
        source: "start",
        target: "desktop",
        type: "smoothstep",
        style: { stroke: "var(--border)" },
      },
    ],
  }
}

// Turn the model's loose plan into a valid, laid-out WorkflowGraph, or return
// null if it is structurally unusable so the caller can fall back.
function toWorkflowGraph(plan: PlannedGraph | null, goal: string): WorkflowGraph | null {
  if (!plan?.nodes?.length) return null
  // Desktop goal → build a clean Start + one Desktop Agent graph (it can't share
  // the canvas with any other node).
  if (goalWantsDesktop(goal)) {
    const desktop = plan.nodes.find((node) => node?.type === "desktop-control")
    if (desktop) {
      const raw = desktop.values?.instruction
      const instruction = (typeof raw === "string" && raw.trim()) || goal
      return desktopOnlyGraph(instruction)
    }
  }
  plan = stripDesktopNodes(plan, goal)
  if (!plan?.nodes?.length) return null

  const seen = new Set<string>()
  const planned: {
    id: string
    type: NodeType
    title?: string
    values: Record<string, string>
  }[] = []

  for (const node of plan.nodes) {
    const type = node.type as NodeType
    if (!type || !(type in nodeRegistry)) continue
    let id = (node.id ?? "").trim() || `${type}-${planned.length}`
    while (seen.has(id)) id = `${id}-${planned.length}`
    seen.add(id)
    planned.push({
      id,
      type,
      title: node.title?.trim() || nodeRegistry[type].label,
      values: toValues(node.values),
    })
  }

  // Must have a single start trigger and at least one action to be worth using.
  const starts = planned.filter((node) => node.type === "start")
  const actions = planned.filter((node) => nodeRegistry[node.type].kind === "action")
  if (starts.length !== 1 || actions.length === 0) return null

  // Guarantee the browser-agent guardrail is always present.
  for (const node of planned) {
    if (node.type === "agent") {
      const instruction = node.values.instruction?.trim()
      node.values.instruction = instruction
        ? `${instruction}\n\n${SAFETY_GUARDRAIL}`
        : `Work toward this goal using the browser:\n${goal}\n\n${SAFETY_GUARDRAIL}`
    }
  }

  const ids = new Set(planned.map((node) => node.id))
  const edgePairs = (plan.edges ?? [])
    .map((edge) => [edge.source ?? "", edge.target ?? ""] as [string, string])
    .filter(([source, target]) => ids.has(source) && ids.has(target) && source !== target)

  if (edgePairs.length === 0) return null

  // Lay out left-to-right in run order; bail if the model produced a cycle.
  let ordered: string[]
  try {
    const sorted = toposort(edgePairs)
    ordered = [
      ...sorted,
      ...planned.map((node) => node.id).filter((id) => !sorted.includes(id)),
    ]
  } catch {
    return null
  }

  const position = new Map(ordered.map((id, index) => [id, index]))
  const nodes: StepNodeType[] = planned.map((node) => {
    const definition = nodeRegistry[node.type]
    return {
      id: node.id,
      type: "step",
      position: { x: (position.get(node.id) ?? 0) * 300, y: 0 },
      data: {
        type: node.type,
        kind: definition.kind,
        title: node.title ?? definition.label,
        values: node.values,
      },
    }
  })

  const edges: Edge[] = edgePairs.map(([source, target]) => ({
    id: `${source}-to-${target}`,
    source,
    target,
    type: "smoothstep",
    style: { stroke: "var(--border)" },
  }))

  return { nodes, edges }
}

// Public entry point: LLM plan when possible, deterministic rule-based plan
// otherwise. Never throws — goal creation always gets a runnable graph.
export async function planWorkflowFromGoal(goal: string): Promise<WorkflowGraph> {
  // Application workflows require a deterministic approval-before-agent order;
  // do not let the model omit or move that gate.
  if (isInternshipApplicationGoal(goal)) {
    if (directInternshipListingUrl(goal)) {
      return buildInternshipApplicationGraph(goal)
    }
    return buildInternshipQueueGraph(goal)
  }

  try {
    const graph = toWorkflowGraph(
      await callOpenAI(goal),
      goal
    )
    if (graph) return graph
  } catch {
    // fall through to the deterministic planner
  }
  return buildDraftGraphFromGoal(goal)
}
