param()
$ErrorActionPreference = "Stop"
$llamaHome = Split-Path -Parent $PSScriptRoot
$adminDir = Join-Path $llamaHome 'admin'
$logsDir = Join-Path $llamaHome 'logs'
$pidPath = Join-Path $logsDir 'llama-admin.pid'
$outPath = Join-Path $logsDir 'llama-admin.out.log'
$errPath = Join-Path $logsDir 'llama-admin.err.log'
if (Test-Path $pidPath) {
  $existingPid = Get-Content $pidPath -Raw
  if ($existingPid -and (Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue)) {
    [pscustomobject]@{ ok = $true; pid = [int]$existingPid; alreadyRunning = $true } | ConvertTo-Json -Compress
    exit 0
  }
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
}
if (Test-Path $outPath) { Remove-Item $outPath -Force }
if (Test-Path $errPath) { Remove-Item $errPath -Force }
$p = Start-Process -FilePath 'node.exe' -ArgumentList @('llama-admin.mjs') -WorkingDirectory $adminDir -RedirectStandardOutput $outPath -RedirectStandardError $errPath -PassThru
Set-Content -Path $pidPath -Value $p.Id
Start-Sleep -Seconds 2
[pscustomobject]@{ ok = $true; pid = $p.Id; adminUrl = 'http://127.0.0.1:1235' } | ConvertTo-Json -Compress
