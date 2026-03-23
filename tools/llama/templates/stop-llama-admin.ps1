param()
$ErrorActionPreference = "SilentlyContinue"
$llamaHome = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $llamaHome 'logs\llama-admin.pid'
if (Test-Path $pidPath) {
  $pid = Get-Content $pidPath -Raw
  if ($pid) {
    try { Stop-Process -Id ([int]$pid) -Force -ErrorAction Stop } catch {}
  }
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
}
'{"ok":true,"stopped":true}'
