param([Parameter(ValueFromRemainingArguments=$true)][string[]]$TrainingArguments)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskRuntime = 'D:\AI\SkyloBot'
$env:SKYLO_NODE = Join-Path $taskRuntime 'runtime\node-v24.21.0-win-x64\node.exe'
$env:SKYLO_OUTPUT = Join-Path $taskRuntime 'runs'
$env:UV_CACHE_DIR = Join-Path $taskRuntime 'cache\uv'
$env:TORCH_HOME = Join-Path $taskRuntime 'cache\torch'
$env:MPLCONFIGDIR = Join-Path $taskRuntime 'cache\matplotlib'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:OMP_NUM_THREADS = '4'
$env:OPENBLAS_NUM_THREADS = '1'
$env:TEMP = Join-Path $taskRuntime 'cache'
$env:TMP = $env:TEMP
Push-Location $taskRoot
try {
    & (Join-Path $taskRuntime '.venv\Scripts\python.exe') -u (Join-Path $PSScriptRoot 'train.py') @TrainingArguments
    if ($LASTEXITCODE -ne 0) { throw "Training command failed: $LASTEXITCODE" }
} finally { Pop-Location }
