$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$expectedDir = Join-Path $HOME ".pi\agent"

function Resolve-CanonicalPath {
  param([string]$Path)

  try {
    return (Resolve-Path $Path).Path
  } catch {
    return $null
  }
}

$resolvedScriptDir = Resolve-CanonicalPath $scriptDir
$resolvedExpectedDir = Resolve-CanonicalPath $expectedDir

if (-not $resolvedExpectedDir -or $resolvedScriptDir -ne $resolvedExpectedDir) {
  Write-Host "This repo should be cloned to $expectedDir" -ForegroundColor Yellow
  Write-Host "Current location: $scriptDir"
  Write-Host "Expected: $expectedDir"
  exit 1
}

Write-Host "Setting up pi config at $expectedDir"
Write-Host ""

$packages = @(
  "git:github.com/nicobailon/pi-mcp-adapter",
  "git:github.com/HazAT/pi-smart-sessions",
  "git:github.com/HazAT/pi-parallel",
  "git:github.com/pasky/chrome-cdp-skill",
  "git:github.com/HazAT/pi-interactive-subagents",
  "git:github.com/HazAT/pi-autoresearch"
)

Write-Host "Installing packages..."
foreach ($package in $packages) {
  Write-Host "  $package"
  & pi install $package | Out-Host
  if ($LASTEXITCODE -ne 0) {
    Write-Host "    skipped (already installed or install failed)" -ForegroundColor DarkYellow
  }
}

Write-Host ""
Write-Host "LM Studio checks:"
& lms --help *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "  LM Studio CLI detected."
} else {
  Write-Host "  LM Studio CLI not detected. Install LM Studio and make sure 'lms' is on PATH." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Recommended LM Studio load commands:"
Write-Host "  lms server start"
Write-Host "  lms load <your-chosen-local-model> --identifier pi-local -c 32768"
Write-Host ""
Write-Host "Examples:"
Write-Host "  lms load huihui-qwen3-coder-30b-a3b-instruct-abliterated-i1 --identifier pi-local -c 32768"
Write-Host "  lms load qwen3.5-9b-claude-code --identifier pi-local -c 32768"

Write-Host ""
Write-Host "Verify local models:"
Write-Host "  lms ps"
Write-Host "  pi --list-models"

Write-Host ""
Write-Host "Optional Codex login:"
Write-Host "  Start pi, then run /login and choose ChatGPT Plus/Pro (Codex)."
Write-Host "  Use planner-codex, reviewer-codex, or researcher-codex when you want cloud help."

Write-Host ""
Write-Host "Setup complete."
Write-Host "Restart pi after loading your pi-local LM Studio model."
