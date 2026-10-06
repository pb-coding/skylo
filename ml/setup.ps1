$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskRuntime='D:\AI\SkyloBot'
New-Item -ItemType Directory -Force -Path $taskRuntime,"$taskRuntime\runtime","$taskRuntime\cache","$taskRuntime\runs","$taskRuntime\data" | Out-Null
$env:UV_CACHE_DIR="$taskRuntime\cache\uv"
$env:UV_HTTP_TIMEOUT='300'
$env:TEMP="$taskRuntime\cache"
$env:TMP=$env:TEMP
$env:ONNXRUNTIME_NODE_INSTALL='skip'
$env:npm_config_cache="$taskRuntime\cache\npm"
$taskNodeDirectory="$taskRuntime\runtime\node-v24.21.0-win-x64"
if (!(Test-Path "$taskNodeDirectory\node.exe")) {
    $taskZip="$taskRuntime\runtime\node-v24.21.0-win-x64.zip"
    $taskSums="$taskRuntime\runtime\SHASUMS256.txt"
    Invoke-WebRequest https://nodejs.org/dist/v24.21.0/SHASUMS256.txt -OutFile $taskSums
    Invoke-WebRequest https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip -OutFile $taskZip
    $taskExpected=((Get-Content $taskSums | Where-Object {$_ -match ' node-v24.21.0-win-x64.zip$'}) -split '\s+')[0]
    if ((Get-FileHash $taskZip -Algorithm SHA256).Hash.ToLower() -ne $taskExpected) {throw 'Node checksum mismatch'}
    Expand-Archive $taskZip "$taskRuntime\runtime" -Force
}
$env:PATH=$taskNodeDirectory+';'+$env:PATH
if (!(Test-Path "$taskRuntime\.venv\Scripts\python.exe")) {
    $env:UV_PYTHON_INSTALL_DIR="$taskRuntime\runtime\python"
    uv venv "$taskRuntime\.venv" --python 3.13
    if ($LASTEXITCODE -ne 0) {throw 'Python environment setup failed'}
}
uv pip install --python "$taskRuntime\.venv\Scripts\python.exe" 'torch==2.13.0+cu130' --index-url https://download.pytorch.org/whl/cu130
if ($LASTEXITCODE -ne 0) {throw 'CUDA PyTorch installation failed'}
$taskRequirements=if(Test-Path "$PSScriptRoot\requirements-lock.txt"){"$PSScriptRoot\requirements-lock.txt"}else{"$PSScriptRoot\requirements.txt"}
uv pip install --python "$taskRuntime\.venv\Scripts\python.exe" -r $taskRequirements
if ($LASTEXITCODE -ne 0) {throw 'Training dependencies installation failed'}
Push-Location $taskRoot
try {
    npm ci --prefix apps/backend
    if ($LASTEXITCODE -ne 0) {throw 'Backend dependency installation failed'}
    npm run build --prefix apps/backend
    if ($LASTEXITCODE -ne 0) {throw 'Backend build failed'}
} finally {Pop-Location}
& "$taskRuntime\.venv\Scripts\python.exe" -c "import torch; assert torch.cuda.is_available(); print(torch.__version__, torch.cuda.get_device_name(0))"
if ($LASTEXITCODE -ne 0) {throw 'CUDA verification failed'}
