# =============================================================================
# clean-pm2-daemon.ps1 — 清理跨账号 PM2 daemon 残留 (一次性)
# =============================================================================
# 背景:
#   校园服务器之前用 Administrator 用户跑过 `pm2 start`, 创建的 PM2 daemon
#   进程 + named pipe (\\.\pipe\rpc.sock) 都是 Administrator 账号的。
#   现在 GitHub Actions self-hosted runner 用 NetworkService 启 deploy step,
#   NetworkService 的 pm2 daemon spawn 时发现 named pipe 被占, 连不上。
#
# 症状:
#   [PM2] Spawning PM2 daemon with pm2_home=...
#   pm2.cmd : connect EPERM \\.\pipe\rpc.sock
#
# 修法:
#   - NetworkService 的 pm2 kill 杀不了 Administrator 启的 daemon (跨账号)
#   - 必须用 Administrator PowerShell 手动 taskkill 所有 node 进程
#   - 之后 deploy workflow 跑 pm2 kill 时 (NetworkService) 就能正常清干净
#   - 这个脚本只要跑一次就行, 后续 deploy 流程自给自足
#
# 用法 (Administrator PowerShell):
#   .\deploy\clean-pm2-daemon.ps1
# =============================================================================

$ErrorActionPreference = 'Stop'

Write-Host "==> 1/5 列出当前 PM2 相关进程"
$nodeProcs = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcs) {
    $nodeProcs | Format-Table Id, ProcessName, StartTime -AutoSize
} else {
    Write-Host "  无 node 进程"
}

if ($nodeProcs) {
    Write-Host ""
    Write-Host "==> 2/5 杀所有 node 进程 (包括 Administrator 启的 PM2 daemon + Next.js)"
    Write-Host "    deploy workflow 会重启 Next.js, 短暂 502/1-3 秒"
    Write-Host ""

    # 跳过用户保留 (如果有特殊原因想保留某个 PID, 改这里)
    $nodeProcs | Stop-Process -Force
    Start-Sleep -Seconds 3
    Write-Host "  ✅ 已 kill"
}

Write-Host ""
Write-Host "==> 3/5 清 PM2_HOME 残留"
$pm2Homes = @(
    "$env:USERPROFILE\.pm2",                                           # 当前 shell 用户
    'C:\Windows\ServiceProfiles\NetworkService\.pm2',                  # NetworkService
    'C:\Windows\ServiceProfiles\LocalService\.pm2',                    # LocalService
    'C:\Windows\System32\config\systemprofile\.pm2'                   # LocalSystem
)
foreach ($h in $pm2Homes) {
    if (Test-Path $h) {
        Remove-Item -Recurse -Force $h -ErrorAction SilentlyContinue
        Write-Host "  ✅ 清: $h"
    }
}

Write-Host ""
Write-Host "==> 4/5 重启 GitHub Runner 服务 (清 named pipe 残留)"
$runnerSvc = Get-Service | Where-Object { $_.Name -like 'actions.runner.*' } | Select-Object -First 1
if ($runnerSvc) {
    Restart-Service $runnerSvc.Name -Force
    Write-Host "  ✅ 重启: $($runnerSvc.Name)"
} else {
    Write-Host "  ⚠️ 找不到 actions.runner.* 服务"
}

Write-Host ""
Write-Host "==> 5/5 验证"
Start-Sleep -Seconds 3
$remaining = Get-Process node -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "  ⚠️ 还有 node 进程: $($remaining.Id -join ', ')"
} else {
    Write-Host "  ✅ 无 node 残留"
}

Write-Host ""
Write-Host "============================================="
Write-Host "清理完成"
Write-Host ""
Write-Host "下一步: push 触发 deploy workflow"
Write-Host "  - deploy step 会 NetworkService spawn 新 pm2 daemon"
Write-Host "  - 同账号, named pipe 跟 ACL 都对, 不再 EPERM"
Write-Host "  - 后续每次 deploy 自动 pm2 kill, 自给自足"
Write-Host "============================================="