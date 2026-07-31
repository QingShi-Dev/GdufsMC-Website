# gdufsmc app deploy — PowerShell 版 (不需要 WSL / Git Bash)
#
# 用法 (PowerShell):
#   .\deploy\app-deploy.ps1 -SshTarget ubuntu@8.217.163.119
#
# 或绕过执行策略:
#   powershell -ExecutionPolicy Bypass -File deploy/app-deploy.ps1 -SshTarget ubuntu@8.217.119
#
# 依赖 (Windows 10 1809+ 自带):
#   - tar.exe (libarchive, 支持 --exclude)
#   - scp / ssh (OpenSSH 客户端)
#   - pnpm (项目本地已装)
#
# 流程:
#   1. 本地 pnpm build
#   2. tar 打包 (排除 node_modules 等), scp 到服务器 /tmp/
#   3. ssh 到服务器, extract + pnpm install --prod
#   4. PM2 重启 + 健康检查

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SshTarget,
    [string]$RemoteDir = "/opt/gdufsmc"
)

$ErrorActionPreference = "Stop"

# 解析本地项目根目录 (deploy/ 的父目录)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$TarFile = Join-Path $env:TEMP "gdufsmc-deploy.tar.gz"

function Log {
    param([int]$i, [int]$n, [string]$msg)
    Write-Host "==> [$i/$n] $msg"
}

# 0) 前置检查
foreach ($cmd in @('pnpm', 'tar', 'ssh', 'scp')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "缺少命令: $cmd (Windows 10 1809+ / 11 自带, 否则需要安装)"
    }
}

Log 1 4 "pnpm build (local)"
Push-Location $LocalDir
try {
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw "pnpm build 失败" }
} finally {
    Pop-Location
}

Log 2 4 "tar + scp (local → ${SshTarget}:/tmp/)"
# Windows 10+ 自带 tar.exe (libarchive), GNU 兼容的 --exclude 语法
$tarExcludes = @(
    '.git', 'node_modules', '.next/cache', '.next/dev', '.next/types',
    '.idea', 'tests', 'coverage', '*.log', '.env*', 'deploy.tar.gz'
)
$tarArgs = @('-czf', $TarFile)
foreach ($e in $tarExcludes) { $tarArgs += "--exclude=./$e" }
$tarArgs += @('-C', $LocalDir, '.')

& tar @tarArgs
if ($LASTEXITCODE -ne 0) { throw "tar 失败" }

# tarball 大小
$sizeMB = [math]::Round((Get-Item $TarFile).Length / 1MB, 2)
Write-Host "    tarball: $sizeMB MB"

# 上传
& scp $TarFile "${SshTarget}:/tmp/gdufsmc-deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "scp 失败" }
Remove-Item $TarFile -Force

Log 3 4 "extract + pnpm install (remote)"
# 用单行命令 (避免 ssh + heredoc 兼容问题)
$installCmd = "set -e; tar -xzf /tmp/gdufsmc-deploy.tar.gz -C $RemoteDir; cd $RemoteDir; pnpm install --prod --frozen-lockfile 2>&1 | tail -20; echo '--- installed ---'"
& ssh $SshTarget $installCmd
if ($LASTEXITCODE -ne 0) { throw "远程 install 失败" }

Log 4 4 "PM2 restart + health check (remote)"
$startCmd = "set -e; cd $RemoteDir; pm2 delete gdufsmc 2>/dev/null || true; pm2 start deploy/ecosystem.config.js; pm2 save; sleep 3; pm2 status; echo '---'; curl -s -o /dev/null -w 'app:    HTTP %{http_code}  %{time_total}s\n' http://127.0.0.1:3000/; curl -s -o /dev/null -w 'api:    /api/server-status HTTP %{http_code}\n' http://127.0.0.1:3000/api/server-status; rm -f /tmp/gdufsmc-deploy.tar.gz"
& ssh $SshTarget $startCmd
if ($LASTEXITCODE -ne 0) { throw "远程 PM2 启动失败" }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Deploy 完成!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  curl -I https://web-mc.top/  # 验证响应头"
Write-Host "  ssh ${SshTarget} 'pm2 logs gdufsmc'  # 实时日志"
Write-Host "  ssh ${SshTarget} 'pm2 monit'  # 资源监控"
