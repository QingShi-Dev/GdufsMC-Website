#!/usr/bin/env bash
# gdufsmc-server-setup.sh
# 一次性初始化: 阿里云香港 ECS / Ubuntu 22.04 / 2c0.5g
#
# 用法:
#   1. 把 deploy/ 整个目录 scp 到服务器, 例:
#      scp -r deploy/ ubuntu@your-server:/tmp/gdufsmc-deploy/
#   2. SSH 上服务器
#   3. sudo bash /tmp/gdufsmc-deploy/setup.sh your-domain.com
#
# 之后: 跑 install-cert.sh 拿证书, 再跑 app-deploy.sh 部署代码

set -euo pipefail

DOMAIN=${1:?"用法: $0 your-domain.com   (例: $0 gdufscraft.top)"}

if [ "$(id -u)" -ne 0 ]; then
  echo "需要 root 权限, 用 sudo 跑"
  exit 1
fi

echo "==> [1/6] 加 2GB swap (0.5g RAM 必须有 swap, build 才不会 OOM)"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    swap 创建完成"
else
  echo "    swap 已存在, 跳过"
fi

echo "==> [2/6] apt 更新 + 升级"
apt update -y
apt upgrade -y

echo "==> [3/6] 装 nginx / certbot / curl / git"
apt install -y nginx certbot python3-certbot-nginx curl git ufw

echo "==> [4/6] 装 Node.js 20 (NodeSource)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
else
  echo "    Node 已存在: $(node --version), 跳过"
fi

echo "==> [5/6] 装 pnpm + PM2"
npm install -g pnpm pm2

echo "==> [6/6] 创建 app 目录 + 日志目录 + 写 nginx 配置 + 防火墙"
mkdir -p /opt/gdufsmc
mkdir -p /opt/gdufsmc/logs

# 确保 ubuntu 用户存在 (阿里云某些镜像默认不带)
if ! id ubuntu >/dev/null 2>&1; then
  echo "    ubuntu 用户不存在, 自动创建 (sudo 权限)"
  useradd -m -s /bin/bash ubuntu
  usermod -aG sudo ubuntu
fi

# app 目录归 ubuntu 所有 (PM2 才能写日志)
chown -R ubuntu:ubuntu /opt/gdufsmc
chmod 755 /opt/gdufsmc

# nginx 配置 (用 envsubst 替换 $DOMAIN 占位)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/nginx.conf.template" ]; then
  export DOMAIN
  envsubst '${DOMAIN}' < "$SCRIPT_DIR/nginx.conf.template" > /etc/nginx/sites-available/gdufsmc
  ln -sf /etc/nginx/sites-available/gdufsmc /etc/nginx/sites-enabled/
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  echo "    nginx 配置完成"
else
  echo "    WARNING: 找不到 nginx.conf.template, 跳过 nginx 配置"
fi

# 防火墙
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
echo "    ufw 已开启 22/80/443"

echo "==> [7/9] nginx-security.conf (限流 + 隐藏版本, 放 conf.d/)"
if [ -f "$SCRIPT_DIR/nginx-security.conf" ]; then
  cp "$SCRIPT_DIR/nginx-security.conf" /etc/nginx/conf.d/gdufsmc-security.conf
  nginx -t && systemctl reload nginx
  echo "    nginx-security.conf 已复制, 限流 zones 已生效"
else
  echo "    WARNING: 找不到 nginx-security.conf, 跳过 (admin/API 无限流)"
fi

echo "==> [8/9] /admin 凭据 (basic auth, IP 变了也能登)"
ADMIN_USER="admin"
# 生成 32 字节随机密码 (base64 编码后 ~44 字符, 足够强)
ADMIN_PASS=$(openssl rand -base64 24 2>/dev/null || head -c 24 /dev/urandom | base64)
# 用 htpasswd -B 创建 bcrypt 加密的 .htpasswd (防彩虹表)
# -c: 创建新文件 (覆盖旧)
# -B: bcrypt 加密 (cost=10, 安全)
# -b: 接受命令行密码 (非交互)
if command -v htpasswd >/dev/null 2>&1; then
  htpasswd -B -c -b /etc/nginx/.htpasswd "$ADMIN_USER" "$ADMIN_PASS"
else
  # 兜底: 用 openssl passwd -1 (MD5, 不如 bcrypt 安全, 但 htpasswd 不可用时的备选)
  HASH=$(openssl passwd -apr1 "$ADMIN_PASS")
  echo "$ADMIN_USER:$HASH" > /etc/nginx/.htpasswd
  echo "    WARNING: htpasswd 不可用, 用了 openssl passwd (MD5), 强烈建议装 apache2-utils"
fi
# 权限: nginx worker (www-data) 要能读, 其他用户不能
chmod 640 /etc/nginx/.htpasswd
chown root:www-data /etc/nginx/.htpasswd

# 凭据只在 setup 时显示一次, 用户必须保存
echo ""
echo "============================================"
echo "  /admin 登录凭据 (请保存到密码管理器!)"
echo "  Username: $ADMIN_USER"
echo "  Password: $ADMIN_PASS"
echo "  URL:      https://${DOMAIN}/admin/"
echo ""
echo "  后续要重置密码: sudo htpasswd -B /etc/nginx/.htpasswd ${ADMIN_USER}"
echo "============================================"
echo ""

# nginx 配置已经包含 location /admin/ { auth_basic + limit_req }
# htpasswd 文件就绪后 reload 一次让 nginx 重新读
nginx -t && systemctl reload nginx

echo "==> [9/9] fail2ban (SSH + nginx admin 防爆破)"
apt install -y fail2ban

# 用 jail.local 覆盖默认配置 (apt 升级不会被覆盖)
cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime  = 24h
findtime = 10m
maxretry = 5

[sshd]
enabled  = true
port     = ssh
filter   = sshd
logpath  = /var/log/auth.log

[nginx-admin-auth]
enabled  = true
port     = http,https
filter   = nginx-admin-auth
logpath  = /var/log/nginx/access.log
maxretry = 10
bantime  = 1h
EOF

# nginx-admin-auth filter: 检测 basic auth 失败的 POST/GET 到 /admin/ 的 401 响应
cat > /etc/fail2ban/filter.d/nginx-admin-auth.conf <<'EOF'
[Definition]
failregex = ^<HOST> .* "(GET|POST) /admin/.*" 401
ignoreregex =
EOF

systemctl enable fail2ban
systemctl restart fail2ban
echo "    fail2ban 已启用 ([sshd] + [nginx-admin-auth] jails)"

# SSH key-only (禁密码登录) — 注意: 必须确保你本地有 SSH key 能登, 否则失联
echo "==> SSH 禁密码登录 (必须确保你本地有 SSH key!)"
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%Y%m%d)
sed -i 's/^#*PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*ChallengeResponseAuthentication yes/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
echo "    SSH 已禁密码登录 (之前没配密钥的本地机器会失联, 这步前确认: ssh -i ~/.ssh/id_ed25519 ubuntu@<server> 能登)"

echo ""
echo "=========================================="
echo "初始化完成!"
echo "=========================================="
echo ""
echo "接下来 3 步:"
echo "  1. 把域名 ${DOMAIN} 的 A 记录解析到本机公网 IP"
echo "  2. sudo bash ${SCRIPT_DIR}/install-cert.sh ${DOMAIN}   # 拿 Let's Encrypt 证书"
echo "  3. 本地跑: bash ${SCRIPT_DIR}/app-deploy.sh ubuntu@<server-ip> /opt/gdufsmc"
echo ""
echo "现在 systemd 跑着的服务:"
echo "  - nginx     ($(nginx -v 2>&1 | head -1))"
echo "  - node      $(node --version)"
echo "  - pnpm      $(pnpm --version)"
echo "  - pm2       $(pm2 --version)"
echo "  - fail2ban  $(fail2ban-client --version 2>/dev/null || echo '已装')"
echo ""
echo "安全相关:"
echo "  - /admin: basic auth + IP 白名单 (deny all 默认) + limit_req 10r/s"
echo "  - 凭据见上面打印 (只显示一次, 务必保存)"
echo "  - fail2ban sshd + nginx-admin-auth jail 已启动"
