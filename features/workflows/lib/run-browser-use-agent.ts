import { spawn } from "node:child_process"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import os from "node:os"
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

// One row of a structured shortlist the agent now emits (see RESEARCH_POLICY's
// json block). Every field is optional because a page may not state all of them.
// verification/isNew are added later by the Checker pass and cross-run dedupe.
export type ShortlistItem = {
  company?: string
  role?: string
  ctc?: string
  eligibility?: string
  deadline?: string
  sourceUrl?: string
  notes?: string
  verification?: { verdict: "pass" | "reject"; reason: string }
  isNew?: boolean
}

export type BrowserUseResult = {
  success: boolean | null
  completed: boolean
  message: string | null
  steps: number
  urls: string[]
  sourceDomains?: string[]
  actions: string[]
  errors: unknown[]
  shortlist?: ShortlistItem[] | null
  data?: unknown
  applicationStatus?: "applied" | "needs_attention" | "not_applied" | "uncertain" | "not_applicable"
  applicationMessage?: string
}

export type BrowserAgentAttachment = {
  filename: string
  contentType: string
  contentBase64: string
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

  const hasShortlist =
    Array.isArray(result.shortlist) && result.shortlist.length > 0
  // Relaxed: browser-use's is_successful() is often null (it asserts a hard false
  // only on an explicit failure). Treat null as "completed, not self-graded" so a
  // genuine run still reaches the email/verify steps; only a hard false, no
  // completion, too few steps, or zero actions is a real failure. A run that
  // produced a usable shortlist is kept even if the agent self-graded failure.
  if (
    (result.success === false && !hasShortlist) ||
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
  signal,
  task,
  allowFormSubmission = false,
  attachments = [],
  profileKey,
  onProgress,
}: {
  cdpUrl?: string
  signal?: AbortSignal
  task: string
  allowFormSubmission?: boolean
  attachments?: BrowserAgentAttachment[]
  profileKey?: string
  onProgress?: (progress: { step: number; action: string }) => void
}): Promise<BrowserUseResult> {
  if (signal?.aborted) {
    throw new DOMException("Browser-Use agent was cancelled.", "AbortError")
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for the Browser-Use agent.")
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

  const uploadDirectory =
    allowFormSubmission && !cdpUrl && attachments.length > 0
      ? await mkdtemp(path.join(os.tmpdir(), "browsermind-uploads-"))
      : undefined
  const availableFilePaths: string[] = []
  if (uploadDirectory) {
    const supportedTypes = new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
    ])
    let totalSize = 0
    try {
      for (const [index, attachment] of attachments.entries()) {
        if (!supportedTypes.has(attachment.contentType)) {
          throw new Error(
            `Unsupported attached document type: ${attachment.contentType}`
          )
        }
        const data = Buffer.from(attachment.contentBase64, "base64")
        totalSize += data.byteLength
        if (totalSize > 20 * 1024 * 1024) {
          throw new Error("Attached documents exceed the 20 MB run limit.")
        }
        const safeName = path
          .basename(attachment.filename)
          .replace(/[^a-zA-Z0-9._-]/g, "_")
        const filePath = path.join(uploadDirectory, `${index}-${safeName}`)
        await writeFile(filePath, data, { flag: "wx", mode: 0o600 })
        availableFilePaths.push(filePath)
      }
    } catch (error) {
      await rm(uploadDirectory, { recursive: true, force: true })
      throw error
    }
  }

  return await new Promise<BrowserUseResult>((resolve, reject) => {
    const child = spawn(pythonPath, ["-u", runnerPath], {
      cwd: sourcePath,
      env: {
        ...process.env,
        ANONYMIZED_TELEMETRY: "false",
        BROWSERMIND_LOADING_LOGO_PATH: path.resolve(
          moduleDirectory,
          "..",
          "..",
          "..",
          "public",
          "logo.png"
        ),
        // Let the agent ride out transient OpenAI transport errors.
        BROWSER_USE_MAX_FAILURES: "5",
        BROWSER_USE_KEEP_BROWSER_OPEN: cdpUrl ? "true" : "false",
        // Search-result pages can be slow to react to clicks. Browser-Use's
        // default is 15s; allow 30s while keeping it overrideable per machine.
        TIMEOUT_ClickElementEvent:
          process.env.TIMEOUT_ClickElementEvent ?? "30",
        PYTHONPATH: [sourcePath, process.env.PYTHONPATH]
          .filter(Boolean)
          .join(path.delimiter),
      },
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
      if (uploadDirectory) {
        void rm(uploadDirectory, { recursive: true, force: true }).catch(
          (error: unknown) => {
            process.stderr.write(
              `[Browser-Use] Could not remove temporary application documents: ${
                error instanceof Error ? error.message : String(error)
              }\n`
            )
          }
        )
      }
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const timeout = setTimeout(
      () => {
        child.kill()
        fail(new Error("Browser-Use agent timed out after 55 minutes."))
      },
      55 * 60 * 1000
    )
    const abort = () => {
      child.kill()
      fail(new DOMException("Browser-Use agent was cancelled.", "AbortError"))
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    let progressBuffer = ""
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(`[Browser-Use] ${text}`)
      if (!onProgress) return
      // The Python agent prints "[[PROGRESS]]{json}" per step on stderr; relay
      // each complete line so the caller can light up the matching canvas node.
      progressBuffer += text
      let newlineIndex: number
      while ((newlineIndex = progressBuffer.indexOf("\n")) >= 0) {
        const line = progressBuffer.slice(0, newlineIndex)
        progressBuffer = progressBuffer.slice(newlineIndex + 1)
        const marker = line.indexOf("[[PROGRESS]]")
        if (marker < 0) continue
        try {
          const parsed = JSON.parse(
            line.slice(marker + "[[PROGRESS]]".length).trim()
          )
          onProgress({
            step: Number(parsed.step) || 0,
            action: String(parsed.action ?? ""),
          })
        } catch {
          // ignore malformed progress lines
        }
      }
    })
    child.on("error", (error) => {
      fail(error)
    })
    child.stdin.on("error", (error) => {
      fail(error)
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      cleanup()
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
              error instanceof Error
                ? error.message
                : stderr.trim() || stdout.trim()
            }`
          )
        )
      }
    })

    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    child.stdin.end(
      JSON.stringify({
        cdpUrl,
        task: sanitizeUnicode(task),
        allowFormSubmission,
        availableFilePaths,
        userDataDir:
          !cdpUrl && process.env.BROWSER_USE_PROFILE_DIR && profileKey
            ? path.join(
                path.resolve(process.env.BROWSER_USE_PROFILE_DIR),
                profileKey.replace(/[^a-zA-Z0-9_-]/g, "_")
              )
            : undefined,
      })
    )
  })
}
