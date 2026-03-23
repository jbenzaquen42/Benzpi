param()
$ErrorActionPreference = "Stop"
$llamaHome = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $llamaHome 'logs\llama-server.pid'
if (-not (Test-Path $pidPath)) {
  '{"ok":true,"stopped":true}'
  exit 0
}
$serverPid = Get-Content $pidPath -Raw
if ($serverPid) {
  try { Stop-Process -Id ([int]$serverPid) -Force -ErrorAction Stop } catch {}
}
Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
'{"ok":true,"stopped":true}'
