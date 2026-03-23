param()
$ErrorActionPreference = "SilentlyContinue"
$llamaHome = Split-Path -Parent $PSScriptRoot
$configDir = Join-Path $llamaHome 'config'
$pidPath = Join-Path $llamaHome 'logs\llama-server.pid'
$runtime = Get-Content (Join-Path $configDir 'runtime.json') -Raw | ConvertFrom-Json
$serverPid = $null
$running = $false
if (Test-Path $pidPath) {
  $serverPid = (Get-Content $pidPath -Raw).Trim()
  if ($serverPid) {
    $running = [bool](Get-Process -Id ([int]$serverPid) -ErrorAction SilentlyContinue)
  }
}
$reachable = $false
$models = @()
try {
  $resp = Invoke-RestMethod -Uri ("http://{0}:{1}/v1/models" -f $runtime.host, $runtime.port) -TimeoutSec 3
  $reachable = $true
  $models = @($resp.data | ForEach-Object { $_.id })
} catch {}
[pscustomobject]@{ pid = $serverPid; running = $running; reachable = $reachable; models = $models } | ConvertTo-Json -Compress
