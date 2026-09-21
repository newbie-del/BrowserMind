import { spawn } from "node:child_process"
import { access } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { config } from "dotenv"

// Trigger task workers can run with a different cwd from the CLI process.
// Resolve both env files from this module and cwd so the worker gets the same
// configuration whether it is started from the app or workspace root.
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const appEnvironmentFiles = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(moduleDirectory, "..", "..", ".env"),
]

for (const environmentFile of [...new Set(appEnvironmentFiles)]) {
  config({ path: environmentFile })
}

// The workspace-level file is the source of the Browser-Use key in this
// project. Load it last so an empty app-level placeholder cannot mask it.
const workspaceEnvironmentFiles = [
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(moduleDirectory, "..", "..", "..", ".env"),
]

for (const environmentFile of [...new Set(workspaceEnvironmentFiles)]) {
  config({ path: environmentFile, override: true })
}

type BrowserUseResult = {
  success: boolean | null
  completed: boolean
  message: string | null
  steps: number
  urls: string[]
  sourceDomains?: string[]
  actions: string[]
  errors: unknown[]
}

function sanitizeUnicode(value: string) {
  let sanitized = ""

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        sanitized += value[index] + value[index + 1]
        index += 1
      }
      continue
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      continue
    }

    sanitized += value[index]
  }

  return sanitized
}

function validateResult(result: BrowserUseResult): BrowserUseResult {
  const lastError = [...result.errors]
    .reverse()
    .find((error) => typeof error === "string" && error.trim())

  if (
    result.success !== true ||
    !result.completed ||
    result.steps < 2 ||
    result.actions.length === 0
  ) {
    throw new Error(
      lastError
        ? `Browser-Use agent did not complete: ${lastError}`
        : "Browser-Use agent did not complete any browser actions."
    )
  }

  return result
}

function parseResult(stdout: string): BrowserUseResult {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]) as BrowserUseResult
      if (
        parsed &&
        typeof parsed === "object" &&
        "success" in parsed &&
        "completed" in parsed
      ) {
        return validateResult(parsed)
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }

  throw new Error("Browser-Use agent did not return structured JSON output.")
}

function defaultPythonPath(sourcePath: string) {
  return path.join(
    sourcePath,
    ".venv",
    "Scripts",
    process.platform === "win32" ? "python.exe" : "python"
  )
}

export async function runBrowserUseAgent({
  cdpUrl,
  task,
}: {
  cdpUrl?: string
  task: string
}): Promise<BrowserUseResult> {
  if (
    !process.env.BROWSER_USE_API_KEY &&
    !process.env.GOOGLE_API_KEY &&
    !process.env.OPENAI_API_KEY
  ) {
    throw new Error(
      "OPENAI_API_KEY, GOOGLE_API_KEY, or BROWSER_USE_API_KEY is required for the Browser-Use agent."
    )
  }

  // moduleDirectory is features/workflows/lib; three levels up is the repo root
  // (browsermind), where the browser-use engine now lives as a subfolder.
  const sourcePath = path.resolve(
    process.env.BROWSER_USE_SOURCE_PATH ??
      path.join(moduleDirectory, "..", "..", "..", "browser-use")
  )
  const pythonPath =
    process.env.BROWSER_USE_PYTHON ?? defaultPythonPath(sourcePath)
  const runnerPath = path.join(
    moduleDirectory,
    "..",
    "..",
    "..",
    "scripts",
    "browser-use-agent.py"
  )

  await access(pythonPath)
  await access(runnerPath)

  return await new Promise<BrowserUseResult>((resolve, reject) => {
    const child = spawn(pythonPath, ["-u", runnerPath], {
      cwd: sourcePath,
      env: {
        ...process.env,
        ANONYMIZED_TELEMETRY: "false",
        BROWSER_USE_MAX_FAILURES: "1",
        BROWSER_USE_KEEP_BROWSER_OPEN: "true",
        PYTHONPATH: [sourcePath, process.env.PYTHONPATH]
          .filter(Boolean)
          .join(path.delimiter),
      },
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error("Browser-Use agent timed out after 10 minutes."))
    }, 10 * 60 * 1000)

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(`[Browser-Use] ${text}`)
    })
    child.on("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(
          new Error(
            `Browser-Use agent exited with code ${code}: ${
              stderr.trim() || stdout.trim() || "unknown error"
            }`
          )
        )
        return
      }

      try {
        resolve(parseResult(stdout))
      } catch (error) {
        reject(
          new Error(
            `Browser-Use agent returned invalid output: ${
              error instanceof Error ? error.message : stderr.trim() || stdout.trim()
            }`
          )
        )
      }
    })

    child.stdin.end(
      JSON.stringify({
        cdpUrl,
        task: sanitizeUnicode(task),
      })
    )
  })
}
