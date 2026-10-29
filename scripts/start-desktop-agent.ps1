$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$agentDir = Join-Path $repoRoot "desktop-agent"
$venvPython = Join-Path $repoRoot ".desktop-agent\Scripts\python.exe"
$tokenPath = Join-Path $env:LOCALAPPDATA "BrowserMind\desktop-agent.token"

if (-not (Test-Path $venvPython)) {
    throw "Desktop Agent is not installed. Run scripts\install-desktop-agent.ps1 first."
}
if (-not (Test-Path $tokenPath)) {
    throw "Desktop Agent pairing is missing. Run scripts\install-desktop-agent.ps1 first."
}

$env:BROWSERMIND_DESKTOP_AGENT_TOKEN = (Get-Content -Raw $tokenPath).Trim()
$env:OLLAMA_URL = "http://127.0.0.1:11434"
$env:BROWSERMIND_DESKTOP_MODEL = "qwen3-vl:4b"

Write-Host "Local Desktop Agent listening at http://127.0.0.1:8765"
Write-Host "Leave this window open. Each proposed mouse/keyboard action requires typing y here."
Write-Host "Stop the companion with Ctrl+C."
Push-Location $agentDir
try {
    & $venvPython -m uvicorn agent:app --host 127.0.0.1 --port 8765
    if ($LASTEXITCODE -ne 0) {
        throw "Desktop Agent exited with code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
