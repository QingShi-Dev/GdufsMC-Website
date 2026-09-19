# gdufsmc app deploy - PowerShell version (no WSL / Git Bash required)
#
# Usage:
#   .\deploy\app-deploy.ps1 -SshTarget ubuntu@8.217.163.119
#
# Required (Windows 10 1809+ / 11 built-in):
#   - tar.exe (libarchive, supports --exclude)
#   - scp / ssh (OpenSSH client)
#   - pnpm (project-local)
#
# Flow:
#   1. pnpm build locally
#   2. tar + scp to /tmp/ on server
#   3. SSH to server: extract + pnpm install --prod
#   4. PM2 restart + health check

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SshTarget,
    [string]$RemoteDir = "/opt/gdufsmc"
)

$ErrorActionPreference = "Stop"

# Resolve local project root (parent of deploy/)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$TarFile = Join-Path $env:TEMP "gdufsmc-deploy.tar.gz"

function Log {
    param([int]$i, [int]$n, [string]$msg)
    Write-Host "==> [$i/$n] $msg"
}

# 0) Pre-flight: required commands
foreach ($cmd in @('pnpm', 'tar', 'ssh', 'scp')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $cmd (Windows 10 1809+ ships it; install Git for Windows if older)"
    }
}

Log 1 4 "pnpm build (local)"
Push-Location $LocalDir
try {
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw "pnpm build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

Log 2 4 "tar + scp to ${SshTarget}"
$tarExcludes = @(
    '.git', 'node_modules', '.next/cache', '.next/dev', '.next/types',
    '.idea', 'tests', 'coverage', '*.log', '.env*', 'deploy.tar.gz'
)
$tarArgs = @('-czf', $TarFile)
foreach ($e in $tarExcludes) { $tarArgs += "--exclude=./$e" }
$tarArgs += @('-C', $LocalDir, '.')

& tar @tarArgs
if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }

$sizeMB = [math]::Round((Get-Item $TarFile).Length / 1MB, 2)
Write-Host "    tarball: $sizeMB MB"

& scp $TarFile "${SshTarget}:/tmp/gdufsmc-deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "scp failed (exit $LASTEXITCODE)" }
Remove-Item $TarFile -Force

Log 3 4 "extract + pnpm install (remote)"
$installCmd = "set -e; tar -xzf /tmp/gdufsmc-deploy.tar.gz -C $RemoteDir; cd $RemoteDir; pnpm install --prod --frozen-lockfile 2>&1 | tail -20; echo '--- installed ---'"
& ssh $SshTarget $installCmd
if ($LASTEXITCODE -ne 0) { throw "remote install failed (exit $LASTEXITCODE)" }

# 同步 favicon — Next.js 16 输出到 .next/static/media/favicon.<hash>.ico
# nginx alias 是固定路径 /opt/gdufsmc/app/favicon.ico, 必须 cp 同步, 否则 404
Log "sync favicon (nginx alias needs fixed path)"
$favCmd = "set -e; cd $RemoteDir; mkdir -p app; cp .next/static/media/favicon.*.ico app/favicon.ico; ls -la app/favicon.ico"
& ssh $SshTarget $favCmd
if ($LASTEXITCODE -ne 0) { throw "favicon sync failed (exit $LASTEXITCODE)" }

Log 4 4 "PM2 restart + health check (remote)"
$startCmd = "set -e; cd $RemoteDir; pm2 delete gdufsmc 2>/dev/null || true; pm2 start deploy/ecosystem.config.js; pm2 save; sleep 3; pm2 status; echo '---'; curl -s -o /dev/null -w 'app:    HTTP %{http_code}  %{time_total}s\n' http://127.0.0.1:3000/; curl -s -o /dev/null -w 'api:    /api/server-status HTTP %{http_code}\n' http://127.0.0.1:3000/api/server-status; curl -sI https://web-mc.top/favicon.ico 2>/dev/null | head -1; rm -f /tmp/gdufsmc-deploy.tar.gz"
& ssh $SshTarget $startCmd
if ($LASTEXITCODE -ne 0) { throw "remote start failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Deploy complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  curl -I https://web-mc.top/                 # verify response headers"
Write-Host "  ssh ${SshTarget} 'pm2 logs gdufsmc'         # real-time logs"
Write-Host "  ssh ${SshTarget} 'pm2 monit'                # resource monitor"
