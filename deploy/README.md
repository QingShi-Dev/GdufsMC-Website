# gdufsmc-site 部署手册

## 当前发布方式：GitHub 构建，管理员手动发布

**以下为当前流程。后面的 self-hosted 初始化和服务器构建内容仅为历史参考，不要再次执行，也不要改动现有开机启动服务。**

1. 提交并推送代码到 `main`（本次改造不会自动替你提交或推送）。在 Actions 的 `Build release (manual publish)` 等待安装、类型检查、lint、构建、解包冒烟测试全部通过。
2. 下载该次运行的 `windows-release-...` artifact，在服务器解压到一个新的独立下载目录。应包含 `outputs/*.tar.gz`、同名 `.sha256.txt`、`deploy/publish-release.ps1` 和本说明。只使用自己仓库可信提交生成的包；校验和用于检测损坏，不是来源认证。
3. 用 **WINSERVER08\Administrator 的管理员 PowerShell** 操作。先确认网站当前在 PM2 中 online，且本机 `http://127.0.0.1:3000/` 返回 200。不要从 NETWORK SERVICE 的 Runner 调用发布脚本。
4. 在 artifact 解压目录运行下面的校验/解包命令，再执行发布。

```powershell
$ErrorActionPreference = 'Stop'
$archives = @(Get-ChildItem .\outputs\*.tar.gz)
if ($archives.Count -ne 1) { throw 'Expected exactly one archive' }
$archive = $archives[0]
$id = $archive.Name -replace '\.tar\.gz$', ''
$expected = ((Get-Content -LiteralPath ".\outputs\$id.sha256.txt" -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath $archive.FullName -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'SHA256 mismatch; stop here' }
$incoming = "H:\GDUFSMC-web\incoming\$id"
if (Test-Path -LiteralPath $incoming) { throw 'Use a fresh incoming directory' }
New-Item -ItemType Directory -Path $incoming | Out-Null
tar -xzf $archive.FullName -C $incoming
if ($LASTEXITCODE -ne 0) { throw 'Archive extraction failed' }
$manifest = Get-Content "$incoming\release.json" -Raw | ConvertFrom-Json
$nodeVersion = (& 'C:\Program Files\nodejs\node.exe' --version).Trim().TrimStart('v')
if ($nodeVersion -ne $manifest.nodeVersion) { throw 'Node version differs from release; align versions before publishing' }
& .\deploy\publish-release.ps1 -ReleaseDirectory $incoming
```

工作流固定的 Node/pnpm 版本必须确实可下载；生产 Node 必须与发布清单中的版本完全一致。不要为通过校验直接替换正在运行的 Node；先核实服务器实际版本，再统一构建配置及运行时。首次构建和真实发布尚需在实际环境验证。

发布脚本会先在临时回环端口验证新包，再切换 `gdufsmc` 并检查首页、版本标记；切换失败会尝试恢复旧进程。**切换使用 stop/delete/start，会有短暂停机，不是零停机发布。** 成功后执行 `pm2 save`，不安装或修改开机启动机制，不改 Caddy。其他 PM2 应用不受操作。

成功发布后检查：

```powershell
& 'C:\npm\pm2.cmd' list
Invoke-WebRequest http://127.0.0.1:3000/__release.json -UseBasicParsing
Invoke-WebRequest https://gdufscraft.top/ -UseBasicParsing
```

如需回到上一个版本，在同一管理员会话运行：

```powershell
& .\deploy\publish-release.ps1 -Rollback
```

`H:\GDUFSMC-web\releases` 保留当前和上一个成功版本；只清理状态中明确被淘汰的旧成功版本。失败候选与 `incoming` 下载包保留供排查，不自动清理。首次迁移的旧根目录也保留，不删除它：初次回滚还依赖旧文件。状态与私有 PM2 配置位于 `shared`，可能含环境变量，不要上传或公开。

这次改造将依赖安装和构建移出生产服务器，**不会修复 Realtek 网卡驱动导致的 0x139 蓝屏**，驱动问题仍需单独处理。稳定后可关闭临时 Caddy `debug` 日志。

---

## 历史部署参考（已被上面的发布流程替代）

针对 **Windows Server 2019+ / 校园网 / GitHub Actions self-hosted Runner / Caddy** 的旧流程。

## 文件清单

| 文件 | 作用 | 跑在哪 |
|------|------|--------|
| `Caddyfile` (项目根) | Caddy 反代 + 自动 HTTPS + basic auth | 部署时复制到 `H:\GDUFSMC-web\` |
| `ecosystem.config.js` | PM2 配置 (cwd 自动按 OS 切换) | runner 本机 / 服务器 `H:\GDUFSMC-web/deploy/` |
| `setup.ps1` | Windows 校园服务器一次性初始化 | 服务器 (Administrator) |
| `setup-caddy-service.ps1` | 把 Caddy 装成 Windows 服务 (NSSM) | 服务器 (Administrator) |
| `WINDOWS-SERVER-SETUP.md` | 完整 Windows 服务器迁移指南 | 文档 |

## 一次性流程

```powershell
# 1. 在 GitHub 仓库 Settings → Actions → Runners 创建 self-hosted runner, 拿 token
#    标签: self-hosted, windows, gdufsmc

# 2. 在校园服务器 (Administrator PowerShell) 跑:
cd C:\
Invoke-WebRequest -Uri https://github.com/.../releases/latest/.../actions-runner-win-x64.zip -OutFile runner.zip
Expand-Archive runner.zip -DestinationPath C:\actions-runner
cd C:\actions-runner
.\config.cmd --url https://github.com/QingShi-Dev/GdufsMC-Website --token <TOKEN> --labels "self-hosted,windows,gdufsmc"

# 3. 在服务器上跑 deploy/setup.ps1 (装 Node/Caddy/PM2 + 防火墙 + Runner 服务)
.\deploy\setup.ps1 -Domain gdufscraft.top -RunnerToken "<TOKEN>"

# 4. DNS A 记录: gdufscraft.top → 校园服务器公网 IP, www → CNAME gdufscraft.top
#    等 1-5 分钟 DNS 生效

# 5. 冷启动: clone 代码 + build + 启动
cd H:\GDUFSMC-web
git clone https://github.com/QingShi-Dev/GdufsMC-Website.git .
pnpm install --frozen-lockfile --prod
pnpm run build
pm2 start deploy/ecosystem.config.js
pm2 save
& 'C:\Program Files\Caddy\caddy.exe' run --config H:\GDUFSMC-web\Caddyfile  # 首次前台跑, 看到证书申请成功
.\deploy\setup-caddy-service.ps1  # 装成 Windows 服务

# 6. 浏览器访问:
#    https://gdufscraft.top/                ← 应该返回 Next.js 主页
#    https://gdufscraft.top/admin/          ← 应该弹 basic auth
```

## 之后再部署

```powershell
# 开发机: 改完代码直接 git push
git push origin main
# GitHub Actions 自动跑 → self-hosted runner 在服务器 build + 重启 PM2 + 健康检查
```

## 关键设计

### 为什么 GitHub Actions self-hosted runner
校园网 NAT 没公网 SSH 端口，让 GitHub Runner 跑在服务器上：
- Runner 走 outbound 443 出站 → 校园 NAT 友好
- 不依赖公网 IP / 域名 / SSH
- 直接访问本地文件 (`H:\GDUFSMC-web\`) → build 速度最快
- 取消 SSH secrets (`SERVER_HOST` / `SERVER_USER` / `SSH_PRIVATE_KEY`)

### 为什么 Caddy 替代 nginx
- **自动 HTTPS**: Caddy 内置 ACME 客户端, 无需 certbot + 手动续期
- **零配置反代**: 一行 `reverse_proxy` 替代 nginx 多行 `location`
- **跨平台**: 配置文件 (npm init.d 同步, Windows / Linux 同语法

### 为什么配置都放进项目目录 (`H:\GDUFSMC-web\`)
- **单一目录管理**: 代码 + 配置 + 日志 + 证书备份 都在一处
- **git 跟踪**: Caddyfile / ecosystem.config.js 跟代码一起 versioned
- **迁移简单**: `git clone` 整套, 不用单独 rsync `/etc/`

### PM2 跨平台 (`ecosystem.config.js`)
- 用 `process.platform === 'win32'` 自动选路径
- Linux: `cwd: "/opt/gdufsmc"`, `log_file: "/opt/gdufsmc/logs/..."`
- Windows: `cwd: "H:\\GDUFSMC-web"`, `log_file: "H:\\GDUFSMC-web\\logs\\..."`
- 一份配置, 两套系统都能跑

## 安全（按层防御）

### Layer 1: GitHub 仓库
- 公开仓库 + branch protection on main
- PAT 模式: Sveltia 用户在浏览器粘贴 PAT, 不存仓库
- 即使 token 泄露也只能 commit (PR 模式需审核)

### Layer 2: `/admin` 路径 (Caddy 三层防护)

Caddyfile 配置:
```caddyfile
@adminPath path /admin/*
basicauth @adminPath {
    admin $2a$14$BCRYPT_HASH
}
```

| 层 | 措施 | 防什么 |
|---|------|------|
| 1 | basic auth (bcrypt) | 密码不知道直接 401 |
| 2 | 速率限制 (Caddy rate_limit 模块, 见 Caddyfile 注释) | 暴力爆破失败 |
| 3 | GitHub Actions 只通过 main branch 部署 | PAT 泄露也需 PR |

### Layer 3: 响应头 (next.config.ts + Caddyfile 双层)
- `Content-Security-Policy`: 主页面 `'self' 'unsafe-inline'`, `/admin` 含 `unpkg.com` 给 Sveltia
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`

### Layer 4: Windows 防火墙 (deploy/setup.ps1 自动配)
- 入站: 80/443 (Caddy)
- 出站: 443 (GitHub Runner / Caddy ACME / npm)

### 上线前 checklist
- [ ] GitHub repo 转 public + branch protection on main
- [ ] 服务器跑 `setup.ps1`，保存打印出来的凭据
- [ ] DNS A 记录指向服务器公网 IP
- [ ] 冷启动部署成功 + `curl -I https://gdufscraft.top/` 返回 200
- [ ] `curl -I https://gdufscraft.top/admin/` 返回 401
- [ ] 用凭据登录 /admin/，看到 Sveltia CMS
- [ ] 测一次 Sveltia 编辑 → commit → Action build → 上线生效

## 监控与排错

```powershell
# PM2 状态
pm2 status
pm2 logs gdufsmc --lines 200

# Caddy 状态
nssm status Caddy
Get-Content H:\GDUFSMC-web\logs\caddy-stderr.log -Tail 50

# GitHub Runner 状态
Get-Service | Where-Object { $_.Name -like "actions.runner.*" }
# 或 GitHub 网页: https://github.com/QingShi-Dev/GdufsMC-Website/settings/actions/runners

# 健康检查
curl http://127.0.0.1:3000/
curl http://127.0.0.1:3000/api/server-status
```

## 升级 / 维护

| 操作 | 步骤 |
|------|------|
| 部署新代码 | 开发机 `git push origin main` (GitHub Actions 自动跑) |
| 重启应用 | 服务器 `pm2 restart gdufsmc` |
| 重启 Caddy | 服务器 `nssm restart Caddy` (配置变更自动 reload) |
| HTTPS 续期 | Caddy 自动 (90 天前自动续), 手动 `caddy reload --config Caddyfile` |
| 看访问日志 | `H:\GDUFSMC-web\logs\caddy-access.log` |
| 看 PM2 日志 | `H:\GDUFSMC-web\logs\gdufsmc-combined.log` |
| 完全重置 | 服务器 `rmdir /s /q H:\GDUFSMC-web`, 重新跑 setup.ps1 |

## 待办（可选优化）

- [ ] 加 CDN (Cloudflare / 阿里云) 把 `/images/*` 单独加速
- [ ] 加 UptimeRobot 监控 + 告警
- [ ] 加监控面板 (Grafana / Prometheus)
- [ ] 加评论 / 用户系统 (数据库)