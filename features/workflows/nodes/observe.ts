import type { Stagehand } from "@browserbasehq/stagehand"

export async function observe({
  stagehand,
  instruction,
}: {
  stagehand: Stagehand
  instruction?: string
}) {
  const result = await stagehand.observe(instruction)

  return {
    matches: result.data.map((item) => ({
      selector: item.selector,
      description: item.description,
      method: item.method,
      arguments: item.arguments,
    })),
  }
}