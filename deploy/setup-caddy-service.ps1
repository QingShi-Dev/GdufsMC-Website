# =============================================================================
# 把 Caddy 装成 Windows 服务 (开机自启 + 当前用户登录后启动)
# =============================================================================
# 用途: 用 NSSM (Non-Sucking Service Manager) 包装 caddy.exe
#   - 不依赖 NSSM 内置服务包装
#   - 失败时回退到 PowerShell sc.exe
#
# 用法: .\setup-caddy-service.ps1
# =============================================================================

$ErrorActionPreference = 'Stop'

# 自动检测 Caddy 路径 (支持 winget / scoop / choco / npm install -g / 手动)
#   - 优先 Get-Command (查 PATH)
#   - 回退常见安装位置
$caddyCmd = Get-Command caddy -ErrorAction SilentlyContinue
if ($caddyCmd) {
    $CaddyPath = $caddyCmd.Source
} else {
    # 常见非 PATH 位置
    $candidates = @(
        'C:\Program Files\Caddy\caddy.exe',          # winget 默认
        'C:\Program Files (x86)\Caddy\caddy.exe',
        'C:\ProgramData\chocolatey\bin\caddy.exe',   # choco
        "$env:USERPROFILE\scoop\apps\caddy\current\caddy.exe",  # scoop
        'C:\caddy\caddy.exe',
        'C:\tools\caddy.exe'
    )
    $CaddyPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $CaddyPath) {
    throw "找不到 caddy.exe。PATH 里没有, 常见位置也不在。请先跑 deploy\setup.ps1 装 Caddy"
}
Write-Host "  Caddy 路径: $CaddyPath"

$ProjectDir = 'H:\GDUFSMC-web'
$CaddyfilePath = Join-Path $ProjectDir 'Caddyfile'
$LogsDir = Join-Path $ProjectDir 'logs'
$ServiceName = 'Caddy'
$ServiceDisplayName = 'Caddy Reverse Proxy'

# 前置检查
if (-not (Test-Path $CaddyfilePath)) {
    throw "Caddyfile 不存在: $CaddyfilePath`n请先 git pull 仓库代码"
}
if (-not (Test-Path (Join-Path $ProjectDir 'secrets.caddy'))) {
    Write-Warning ""
    Write-Warning "⚠️  secrets.caddy 不存在 (在 .gitignore, 不会从 git 拉取)"
    Write-Warning "    Caddy validate 会失败。请先:"
    Write-Warning "      1. Copy-Item .\secrets.caddy.example .\secrets.caddy"
    Write-Warning "      2. 编辑 secrets.caddy, 把 `$2a`14`$REPLACE_WITH_BCRYPT_HASH 换成真密码哈希"
    Write-Warning "      3. 重新跑本脚本"
    Write-Warning ""
    Write-Warning "    继续安装服务? (y/N)"
    $ans = Read-Host
    if ($ans -ne 'y' -and $ans -ne 'Y') {
        throw "已取消, 请先准备 secrets.caddy"
    }
}
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir | Out-Null
}

# NSSM 优先级
$nssm = Get-Command nssm -ErrorAction SilentlyContinue

if ($nssm) {
    # -------- NSSM 路径 (推荐) --------
    Write-Host "==> 使用 NSSM 包装 Caddy"

    # 已存在先卸载
    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  服务已存在, 先停止并卸载"
        nssm stop $ServiceName
        nssm remove $ServiceName confirm
    }

    # 注册服务
    nssm install $ServiceName $CaddyPath
    nssm set $ServiceName AppParameters "run --config `"$CaddyfilePath`""
    nssm set $ServiceName AppDirectory $ProjectDir
    nssm set $ServiceName DisplayName $ServiceDisplayName
    nssm set $ServiceName Description "Reverse proxy + automatic HTTPS for gdufsmc (Caddy)"
    nssm set $ServiceName Start SERVICE_AUTO_START
    nssm set $ServiceName AppStdout (Join-Path $LogsDir 'caddy-stdout.log')
    nssm set $ServiceName AppStderr (Join-Path $LogsDir 'caddy-stderr.log')
    nssm set $ServiceName AppRotateFiles 1                    # 启用轮转
    nssm set $ServiceName AppRotateBytes 10485760             # 10MB 切一个文件
    nssm set $ServiceName AppRotateOnline 1                   # 在线轮转 (不中断服务)

    Write-Host "  注册成功"
    nssm start $ServiceName

} else {
    # -------- sc.exe 路径 (回退) --------
    Write-Host "==> NSSM 未安装, 回退到 sc.exe (功能有限)"

    # PowerShell 创建服务 (二进制路径要转义空格)
    $binPath = "`"$CaddyPath`" run --config `"$CaddyfilePath`""

    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  服务已存在, 先停止并删除"
        Stop-Service -Name $ServiceName -Force
        sc.exe delete $ServiceName
    }

    sc.exe create $ServiceName binPath= $binPath `
        DisplayName= $ServiceDisplayName `
        start= auto
    sc.exe description $ServiceName "Reverse proxy + automatic HTTPS for gdufsmc"

    Start-Service -Name $ServiceName

    Write-Host "  ⚠️ 注意: sc.exe 创建的服务功能有限, 推荐安装 NSSM:"
    Write-Host "     scoop install nssm"
}

Write-Host ""
Write-Host "==> 验证服务状态"
# 直接用 nssm 命令名 (跟 install/set 同款), 不要写 `$nssm status`
#   - PowerShell 解析 `$nssm.status` 想调 CommandInfo 的 status 方法, 报错
#   - 用 `nssm status` 命令名形式让 PowerShell 走 PATH 解析
if (Get-Command nssm -ErrorAction SilentlyContinue) {
    nssm status $ServiceName 2>$null
    if ($LASTEXITCODE -ne 0) {
        Get-Service -Name $ServiceName
    }
} else {
    # NSSM 没装, 直接 Get-Service
    Get-Service -Name $ServiceName
}

Write-Host ""
Write-Host "============================================="
Write-Host "Caddy 服务已安装并启动"
Write-Host ""
Write-Host "  服务名: $ServiceName"
Write-Host "  路径:   $CaddyPath run --config $CaddyfilePath"
Write-Host "  日志:   $LogsDir\caddy-std{out,err}.log"
Write-Host ""
Write-Host "管理命令:"
Write-Host "  Start-Service $ServiceName          # 启动"
Write-Host "  Stop-Service  $ServiceName          # 停止"
Write-Host "  Restart-Service $ServiceName        # 重启"
Write-Host "  Get-Service $ServiceName | Format-List  # 详细状态"
Write-Host "============================================="