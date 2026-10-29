export type DesktopAgentResult = {
  success: boolean
  completed: boolean
  message: string
  steps: number
  actions: string[]
  urls: string[]
}

const DESKTOP_AGENT_URL = "http://127.0.0.1:8765"
const REQUEST_TIMEOUT_MS = 11 * 60 * 1000

function isDesktopAgentResult(value: unknown): value is DesktopAgentResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof value.success === "boolean" &&
    "completed" in value &&
    typeof value.completed === "boolean" &&
    "message" in value &&
    typeof value.message === "string" &&
    "steps" in value &&
    typeof value.steps === "number" &&
    "actions" in value &&
    Array.isArray(value.actions) &&
    value.actions.every(
      (action): action is string => typeof action === "string"
    )
  )
}

export async function runDesktopAgent(
  instruction: string
): Promise<DesktopAgentResult> {
  const token = process.env.BROWSERMIND_DESKTOP_AGENT_TOKEN
  if (!token) {
    throw new Error(
      "Desktop Agent is not paired. Run scripts\\install-desktop-agent.ps1, then restart the local BrowserMind/Trigger.dev stack."
    )
  }

  let response: Response
  try {
    response = await fetch(`${DESKTOP_AGENT_URL}/tasks`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ instruction }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof TypeError && error.message === "fetch failed") {
      throw new Error(
        `Cannot reach the local Desktop Agent at ${DESKTOP_AGENT_URL}. Start it on the same computer as the Trigger.dev worker with "powershell -ExecutionPolicy Bypass -File .\\scripts\\start-desktop-agent.ps1", keep its approval-console window open, then retry.`
      )
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        "The local Desktop Agent did not finish within 11 minutes. Check its approval console and try again."
      )
    }
    throw error
  }

  const text = await response.text()
  let result: unknown
  try {
    result = JSON.parse(text)
  } catch {
    throw new Error(
      `Local Desktop Agent returned invalid JSON (HTTP ${response.status}).`
    )
  }

  if (!response.ok) {
    const detail =
      result &&
      typeof result === "object" &&
      "detail" in result &&
      typeof result.detail === "string"
        ? result.detail
        : `HTTP ${response.status}`
    throw new Error(`Local Desktop Agent failed: ${detail}`)
  }

  if (!isDesktopAgentResult(result)) {
    throw new Error("Local Desktop Agent returned an unexpected result shape.")
  }

  return { ...result, urls: [] }
}
