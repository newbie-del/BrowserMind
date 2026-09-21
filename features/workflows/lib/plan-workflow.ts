import type { Edge } from "@xyflow/react"
import toposort from "toposort"

import type { WorkflowGraph } from "@/lib/db/schema"
import {
  nodeRegistry,
  type NodeType,
  type StepNodeType,
} from "@/features/workflows/nodes/node-registry"
import { buildDraftGraphFromGoal } from "@/features/workflows/lib/goal-planner"

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
        .map((field) => `${field.key}${field.required ? "*" : ""}`)
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
4. Add an "open-url" node (with the "url" field) as the first action ONLY when the goal names a specific website/URL to open.
5. Add an "extract" node when the goal asks to collect, list, compare or return structured data — its "instruction" says exactly what to extract.
6. Add an "observe" node only when the goal genuinely needs to inspect a page/form's state before acting.
7. Add an "act" node only for a specific single UI action (click/type) the goal calls for.
8. Add a "send-email" node ONLY if the goal explicitly asks to email/send/share the results. Set "to" to the address if the goal gives one, otherwise "". Set a clear "subject" and a short "body" describing what to send.
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

function pickModel(): string {
  return (
    process.env.WORKFLOW_PLANNER_MODEL ||
    process.env.BROWSER_USE_GOOGLE_MODEL ||
    "gemini-2.0-flash"
  )
}

async function callGemini(goal: string): Promise<PlannedGraph | null> {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) return null

  const model = pickModel()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${apiKey}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(goal) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    })

    if (!response.ok) return null

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")

    return text ? parseJson(text) : null
  } catch {
    // Network error, timeout, quota — fall back to the rule-based planner.
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

// Turn the model's loose plan into a valid, laid-out WorkflowGraph, or return
// null if it is structurally unusable so the caller can fall back.
function toWorkflowGraph(plan: PlannedGraph | null, goal: string): WorkflowGraph | null {
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
  try {
    const graph = toWorkflowGraph(await callGemini(goal), goal)
    if (graph) return graph
  } catch {
    // fall through to the deterministic planner
  }
  return buildDraftGraphFromGoal(goal)
}
