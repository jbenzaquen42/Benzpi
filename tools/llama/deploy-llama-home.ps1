param(
  [switch]$SkipModelMove
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$llamaHome = Join-Path $HOME '.local\llama.cpp'
$sourceRoot = Join-Path $HOME '.lmstudio\models'
$lmStudioSourceConfigRoot = Join-Path $HOME '.lmstudio\.internal\user-concrete-model-default-config'
$configDir = Join-Path $llamaHome 'config'
$modelConfigRoot = Join-Path $configDir 'model-configs'
$templatesDir = Join-Path $configDir 'templates'
$adminDir = Join-Path $llamaHome 'admin'
$scriptsDir = Join-Path $llamaHome 'scripts'
$logsDir = Join-Path $llamaHome 'logs'
$modelsRoot = Join-Path $llamaHome 'models'

function Get-LmStudioFieldValue {
  param(
    [object[]]$Fields,
    [string]$Key
  )

  $field = $Fields | Where-Object { $_.key -eq $Key } | Select-Object -First 1
  if (-not $field) { return $null }
  $value = $field.value
  if ($null -eq $value) { return $null }
  if ($value -is [string] -or $value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal] -or $value -is [bool]) {
    return $value
  }
  $propertyNames = @($value.PSObject.Properties.Name)
  if ($propertyNames -contains 'checked' -and -not [bool]$value.checked) {
    return $null
  }
  if ($propertyNames -contains 'enabled') {
    return [bool]$value.enabled
  }
  if ($propertyNames -contains 'value') {
    return $value.value
  }
  return $value
}

function Test-IsVisionModel {
  param([string]$Text)
  return [bool]($Text -match '(?i)(^|[-_.])(vl|vision|llava|minicpmv|minicpm-v|qwen2-vl|qwen3-vl|smolvlm|moondream|bakllava|mobilevlm|yi-vl|bunny)([-_.]|$)')
}

function Add-PresetLine {
  param(
    [System.Collections.Generic.List[string]]$Lines,
    [string]$Key,
    [object]$Value
  )

  if ($null -eq $Value) { return }
  if ($Value -is [bool]) {
    $text = if ($Value) { 'true' } else { 'false' }
  } else {
    $text = [string]$Value
  }
  if ([string]::IsNullOrWhiteSpace($text)) { return }
  $Lines.Add("$Key = $text")
}

function ConvertTo-LlamaPreset {
  param(
    [pscustomobject]$Item,
    [string]$TemplatesDir
  )

  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("[$($Item.id)]")
  $lines.Add("model = $($Item.model)")
  $lines.Add("alias = $($Item.alias)")
  if ($Item.mmproj) {
    $lines.Add("mmproj = $($Item.mmproj)")
  }

  $config = $Item.modelConfig
  if (-not $config) {
    $lines.Add('fit = on')
    $lines.Add('n-gpu-layers = all')
    $lines.Add('')
    return $lines
  }

  $loadFields = @($config.load.fields)
  $opFields = @($config.operation.fields)

  Add-PresetLine $lines 'ctx-size' (Get-LmStudioFieldValue $loadFields 'llm.load.contextLength')

  $threadPool = Get-LmStudioFieldValue $loadFields 'llm.load.llama.cpuThreadPoolSize'
  if ($null -eq $threadPool) {
    $threadPool = Get-LmStudioFieldValue $opFields 'llm.prediction.llama.cpuThreads'
  }
  Add-PresetLine $lines 'threads' $threadPool
  Add-PresetLine $lines 'threads-batch' $threadPool
  Add-PresetLine $lines 'batch-size' (Get-LmStudioFieldValue $loadFields 'llm.load.llama.evalBatchSize')
  Add-PresetLine $lines 'parallel' (Get-LmStudioFieldValue $loadFields 'llm.load.numParallelSessions')
  Add-PresetLine $lines 'cache-type-k' (Get-LmStudioFieldValue $loadFields 'llm.load.llama.kCacheQuantizationType')
  Add-PresetLine $lines 'cache-type-v' (Get-LmStudioFieldValue $loadFields 'llm.load.llama.vCacheQuantizationType')

  $flashAttention = Get-LmStudioFieldValue $loadFields 'llm.load.llama.flashAttention'
  if ($null -ne $flashAttention) {
    Add-PresetLine $lines 'flash-attn' ($(if ($flashAttention) { 'on' } else { 'off' }))
  }

  $tryMmap = Get-LmStudioFieldValue $loadFields 'llm.load.llama.tryMmap'
  if ($null -ne $tryMmap) {
    if ($tryMmap) {
      Add-PresetLine $lines 'mmap' 'true'
    } else {
      Add-PresetLine $lines 'no-mmap' 'true'
    }
  }

  $keepModelInMemory = Get-LmStudioFieldValue $loadFields 'llm.load.llama.keepModelInMemory'
  if ($null -ne $keepModelInMemory) {
    Add-PresetLine $lines 'mlock' $keepModelInMemory
  }

  $offloadRatio = Get-LmStudioFieldValue $loadFields 'llm.load.llama.acceleration.offloadRatio'
  if ($null -ne $offloadRatio) {
    if ([double]$offloadRatio -ge 0.999) {
      Add-PresetLine $lines 'n-gpu-layers' 'all'
    } elseif ([double]$offloadRatio -gt 0) {
      Add-PresetLine $lines 'n-gpu-layers' 'auto'
      Add-PresetLine $lines 'fit' 'on'
    }
  } else {
    Add-PresetLine $lines 'n-gpu-layers' 'all'
    Add-PresetLine $lines 'fit' 'on'
  }

  $cpuMoeRatio = Get-LmStudioFieldValue $loadFields 'llm.load.numCpuExpertLayersRatio'
  if ($null -ne $cpuMoeRatio) {
    if ([double]$cpuMoeRatio -ge 1) {
      Add-PresetLine $lines 'cpu-moe' 'true'
    } elseif ([double]$cpuMoeRatio -le 0) {
      Add-PresetLine $lines 'cpu-moe' 'false'
    }
  }

  Add-PresetLine $lines 'temperature' (Get-LmStudioFieldValue $opFields 'llm.prediction.temperature')
  Add-PresetLine $lines 'top-k' (Get-LmStudioFieldValue $opFields 'llm.prediction.topKSampling')
  Add-PresetLine $lines 'top-p' (Get-LmStudioFieldValue $opFields 'llm.prediction.topPSampling')
  Add-PresetLine $lines 'min-p' (Get-LmStudioFieldValue $opFields 'llm.prediction.minPSampling')
  Add-PresetLine $lines 'repeat-penalty' (Get-LmStudioFieldValue $opFields 'llm.prediction.repeatPenalty')
  Add-PresetLine $lines 'predict' (Get-LmStudioFieldValue $opFields 'llm.prediction.maxPredictedTokens')
  Add-PresetLine $lines 'seed' (Get-LmStudioFieldValue $loadFields 'llm.load.seed')

  $reasoningEnabled = Get-LmStudioFieldValue $opFields 'llm.prediction.reasoning.parsing'
  if ($null -ne $reasoningEnabled) {
    Add-PresetLine $lines 'reasoning' ($(if ($reasoningEnabled) { 'on' } else { 'off' }))
  }

  $promptTemplateField = $opFields | Where-Object { $_.key -eq 'llm.prediction.promptTemplate' } | Select-Object -First 1
  if ($promptTemplateField) {
    $templateValue = $promptTemplateField.value
    if ($templateValue.type -eq 'jinja' -and $templateValue.jinjaPromptTemplate.template) {
      New-Item -ItemType Directory -Force -Path $TemplatesDir | Out-Null
      $templatePath = Join-Path $TemplatesDir ("{0}.jinja" -f $Item.id)
      Set-Content -Path $templatePath -Value ([string]$templateValue.jinjaPromptTemplate.template)
      Add-PresetLine $lines 'chat-template-file' $templatePath
    }
  }

  $lines.Add('')
  return $lines
}

foreach ($dir in @($configDir,$modelConfigRoot,$templatesDir,$adminDir,$scriptsDir,$logsDir,$modelsRoot)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

Get-ChildItem (Join-Path $repoRoot 'tools\llama\templates') -File | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $scriptsDir $_.Name) -Force
}
Get-ChildItem (Join-Path $repoRoot 'tools\llama\templates\admin') -File | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $adminDir $_.Name) -Force
}

if (-not $SkipModelMove -and (Test-Path $sourceRoot)) {
  Get-ChildItem $sourceRoot -Directory | ForEach-Object {
    $vendor = $_
    Get-ChildItem $vendor.FullName -Directory | ForEach-Object {
      $modelDir = $_
      $targetVendor = Join-Path $modelsRoot (Split-Path $vendor.FullName -Leaf)
      $targetDir = Join-Path $targetVendor $modelDir.Name
      if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Force -Path $targetVendor | Out-Null
        Move-Item $modelDir.FullName $targetVendor
      }
    }
  }
}

if (Test-Path $lmStudioSourceConfigRoot) {
  Get-ChildItem $lmStudioSourceConfigRoot -Recurse -File -Filter *.json | ForEach-Object {
    $relativePath = $_.FullName.Substring($lmStudioSourceConfigRoot.Length).TrimStart('\\')
    $targetPath = Join-Path $modelConfigRoot $relativePath
    $targetDir = Split-Path -Parent $targetPath
    if (-not (Test-Path $targetPath)) {
      New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
      Copy-Item $_.FullName $targetPath -Force
    }
  }
}

$configMap = @{}
Get-ChildItem $modelConfigRoot -Recurse -File -Filter *.json | ForEach-Object {
  if (-not $configMap.ContainsKey($_.BaseName)) {
    $configMap[$_.BaseName] = $_.FullName
  }
}

$inventory = @()
Get-ChildItem $modelsRoot -Recurse -Filter *.gguf | Group-Object DirectoryName | ForEach-Object {
  $dir = $_.Name
  $files = $_.Group
  $modelFile = $files | Where-Object { $_.Name -notmatch '^mmproj' } | Sort-Object Name | Select-Object -First 1
  if (-not $modelFile) { return }
  $folderName = Split-Path $dir -Leaf
  $modelId = $folderName -replace '-GGUF$',''
  $vision = Test-IsVisionModel "$folderName $($modelFile.Name)"
  $mmprojFile = if ($vision) { $files | Where-Object { $_.Name -match '^mmproj' } | Sort-Object Name | Select-Object -First 1 } else { $null }
  $modelConfigPath = $configMap[$modelFile.Name]
  $modelConfig = $null
  if ($modelConfigPath) {
    $modelConfig = Get-Content -Raw $modelConfigPath | ConvertFrom-Json
  }

  $inventory += [pscustomobject]@{
    id = $modelId
    alias = $modelId
    model = $modelFile.FullName
    mmproj = if ($mmprojFile) { $mmprojFile.FullName } else { $null }
    vision = $vision
    modelConfigPath = $modelConfigPath
    modelConfig = $modelConfig
  }
}
$inventory = $inventory | Sort-Object id

$inventory |
  Select-Object id, alias, model, mmproj, vision, modelConfigPath |
  ConvertTo-Json -Depth 6 |
  Set-Content (Join-Path $configDir 'inventory.json')

$ini = New-Object System.Collections.Generic.List[string]
foreach ($item in $inventory) {
  foreach ($line in (ConvertTo-LlamaPreset -Item $item -TemplatesDir $templatesDir)) {
    $ini.Add($line)
  }
}
Set-Content (Join-Path $configDir 'models.ini') $ini

@{
  host = '127.0.0.1'
  port = 1234
  adminHost = '127.0.0.1'
  adminPort = 1235
  modelsMax = 1
} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $configDir 'runtime.json')

@{
  completion = @{
    temperature = 0.7
    top_k = 40
    top_p = 0.95
    min_p = 0.0
    repeat_penalty = 1.05
  }
} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $configDir 'webui.json')

@(
  @{ id = 'open-webui'; label = 'Open stock WebUI'; command = 'cmd.exe'; args = @('/c','start','http://127.0.0.1:1234'); detached = $true },
  @{ id = 'open-admin'; label = 'Open admin UI'; command = 'cmd.exe'; args = @('/c','start','http://127.0.0.1:1235'); detached = $true },
  @{ id = 'open-logs'; label = 'Open llama logs'; command = 'explorer.exe'; args = @($logsDir); detached = $true }
) | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $configDir 'scripts.json')

[pscustomobject]@{ ok = $true; llamaHome = $llamaHome; models = $inventory.Count } | ConvertTo-Json -Compress
