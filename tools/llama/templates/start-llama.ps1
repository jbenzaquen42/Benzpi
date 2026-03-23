param()
$ErrorActionPreference = "Stop"
$llamaHome = Split-Path -Parent $PSScriptRoot
$configDir = Join-Path $llamaHome 'config'
$logsDir = Join-Path $llamaHome 'logs'
$pidPath = Join-Path $logsDir 'llama-server.pid'
$stdoutLog = Join-Path $logsDir 'llama-server.out.log'
$stderrLog = Join-Path $logsDir 'llama-server.err.log'
$runtime = Get-Content (Join-Path $configDir 'runtime.json') -Raw | ConvertFrom-Json
$llamaServer = Join-Path $llamaHome 'bin\llama-server.exe'
if (-not (Test-Path $llamaServer)) { throw "llama-server.exe not found at $llamaServer" }
if (Test-Path $pidPath) {
  $existingServerPid = Get-Content $pidPath -Raw
  if ($existingServerPid) {
    try { Stop-Process -Id ([int]$existingServerPid) -Force -ErrorAction Stop } catch {}
  }
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 750
}
$arguments = @(
  '--host', [string]$runtime.host,
  '--port', [string]$runtime.port,
  '--models-dir', (Join-Path $llamaHome 'models'),
  '--models-preset', (Join-Path $configDir 'models.ini'),
  '--models-max', [string]$runtime.modelsMax,
  '--webui-config-file', (Join-Path $configDir 'webui.json'),
  '--jinja',
  '--props',
  '--no-warmup'
)
foreach ($logPath in @($stdoutLog, $stderrLog)) {
  for ($i = 0; $i -lt 10; $i++) {
    if (-not (Test-Path $logPath)) { break }
    try {
      Remove-Item $logPath -Force -ErrorAction Stop
      break
    } catch {
      Start-Sleep -Milliseconds 300
    }
  }
}
$p = Start-Process -FilePath $llamaServer -ArgumentList $arguments -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
Set-Content -Path $pidPath -Value $p.Id
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 2
  try {
    $resp = Invoke-RestMethod -Uri ("http://{0}:{1}/v1/models" -f $runtime.host, $runtime.port) -TimeoutSec 5
    [pscustomobject]@{ ok = $true; pid = $p.Id; models = @($resp.data).Count } | ConvertTo-Json -Compress
    exit 0
  } catch {
    if ($p.HasExited) {
      $stderr = if (Test-Path $stderrLog) { Get-Content -Raw $stderrLog } else { '' }
      throw "llama-server exited early.`n$stderr"
    }
  }
}
throw 'llama-server did not become ready in time.'
