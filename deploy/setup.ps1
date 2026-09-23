# =============================================================================
# gdufsmc 服务器一次性初始化 (Windows Server 2019+ / Windows 10+)
# =============================================================================
# 用途: 在新校园服务器上跑一次, 装好所有依赖 + 防火墙规则
#
# 用法 (Administrator PowerShell):
#   .\setup.ps1 -Domain gdufscraft.top -RunnerToken "Axxx..."
#
# 注意: 
#   - RunnerToken 从 GitHub 仓库 Settings → Actions → Runners 获取
#   - 必须在校园服务器能解析 github.com 的网络环境跑 (outbound 443 出站)
#   - 域名解析必须先配 DNS A 记录指向服务器 IP, 否则 HTTPS 证书申请失败
# =============================================================================

param(
    [Parameter(Mandatory=$true)][string]$Domain,
    [Parameter(Mandatory=$true)][string]$RunnerToken,
    [string]$ProjectDir = "H:\GDUFSMC-web",
    [string]$RunnerDir = "C:\actions-runner"
)

$ErrorActionPreference = 'Stop'

# -------- 1. 项目目录 --------
Write-Host "==> 1/8 创建项目目录: $ProjectDir"
if (-not (Test-Path $ProjectDir)) {
    New-Item -ItemType Directory -Path $ProjectDir | Out-Null
}
if (-not (Test-Path (Join-Path $ProjectDir 'logs'))) {
    New-Item -ItemType Directory -Path (Join-Path $ProjectDir 'logs') | Out-Null
}

# -------- 2. Node.js 22 LTS --------
Write-Host "==> 2/8 安装 Node.js 22 LTS"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "  node 已装: $(node --version)"
}

# -------- 3. pnpm + pm2 --------
Write-Host "==> 3/8 安装 pnpm + pm2"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    npm install -g pnpm
} else {
    Write-Host "  pnpm 已装: $(pnpm --version)"
}
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    # 用 machine-wide prefix 装 pm2, 不依赖当前用户 (NetworkService / LocalSystem 也找得到)
    npm install -g --prefix "C:\npm" pm2
    pm2-startup install  # Windows: 用 NSSM 装 Windows 服务
} else {
    Write-Host "  pm2 已装: $(pm2 --version)"
}

# 把 npm 全局路径加到系统 PATH (Machine 级别)
#   - setup.ps1 用 --prefix C:\npm 装 pm2, 把 C:\npm 加到 system PATH
#   - 即使装到默认位置 (C:\Users\<user>\AppData\Roaming\npm) 也加上
#   - GitHub Actions runner 服务用 NetworkService, 默认 PATH 不包含这些
$prefixes = @('C:\npm', (& npm config get prefix).Trim()) | Select-Object -Unique
$sysPath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$added = @()
foreach ($p in $prefixes) {
    if ($p -and (Test-Path $p) -and ($sysPath -notlike "*$p*")) {
        $sysPath = "$p;$sysPath"
        $added += $p
    }
}
if ($added.Count -gt 0) {
    [System.Environment]::SetEnvironmentVariable("Path", $sysPath, "Machine")
    $env:Path = $sysPath
    Write-Host "  + 系统 PATH 已加: $($added -join ', ')"
}

# -------- 4. Caddy --------
Write-Host "==> 4/8 安装 Caddy"
if (-not (Get-Command caddy -ErrorAction SilentlyContinue)) {
    # 尝试 winget 装到默认位置
    winget install CaddyServer.Caddy --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "  Caddy 已装: $(caddy version)"
}

# -------- 5. 防火墙规则 --------
Write-Host "==> 5/8 配置防火墙 (入站 80/443)"
$rules = @(
    @{Name="Caddy HTTP"; Port=80}
    @{Name="Caddy HTTPS"; Port=443}
)
foreach ($r in $rules) {
    $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
    if (-not $existing) {
        New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Protocol TCP -LocalPort $r.Port -Action Allow | Out-Null
        Write-Host "  + 添加规则: $($r.Name) (:$($r.Port))"
    } else {
        Write-Host "  规则已存在: $($r.Name)"
    }
}

# GitHub Runner 走 outbound 443 出站 (默认已放行, 学校有出站限制才需要额外规则)

# -------- 6. Defender 排除路径 --------
#   GitHub Actions runner 用 NetworkService 跑 pnpm install / build,
#   Defender 实时保护会拦截 pnpm 在 node_modules 里解压文件报 EPERM,
#   "拒绝访问 (os error 5)" 错误很难定位.
#   整个项目目录 (H:\GDUFSMC-web) 一次性排除最干净, 比子目录白名单维护成本低.
Write-Host "==> 6/8 配置 Defender 排除 (项目目录整路径)"
$defenderExclusion = $ProjectDir  # H:\GDUFSMC-web
$existingExcl = (Get-MpPreference).ExclusionPath
if ($existingExcl -notcontains $defenderExclusion) {
    Add-MpPreference -ExclusionPath $defenderExclusion -ErrorAction SilentlyContinue
    Write-Host "  + 已加 Defender 排除: $defenderExclusion"
} else {
    Write-Host "  已存在 Defender 排除: $defenderExclusion"
}

# -------- 7. GitHub Actions Runner --------
Write-Host "==> 7/8 安装 GitHub Actions Runner"
if (-not (Test-Path $RunnerDir)) {
    New-Item -ItemType Directory -Path $RunnerDir | Out-Null
}
Push-Location $RunnerDir

# 下载最新版 runner (用 GitHub API 拿最新版本号)
try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/actions/runner/releases/latest" -TimeoutSec 10
    $version = $release.tag_name -replace '^v', ''
} catch {
    Write-Warning "GitHub API 获取版本失败, 用固定版本 2.319.1"
    $version = "2.319.1"
}
Write-Host "  Runner 版本: $version"

if (-not (Test-Path ".\config.cmd")) {
    $zip = "actions-runner-win-x64-$version.zip"
    Invoke-WebRequest -Uri "https://github.com/actions/runner/releases/download/v$version/$zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath . -Force
    Remove-Item $zip
}

# 配置 + 装 Windows 服务
.\config.cmd --url https://github.com/QingShi-Dev/GdufsMC-Website --token $RunnerToken --runnergroup default --labels "self-hosted,windows,gdufsmc" --name "gdufsmc-$Domain" --work "_work" --unattended
.\svc.sh install
.\svc.sh start

Pop-Location

# -------- 8. 验证 --------
Write-Host ""
Write-Host "==> 8/8 验证"
Write-Host "  node:    $(node --version)"
Write-Host "  pnpm:    $(pnpm --version)"
Write-Host "  pm2:     $(pm2 --version)"
Write-Host "  caddy:   $(caddy version)"
Write-Host "  Runner:  $(Get-Service | Where-Object { $_.Name -like 'actions.runner.*' } | Select-Object -ExpandProperty Name)"
Write-Host ""

Write-Host "============================================="
Write-Host "初始化完成!"
Write-Host ""
Write-Host "下一步手动操作:"
Write-Host "  1. 把代码克隆到 $ProjectDir:"
Write-Host "     cd $ProjectDir"
Write-Host "     git clone https://github.com/QingShi-Dev/GdufsMC-Website.git ."
Write-Host ""
Write-Host "  2. 创建 secrets.caddy (basic auth 密码, gitignore 不入库):"
Write-Host "     Copy-Item .\secrets.caddy.example .\secrets.caddy"
Write-Host "     编辑 secrets.caddy, 把 `$2a`14`$REPLACE 替换成 bcrypt 哈希"
Write-Host "     生成: node -e \"console.log(require('bcryptjs').hashSync('密码', 14))\""
Write-Host ""
Write-Host "  3. 安装依赖 + 构建:"
Write-Host "     cd $ProjectDir"
Write-Host "     pnpm install --frozen-lockfile --prod"
Write-Host "     pnpm run build"
Write-Host ""
Write-Host "  4. 启动 PM2:"
Write-Host "     pm2 start deploy/ecosystem.config.js"
Write-Host "     pm2 save"
Write-Host ""
Write-Host "  5. 启动 Caddy:"
Write-Host "     & 'C:\Program Files\Caddy\caddy.exe' run --config $ProjectDir\Caddyfile"
Write-Host "     (首次前台跑, 看到 'obtained certificate' 后 Ctrl+C)"
Write-Host "     然后: .\deploy\setup-caddy-service.ps1"
Write-Host ""
Write-Host "  6. 浏览器测试:"
Write-Host "     https://$Domain/"
Write-Host "     https://$Domain/admin/  (弹 basic auth)"
Write-Host "============================================="