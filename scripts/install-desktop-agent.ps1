$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$agentDir = Join-Path $repoRoot "desktop-agent"
$venvDir = Join-Path $repoRoot ".desktop-agent"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$tokenDir = Join-Path $env:LOCALAPPDATA "BrowserMind"
$tokenPath = Join-Path $tokenDir "desktop-agent.token"
$envPath = Join-Path $repoRoot ".env"

$uv = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uv) {
    throw "uv is required. Install it from https://docs.astral.sh/uv/ and retry."
}
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    throw "Ollama is required. Install Ollama and start it before installing the Desktop Agent."
}

Write-Host "[1/4] Creating the local Desktop Agent environment on D:"
if (-not (Test-Path $venvPython)) {
    & $uv.Source venv --python 3.13 $venvDir
    if ($LASTEXITCODE -ne 0) { throw "uv venv failed with exit code $LASTEXITCODE" }
}
& $uv.Source pip install --python $venvPython -r (Join-Path $agentDir "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Desktop Agent dependency install failed with exit code $LASTEXITCODE" }

Write-Host "[2/4] Pulling the vision model into your Ollama model directory"
& ollama pull qwen3-vl:4b
if ($LASTEXITCODE -ne 0) { throw "Vision model download failed with exit code $LASTEXITCODE" }

Write-Host "[3/4] Pairing the local Trigger.dev worker"
New-Item -ItemType Directory -Path $tokenDir -Force | Out-Null
if (Test-Path $tokenPath) {
    $token = (Get-Content -Raw $tokenPath).Trim()
} else {
    $randomBytes = New-Object byte[] 32
    $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    $randomGenerator.GetBytes($randomBytes)
    $randomGenerator.Dispose()
    $token = [Convert]::ToBase64String($randomBytes)
    $token = $token.TrimEnd("=").Replace("+", "-").Replace("/", "_")
    [IO.File]::WriteAllText($tokenPath, $token, [Text.UTF8Encoding]::new($false))
}
if ($token.Length -lt 40) {
    throw "The saved desktop pairing token is invalid. Remove $tokenPath and rerun the installer."
}

$envLine = "BROWSERMIND_DESKTOP_AGENT_TOKEN=$token"
$envContent = if (Test-Path $envPath) { [IO.File]::ReadAllText($envPath) } else { "" }
$tokenPattern = '(?m)^BROWSERMIND_DESKTOP_AGENT_TOKEN=.*$'
if ([regex]::IsMatch($envContent, $tokenPattern)) {
    $envContent = [regex]::Replace($envContent, $tokenPattern, $envLine)
} else {
    if ($envContent.Length -gt 0 -and -not $envContent.EndsWith("`n")) {
        $envContent += "`r`n"
    }
    $envContent += "$envLine`r`n"
}
[IO.File]::WriteAllText($envPath, $envContent, [Text.UTF8Encoding]::new($false))

Write-Host "[4/4] Installation complete."
Write-Host "Start the local approval console in its own PowerShell window:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\start-desktop-agent.ps1`""
Write-Host "Then restart BrowserMind locally with: npm run dev:all"
