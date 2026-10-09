# JobSquad installer for Windows (PowerShell). All arguments are passed to setup.mjs (use --help).
$ErrorActionPreference = 'Stop'
$Kit = Split-Path -Parent $PSScriptRoot

function Test-Node($n) {
  if (-not $n -or -not (Test-Path $n)) { return $false }
  & $n -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>$null
  return $LASTEXITCODE -eq 0
}

$candidates = @($env:JOBSQUAD_NODE, (Get-Command node -ErrorAction SilentlyContinue).Source,
  "$env:USERPROFILE\.openclaw\tools\node\node.exe", "$env:USERPROFILE\.openclaw\tools\cli-node\node.exe")
$Node = $candidates | Where-Object { Test-Node $_ } | Select-Object -First 1
if (-not $Node) {
  Write-Host "No Node 22.13+ found. Install OpenClaw first (it brings Node):"
  Write-Host "  iwr -useb https://openclaw.ai/install.ps1 | iex"
  Write-Host "  openclaw onboard --install-daemon"
  exit 1
}
& $Node "$Kit\install\setup.mjs" @args
exit $LASTEXITCODE
