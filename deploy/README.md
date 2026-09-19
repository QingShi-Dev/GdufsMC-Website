# gdufsmc-site 部署手册

针对 **阿里云香港 ECS / Ubuntu 22.04 / 2c0.5g / Let's Encrypt** 优化。

## 文件清单

| 文件 | 作用 | 跑在哪 |
|------|------|--------|
| `setup.sh` | 一次性初始化（装包 + 加 swap + 防火墙） | **服务器** |
| `install-cert.sh` | 拿 Let's Encrypt 证书 | **服务器** |
| `nginx.conf.template` | nginx 配置（用 `$DOMAIN` 占位） | setup 时复制到 `/etc/nginx/sites-available/gdufsmc` |
| `ecosystem.config.js` | PM2 启动配置 | 服务器 `/opt/gdufsmc/deploy/` |
| `app-deploy.sh` | 部署代码（本地 build + rsync） | **本地** |

## 一次性流程

```bash
# 1. 本地: 把 deploy/ 整个目录 scp 到服务器临时目录
scp -r deploy/ ubuntu@<server-ip>:/tmp/gdufsmc-deploy/

# 2. 服务器: 跑初始化
ssh ubuntu@<server-ip>
sudo bash /tmp/gdufsmc-deploy/setup.sh your-domain.com

# 3. 把域名 A 记录指到服务器公网 IP（去 DNS 厂商控制台）
#    等 1-5 分钟 DNS 生效

# 4. 服务器: 拿证书
sudo bash /tmp/gdufsmc-deploy/install-cert.sh your-domain.com

# 5. 本地: 部署代码
bash deploy/app-deploy.sh ubuntu@<server-ip> /opt/gdufsmc
```

## 之后再部署

代码改了之后:

```bash
# 本地
bash deploy/app-deploy.sh ubuntu@<server-ip> /opt/gdufsmc
```

## 关键设计

### 为什么本地 build
0.5g 机器 build Next.js 必 OOM（V8 默认堆上 1.5g）。**本地 build + rsync 产物** 是唯一稳的方案。

### 为什么 2GB swap
不只是给 build 兜底——npm install、git clone 大仓库、甚至 `pnpm audit` 都会瞬时吃内存。swap 是低内存机器的标配。

### 为什么 nginx 直接发静态资源
- `/images/*`（地图照片） + `/icons/*`（图标） + `/_next/static/*`（hash 文件名）都是 immutable，nginx 直接发省 Node 一层
- `/sw.js` 必须 `no-cache`（service worker 更新机制）
- CSP 等响应头由 Next.js 决定，nginx 不重复加（避免和 next.config.ts 冲突）

### PM2 单实例 fork
- 0.5g 内存撑不起 cluster 多实例
- fork + max_memory_restart 350M 是这个规格的甜点

### proxy 走 IP 而非域名
rate limit 用 `x-forwarded-for`，nginx 一定要把这个 header 传上去（已在 nginx.conf 配置里）。

## 安全（按层防御）

### Layer 1: GitHub 仓库
- **公开仓库 + branch protection on main**（强制 PR + 1 reviewer + status checks + admin 也遵守）
- OAuth App（短期 token，不存 PAT）
- 即使 token 泄露也只能开 PR，admin review 拦截

### Layer 2: /admin 路径（nginx 三层防护）
`/admin/` 是 CMS 后台入口，配置在 `nginx.conf.template`：

| 层 | 措施 | 防什么 |
|---|------|------|
| 1 | **basic auth**（`.htpasswd`，bcrypt） | 密码不知道直接 401 |
| 2 | **IP 白名单**（默认 `deny all`，用户手动填 `allow <IP>` 放开） | 用户 IP 限定 |
| 3 | **limit_req** 10r/s + burst 20 | 暴力爆破失败 |
| + | **fail2ban** `[nginx-admin-auth]` jail | 401 超过 10 次 ban 1h |

**用户 IP 变了怎么办**：用密码登录（basic auth 是主防线，不依赖 IP）。
**admin 凭据**：setup.sh 自动生成 32 字节随机密码 + bcrypt，仅显示一次。后续 `sudo htpasswd -B /etc/nginx/.htpasswd admin` 重置。

### Layer 3: SSH 防护
- **fail2ban `[sshd]` jail**：5 次失败 ban 24h
- **SSH key-only**：`PasswordAuthentication no`（setup.sh 自动改），只允许密钥登录
- **ufw 防火墙**：仅开 22/80/443

### Layer 4: 响应头（Next.js 配置）
`next.config.ts` 的 `SECURITY_HEADERS` 数组应用到 `:path*`（全站）：

- `Content-Security-Policy`：`default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; ...`（防 XSS 偷 token）
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`（强制 HTTPS）
- `X-Frame-Options: DENY`（防 clickjacking）
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`

nginx 也加同样头（defense in depth）+ `server_tokens off`（隐藏 nginx 版本）。

### 完整的 `/admin` 访问流程
```
1. 用户访问 https://your-domain.com/admin/
2. nginx 看到路径 /admin/, 走 location 块:
   a. basic auth: 弹窗要用户名密码 → 用户输
   b. IP 白名单: 用户 IP 不在 allow 列表 → 403 (默认 deny all)
   c. limit_req: 401 失败 10 次 → fail2ban ban IP 1h
3. basic auth + IP 通过 → 反代到 Node → Sveltia CMS UI
4. Sveltia 跳 GitHub OAuth → 用户在 github.com 登录授权
5. GitHub 跳回 /admin/?code=... → Sveltia 用 PKCE 换短期 token (数小时)
6. Sveltia 写内容 → 通过 OAuth token 调 GitHub API
7. GitHub 创建 PR (因为 main 分支 protected) → admin review → merge → Action 部署
```

**任何一层失效，下一层兜底**。攻击者需要同时攻破 basic auth + IP 白名单 + GitHub OAuth + branch protection 才能写入仓库。

### 上线前 checklist
- [ ] GitHub repo 转 public + branch protection on main
- [ ] OAuth App 注册 + Client ID 填到 `public/admin/config.yml`
- [ ] 服务器跑 `setup.sh`，保存打印出来的凭据
- [ ] `curl -I https://your-domain.com` 看响应头（CSP/HSTS/Permissions-Policy 应在）
- [ ] `curl -I https://your-domain.com/admin/` 应返回 401（basic auth 弹窗）
- [ ] 用凭据登录 /admin/，看到 Sveltia CMS
- [ ] 测一次 Sveltia 编辑 → GitHub 创建 PR → Action build → 上线生效

## 监控与排错

```bash
# 实时日志
ssh ubuntu@<server-ip> 'pm2 logs gdufsmc --lines 200'

# 资源监控
ssh ubuntu@<server-ip> 'pm2 monit'

# 重启
ssh ubuntu@<server-ip> 'pm2 restart gdufsmc'

# nginx 错误日志
ssh ubuntu@<server-ip> 'tail -f /var/log/nginx/error.log'

# 证书续期状态
ssh ubuntu@<server-ip> 'certbot certificates'

# 健康检查
curl -I https://your-domain.com
curl https://your-domain.com/api/server-status | head
```

## 升级 / 维护

| 操作 | 步骤 |
|------|------|
| 部署新代码 | 本地 `bash deploy/app-deploy.sh ubuntu@<ip> /opt/gdufsmc` |
| 重启应用 | 服务器 `pm2 restart gdufsmc` |
| 续期证书 | 自动 (certbot.timer), 手动 `certbot renew && systemctl reload nginx` |
| 看访问日志 | `/var/log/nginx/access.log` |
| 看 PM2 日志 | `/var/log/pm2/gdufsmc-combined.log` |
| 完全重置 | 服务器 `rm -rf /opt/gdufsmc && bash /tmp/gdufsmc-deploy/setup.sh domain` |

## 待办（可选优化）

- [ ] 加阿里云 CDN 把 `/images/*` 单独加速
- [ ] 加 GitHub Actions 自动部署（本地 build → 推镜像或文件）
- [ ] 加监控告警（UptimeRobot / 阿里云云监控）
- [ ] 数据库（如果以后加评论 / 用户系统）
