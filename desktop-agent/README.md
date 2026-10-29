# BrowserMind Local Desktop Agent

The Desktop Agent is an optional, local Windows companion for the BrowserMind
workflow canvas. It uses Ollama's Qwen3-VL model to inspect screenshots and
propose one mouse or keyboard action at a time. The companion binds only to
`127.0.0.1`; screenshots go only to the local Ollama service. A separate
terminal asks for approval before every action.

## Install

From the BrowserMind repository root, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop-agent.ps1
```

This creates a Python environment under `.desktop-agent` on the repository
drive, installs the companion's dependencies, pulls `qwen3-vl:4b` into the
configured Ollama model directory, and pairs the local Trigger.dev worker with
a random token. The token is stored under `%LOCALAPPDATA%\BrowserMind` and in
the ignored repository `.env`; it is never placed in browser code.

## Run

Keep the local approval console open in one PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-desktop-agent.ps1
```

In another window, start BrowserMind and its local Trigger.dev worker:

```powershell
npm run dev:all
```

Add a **Desktop Agent** node to a workflow, connect `Start` to it, enter a
specific instruction, then click **Run**. Review the visible desktop and the
proposed action in the companion console; type `y` to approve that single
action. Before acting, the companion verifies that Chrome, Edge, Firefox,
Brave, or Opera is in the foreground and asks permission to open a fresh tab
with `Ctrl+T`. It keeps focus on that browser tab after each approval so
keyboard actions go to the task rather than the approval console. Any input
other than `y` stops the task. Leave the console open for the whole run. The
node currently supports one Start node and one Desktop Agent node only; it
cannot be combined with cloud browser or email nodes.

## Safety and limits

- The companion accepts requests only on loopback and requires a random bearer
  token. Do not expose port 8765 to the network or put the token in client code.
- Every click, text entry, key press, and scroll requires local terminal
  approval. The service stops if approval is declined or unavailable.
- The model is instructed not to delete, submit, send, purchase, change
  security settings, or enter passwords/one-time codes. Do not approve actions
  you did not request; model output is not a security boundary.
- PyAutoGUI's corner fail-safe remains enabled. Moving the mouse to a screen
  corner stops control.
- There is a 20-action limit per task. The companion has no shell, arbitrary
  code execution, or unattended/background mode.
- `jarvis chat` and this companion are separate processes; the companion
  directly uses your local Ollama model.

Stop the local companion with Ctrl+C. Remove the pairing token from the
BrowserMind `.env` and `%LOCALAPPDATA%\BrowserMind\desktop-agent.token` to
revoke access.
