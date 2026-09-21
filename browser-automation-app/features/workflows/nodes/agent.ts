export async function agent({
  instruction,
  runBrowserUse,
}: {
  instruction: string
  runBrowserUse: (task: string) => Promise<{
    success: boolean | null
    completed: boolean
    message: string | null
    steps: number
    urls: string[]
    actions: string[]
    errors: unknown[]
  }>
}) {
  const result = await runBrowserUse(instruction)

  if (result.success === false) {
    throw new Error(result.message || "Browser-Use agent failed.")
  }

  return result
}