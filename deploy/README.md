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
