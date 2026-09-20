# 校园服务器一次性初始化指南

> 适用：在国内校园网部署 gdufsmc-site（Next.js 16），使用 GitHub Actions 自托管 Runner + Caddy 反代。
> 域名：`gdufscraft.top` + `www.gdufscraft.top`
> **服务器部署目录：`H:\GDUFSMC-web`**

---

## 0. 前置条件

- 校园服务器一台（Windows Server 2019+ 或 Windows 10+）
- 至少 **2GB RAM**（map build 期间 PM2 + Caddy + Runner 全跑）
- 至少 **20GB 磁盘**（`node_modules/` + `.next/` + `content/` + 日志）
- **H 盘**（Windows Server 安装时第二个盘符，C 盘系统盘 + D 盘可能是光驱/恢复，H 盘稳）
- **公网 IP**（校园 IT 给的固定 IP，**没有公网 IP 整个迁移方案不可行**）
- **DNS 解析**：
  - `gdufscraft.top` A 记录 → 公网 IP
  - `www.gdufscraft.top` CNAME → `gdufscraft.top`
- DNS 解析必须**先于**首次启动 Caddy（Caddy 走 Let's Encrypt HTTP-01 验证需要 80 端口入站 + DNS 已解析）

---

## 1. 服务器初始化（在校园服务器上）

### 1.1 创建项目目录

```powershell
# 用 Administrator 登录
mkdir H:\GDUFSMC-web
mkdir H:\GDUFSMC-web\logs
```

### 1.2 安装依赖软件

```powershell
# 用 winget（Windows 11 / Server 2022 自带）
winget install OpenJS.NodeJS.LTS
winget install CaddyServer.Caddy
npm install -g pnpm pm2

# 验证
node --version   # 期望 v22.x
pnpm --version
pm2 --version
caddy version    # 期望 v2.x
```

### 1.3 防火墙规则

```powershell
# 入站：浏览器用户访问 (Caddy 监听)
New-NetFirewallRule -DisplayName "Caddy HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "Caddy HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow

# 出站：默认已放行（GitHub Runner / Caddy ACME / npm 都走 443 出站）
# 如学校有出站限制，需要额外放行：
#   - 443/TCP 出站 → GitHub Actions runner
#   - 80/TCP 出站 → Let's Encrypt ACME 验证
#   - 53/UDP 出站 → DNS 解析
```

---

## 2. 第一次部署（冷启动）

### 2.1 克隆代码

```powershell
cd H:\GDUFSMC-web
git clone https://github.com/QingShi-Dev/GdufsMC-Website.git .
```

### 2.2 安装依赖 + 构建

```powershell
pnpm install --frozen-lockfile --prod
pnpm run build

# 验证产物
dir .next  # 应该有 BUILD_ID, server/, static/ 等目录
```

### 2.3 启动 PM2（Next.js 后端）

```powershell
pm2 start deploy/ecosystem.config.js
pm2 save

# 验证
pm2 status       # 期望看到 gdufsmc 在线
curl http://127.0.0.1:3000/                    # HTTP 200
curl http://127.0.0.1:3000/api/server-status  # JSON 响应
```

### 2.4 启动 Caddy（反代 + HTTPS）

```powershell
# 第一次手动跑（前台运行，看 HTTPS 证书申请是否成功）
& "C:\Program Files\Caddy\caddy.exe" run --config H:\GDUFSMC-web\Caddyfile

# 预期看到：
#   - "obtained certificate" for gdufscraft.top
#   - "obtained certificate" for www.gdufscraft.top
#   - "serving HTTPS on :443"
# Ctrl+C 退出

# 验证证书位置
dir "C:\ProgramData\Caddy\.local"  # 或 %APPDATA%\Caddy
dir "C:\ProgramData\Caddy\acme"
```

### 2.5 装 Caddy 为 Windows 服务

```powershell
# 装 NSSM（包装任意 exe 为 Windows 服务）
scoop install nssm
# 或 choco install nssm

# 用项目自带的脚本（推荐）
.\deploy\setup-caddy-service.ps1

# 或手动
nssm install Caddy "C:\Program Files\Caddy\caddy.exe"
nssm set Caddy AppParameters "run --config H:\GDUFSMC-web\Caddyfile"
nssm set Caddy AppDirectory "H:\GDUFSMC-web"
nssm set Caddy DisplayName "Caddy"
nssm set Caddy Description "Reverse proxy for gdufsmc (Caddy)"
nssm set Caddy Start SERVICE_AUTO_START
nssm set Caddy AppStdout "H:\GDUFSMC-web\logs\caddy-stdout.log"
nssm set Caddy AppStderr "H:\GDUFSMC-web\logs\caddy-stderr.log"
nssm start Caddy

# 验证
nssm status Caddy
Get-Service Caddy
```

---

## 3. 注册 GitHub Actions Runner

### 3.1 在 GitHub 上获取 Token

1. 打开 `https://github.com/QingShi-Dev/GdufsMC-Website/settings/actions/runners/new`
2. 选 OS = **Windows**，Architecture = **x64**
3. 记下页面上显示的 `--token Axxxxxxxxxxxxxxxxxxxxxxx` 和 runner 版本号

### 3.2 下载并配置 Runner

```powershell
# 在校园服务器上
mkdir C:\actions-runner
cd C:\actions-runner

# 下载（用 GitHub 给的版本号）
$version = "2.319.1"  # ← 替换成 GitHub 当前显示的版本
Invoke-WebRequest -Uri "https://github.com/actions/runner/releases/download/v$version/actions-runner-win-x64-$version.zip" -OutFile "runner.zip"
Expand-Archive runner.zip -DestinationPath .

# 配置（用第 3.1 步拿到的 token）
.\config.cmd --url https://github.com/QingShi-Dev/GdufsMC-Website `
            --token <TOKEN> `
            --runnergroup default `
            --labels "self-hosted,windows,gdufsmc" `
            --name "gdufsmc-campus" `
            --work "_work"

# 期望看到: "Settings saved." 和 "Runner successfully added"
```

### 3.3 装成 Windows 服务

```powershell
.\svc.sh install    # 用当前用户登录后启动
.\svc.sh start

# 验证
Get-Service | Where-Object { $_.Name -like "actions.runner.*" }
```

`https://github.com/QingShi-Dev/GdufsMC-Website/settings/actions/runners` 应该看到 `gdufsmc-campus` Runner 状态是 **Idle**（绿色）。

---

## 4. 首次验证

### 4.1 浏览器访问

| URL | 期望结果 |
|-----|---------|
| `https://gdufscraft.top/` | Next.js 主页，HTTP 200 |
| `https://www.gdufscraft.top/` | 自动跳转到 `https://gdufscraft.top/` |
| `https://gdufscraft.top/map` | 地图页 |
| `https://gdufscraft.top/api/server-status` | JSON 响应 |
| `https://gdufscraft.top/admin/` | Basic Auth 弹窗 |

### 4.2 Basic Auth 登录

- 用户名：`admin`
- 密码：Caddyfile 里配置的密码（部署前在开发机生成 bcrypt 哈希）

### 4.3 Sveltia CMS 测试

1. 登录 Sveltia CMS 后能编辑 content/news/ 或 content/leaderboard/ 的某条
2. 改一行文字，点 Publish
4. Sveltia 通过 PAT commit + push 到 main
6. 看 GitHub Actions 是否自动触发 deploy workflow
7. 等 1-3 分钟，刷新网站看到新内容

---

## 5. 触发一次 GitHub Actions 部署

### 5.1 触发方式

**方式 A**：开发机推送

```powershell
# 在开发机 (Windows PowerShell)
cd G:\Project\NodeProject\gdufsmc-site-dev
# 改一行字测试，比如 content/news/xxx.md
git add .
git commit -m "test:触发 deploy workflow"
git push origin main

# GitHub Actions Runner 在校园服务器 (H:\GDUFSMC-web) 收到任务:
#   1. checkout 代码
#   2. 同步 build artifact 到 H:\GDUFSMC-web
#   3. pnpm install --prod
#   4. PM2 restart gdufsmc
#   5. 健康检查
#   6. 如果 Caddyfile 变了, reload Caddy
```

**方式 B**：手动触发

1. 打开 `https://github.com/QingShi-Dev/GdufsMC-Website/actions/workflows/deploy.yml`
2. 点 "Run workflow" → 选 main → 点绿色按钮

### 5.2 监控部署

`https://github.com/QingShi-Dev/GdufsMC-Website/actions` 应该看到：

- ✅ Checkout code
- ✅ Setup Node.js 22
- ✅ Install dependencies
- ✅ Build Next.js
- ✅ Sync favicon
- ✅ Restart PM2
- ✅ Health check

如果哪步失败，看该 step 的日志定位。

---

## 6. 日常运维

### 6.1 监控命令速查

```powershell
# PM2 状态
pm2 status
pm2 logs gdufsmc --lines 200

# Caddy 状态
nssm status Caddy
Get-Content H:\GDUFSMC-web\logs\caddy-stderr.log -Tail 50

# GitHub Runner 状态
Get-Service | Where-Object { $_.Name -like "actions.runner.*" }
# GitHub 网页: https://github.com/QingShi-Dev/GdufsMC-Website/settings/actions/runners

# 磁盘空间
Get-PSDrive C

# 内存
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10
```

### 6.2 日志位置

所有日志都在项目目录 `H:\GDUFSMC-web\logs\` 下，统一管理。

| 日志 | 路径 | 大小限制 |
|------|------|---------|
| PM2 综合 | `H:\GDUFSMC-web\logs\gdufsmc-combined.log` | PM2 默认 10MB 切 |
| PM2 错误 | `H:\GDUFSMC-web\logs\gdufsmc-error.log` | 同上 |
| PM2 输出 | `H:\GDUFSMC-web\logs\gdufsmc-out.log` | 同上 |
| Caddy stdout | `H:\GDUFSMC-web\logs\caddy-stdout.log` | NSSM 轮转 10MB |
| Caddy stderr | `H:\GDUFSMC-web\logs\caddy-stderr.log` | 同上 |
| Caddy 访问 | `H:\GDUFSMC-web\logs\caddy-access.log` | Caddy 滚 10MiB 保 5 |
| GitHub Runner | `C:\actions-runner\_diag\*.log` | Runner 默认 100MB |

> 注意：`C:\actions-runner\` 是 GitHub Runner 安装目录，**不在项目目录**，但跟项目目录同台机器上。

### 6.3 备份策略

每周备份：

```powershell
# 备份项目数据（排除 node_modules + .next + logs）
Compress-Archive -Path H:\GDUFSMC-web\* `
    -DestinationPath C:\backup\gdufsmc-$(Get-Date -Format 'yyyy-MM-dd').zip `
    -CompressionLevel Optimal `
    -Force `
    -Exclude "node_modules",".next","logs","*.log"

# 备份 Caddy 证书（自动恢复部署时不用重申请）
Copy-Item -Recurse "C:\ProgramData\Caddy" "C:\backup\caddy-data-$(Get-Date -Format 'yyyy-MM-dd')"
```

Git history 在 GitHub 上，**不需要单独备份**。

### 6.4 更新证书（手动）

Caddy 90 天自动续期，但如需手动：

```powershell
& "C:\Program Files\Caddy\caddy.exe" reload --config H:\GDUFSMC-web\Caddyfile --force
```

### 6.5 回滚代码

```powershell
cd H:\GDUFSMC-web
git log --oneline -10
git checkout <commit-hash>
pnpm run build
pm2 restart gdufsmc
```

---

## 7. 故障排查

### 7.1 浏览器访问超时

```powershell
# 1. DNS 解析对吗
nslookup gdufscraft.top

# 2. Caddy 跑着吗
nssm status Caddy
& "C:\Program Files\Caddy\caddy.exe" run --config H:\GDUFSMC-web\Caddyfile  # 前台跑看错误

# 3. 防火墙开了吗
Get-NetFirewallRule | Where-Object { $_.DisplayName -like "Caddy*" }

# 4. PM2 跑着吗
pm2 status
curl http://127.0.0.1:3000/
```

### 7.2 GitHub Runner 不工作

```powershell
# Runner 服务状态
Get-Service | Where-Object { $_.Name -like "actions.runner.*" }

# Runner 日志
Get-Content C:\actions-runner\_diag\Runner_*.log -Tail 100

# 重启 Runner
Stop-Service "actions.runner.*"
Start-Service "actions.runner.*"

# 看 GitHub 网页状态: https://github.com/QingShi-Dev/GdufsMC-Website/settings/actions/runners
```

### 7.3 部署后 502 Bad Gateway

PM2 没起来或端口不对：

```powershell
pm2 status
pm2 logs gdufsmc --err --lines 100
pm2 restart gdufsmc
```

### 7.4 HTTPS 证书没申请成功

```powershell
# 看 Caddy 日志
Get-Content H:\GDUFSMC-web\logs\caddy-stderr.log -Tail 100

# 常见原因:
#   - DNS 没解析 (用 nslookup 检查)
#   - 80 端口被防火墙拦 (certbot ACME 验证需要 80 入站)
#   - Caddy 数据目录权限 (用管理员运行)
```

### 7.5 内存不够 build 失败

```powershell
# 看内存
Get-Counter "\Memory\Available MBytes"

# 临时关停 PM2 释放内存
pm2 stop gdufsmc
pnpm run build
pm2 start gdufsmc
```

---

## 8. 关键文件位置速查

### 8.1 项目目录 `H:\GDUFSMC-web`

```
H:\GDUFSMC-web\                                 ← 项目根 (服务器部署目录)
├── Caddyfile                                ← Caddy 配置（反代 + HTTPS + basic auth）
├── app/  components/  lib/                  ← Next.js 源码
├── content/                                 ← Markdown/YAML 内容数据
├── public/                                  ← 静态资源（图片、图标）
├── .next\                                   ← 构建产物（git ignore，每次部署重新生成）
├── node_modules\                             ← 依赖（git ignore）
├── logs\                                    ← 所有日志（git ignore）
│   ├── gdufsmc-combined.log                ← PM2 综合
│   ├── gdufsmc-error.log                   ← PM2 错误
│   ├── gdufsmc-out.log                     ← PM2 输出
│   ├── caddy-stdout.log                    ← Caddy stdout
│   ├── caddy-stderr.log                    ← Caddy stderr
│   └── caddy-access.log                    ← Caddy 访问日志
├── app\favicon.ico                          ← favicon 静态服务（Caddy /favicon.ico 用）
└── deploy\                                  ← 部署配置（git 跟踪）
    ├── ecosystem.config.js                 ← PM2 配置（跨平台）
    ├── setup.ps1                           ← 服务器初始化脚本
    ├── setup-caddy-service.ps1             ← Caddy 装 Windows 服务
    ├── README.md                           ← 部署手册
    └── WINDOWS-SERVER-SETUP.md            ← 本文档
```

### 8.2 系统级目录（不在项目目录）

```
C:\actions-runner\                          ← GitHub Runner 目录（系统级）
├── _diag\                                   ← Runner 诊断日志
├── _work\                                   ← Runner 工作目录（job 临时文件，部署后清理）
├── runner.zip                              ← Runner 安装包（首次）
├── *.cmd / *.sh                            ← Runner 可执行脚本
└── config / .runner                         ← Runner 配置

C:\Program Files\Caddy\caddy.exe            ← Caddy 可执行文件
C:\ProgramData\Caddy\                       ← Caddy 数据 + 自动续期的证书
├── acme\                                    ← Let's Encrypt 证书
└── ocsp\                                    ← OCSP 缓存

C:\Users\Administrator\.ssh\                 ← SSH 密钥（GitHub Runner 走 443 出站不需要，但保留）

C:\backup\                                   ← 备份目录（手动创建，每周备份到这里）
├── gdufsmc-<日期>.zip                       ← 项目数据 + 配置 + content
└── caddy-data-<日期>\                      ← Caddy 证书备份
```

---

## 9. 卸载（如需迁移到新服务器）

```powershell
# 停所有服务
Stop-Service Caddy
pm2 delete gdufsmc
Stop-Service "actions.runner.*"

# 卸载服务
nssm remove Caddy confirm
.\svc.sh uninstall

# 清理
Remove-Item -Recurse H:\GDUFSMC-web
Remove-Item -Recurse C:\actions-runner
Remove-Item -Recurse "C:\ProgramData\Caddy"

# 取消 GitHub Runner 注册
# https://github.com/QingShi-Dev/GdufsMC-Website/settings/actions/runners
# 点对应 runner 的 Remove 按钮

# 同时删除 DNS A 记录 (避免 DNS 还指向空服务器)
```

---

## 10. 关键参数速查

| 参数 | 值 |
|------|-----|
| 项目部署目录 | `H:\GDUFSMC-web` |
| GitHub Runner 目录 | `C:\actions-runner` |
| Next.js 端口 | 3000 (反代) |
| Caddy 端口 | 80 (HTTP) + 443 (HTTPS) |
| GitHub Runner 标签 | `self-hosted`, `windows`, `gdufsmc` |
| 主域 | `gdufscraft.top` |
| www 重定向 | `www.gdufscraft.top` → `gdufscraft.top` (301) |
| Basic auth 路径 | `/admin/*` |
| Caddy 自动 HTTPS | Let's Encrypt (90天自动续期) |
| 防火墙入站 | 80, 443 |
| 防火墙出站 | 443 (默认开放) |
| 项目数据存储 | `H:\GDUFSMC-web\content\` (git 跟踪) |
| 部署触发 | `git push origin main` → GitHub Actions 自动 build |

---

## 11. 参考文档

- [Caddy 官方文档](https://caddyserver.com/docs/)
- [PM2 Windows 文档](https://pm2.keymetrics.io/docs/usage/process-container/)
- [GitHub Actions self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners)
- [NSSM - the Non-Sucking Service Manager](https://nssm.cc/)

---

## 10. 参考文档

- [Caddy 官方文档](https://caddyserver.com/docs/)
- [PM2 Windows 文档](https://pm2.keymetrics.io/docs/usage/process-container/)
- [GitHub Actions self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners)
- [NSSM - the Non-Sucking Service Manager](https://nssm.cc/)