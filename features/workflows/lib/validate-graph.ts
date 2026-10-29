import toposort from "toposort"

import type { WorkflowGraph } from "@/lib/db/schema"

// Structural problems knowable before a run — empty array means runnable. Pure
// (no db import) so the client can pre-flight the in-hand graph and toast,
// while the server reuses it as the save-time backstop.
export function validateGraph({ nodes, edges }: WorkflowGraph): string[] {
  const problems: string[] = []

  const triggers = nodes.filter((n) => n.data.kind === "trigger").length
  if (triggers !== 1) {
    problems.push(`A workflow needs exactly one Start trigger (found ${triggers}).`)
  }

  // The runner only executes nodes touching an edge, so with none Run is a no-op.
  if (edges.length === 0) {
    problems.push("Connect your nodes before running.")
  } else {
    try {
      // toposort throws on a cycle — the run would otherwise fail mid-sort.
      toposort(edges.map((e) => [e.source, e.target]))
    } catch {
      problems.push("Workflow has a cycle — remove the loop before running.")
    }
  }

  const desktopNodes = nodes.filter(
    (node) => node.data.type === "desktop-control"
  )
  if (desktopNodes.length > 0) {
    if (desktopNodes.length !== 1) {
      problems.push("A workflow can contain only one Desktop Agent node.")
    }
    if (
      nodes.some(
        (node) =>
          node.data.type !== "start" && node.data.type !== "desktop-control"
      )
    ) {
      problems.push(
        "Desktop Agent workflows currently support only a Start node and one Desktop Agent node."
      )
    }
    if (!desktopNodes[0]?.data.values.instruction?.trim()) {
      problems.push("Enter an instruction for the Desktop Agent node.")
    }
  }

  return problems
}
