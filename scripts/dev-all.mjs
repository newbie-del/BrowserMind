// Starts the whole BrowserMind stack from the repo root with one command:
//   - Next.js dev server (the app UI)                -> next dev
//   - Trigger.dev dev worker (runs the workflow task) -> trigger.dev dev
// Browser-Use is not a standing service; the Trigger task spawns the Python
// engine per run, so nothing extra is needed here.
//
// No external dependencies: this is a tiny process launcher over child_process.
// Run with `npm run dev:all` from D:\browsermind1.
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
// The app now lives at the repo root (one level up from scripts/).
const appDir = path.resolve(scriptDir, "..")

const RESET = "\x1b[0m"
const services = [
  { name: "next", color: "\x1b[36m", cmd: "npm run dev" },
  {
    name: "trigger",
    color: "\x1b[35m",
    // --env-file points at the repo-root .env, BrowserMind's single source of
    // secrets (the worker runs from the repo root, so it is a sibling).
    cmd: "npx trigger.dev@latest dev --env-file .env",
  },
]

const children = []
let shuttingDown = false

function write(name, color, chunk) {
  const lines = chunk.toString().split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === "") lines.pop()
  for (const line of lines) {
    process.stdout.write(`${color}[${name}]${RESET} ${line}\n`)
  }
}

function killTree(child) {
  if (!child.pid) return
  if (process.platform === "win32") {
    // A shell child's grandchildren (node/next/trigger) survive a plain kill on
    // Windows, so kill the whole process tree.
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    })
  } else {
    try {
      child.kill("SIGTERM")
    } catch {}
  }
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) killTree(child)
  setTimeout(() => process.exit(0), 750)
}

for (const service of services) {
  const child = spawn(service.cmd, {
    cwd: appDir,
    shell: true,
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  })
  child.stdout.on("data", (chunk) => write(service.name, service.color, chunk))
  child.stderr.on("data", (chunk) => write(service.name, service.color, chunk))
  child.on("exit", (code) => {
    if (!shuttingDown) {
      process.stdout.write(
        `\x1b[31m[dev:all]${RESET} ${service.name} exited (code ${code}); stopping the stack.\n`
      )
      shutdown()
    }
  })
  children.push(child)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

process.stdout.write(
  `\x1b[32m[dev:all]${RESET} BrowserMind starting — Next.js + Trigger.dev worker. Press Ctrl+C to stop both.\n`
)
