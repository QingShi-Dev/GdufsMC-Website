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

echo "==> [6/6] 创建 app 目录 + 写 nginx 配置 + 防火墙"
mkdir -p /opt/gdufsmc
chown -R ubuntu:ubuntu /opt/gdufsmc 2>/dev/null || true

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
echo "  - nginx ($(nginx -v 2>&1 | head -1))"
echo "  - node $(node --version)"
echo "  - pnpm $(pnpm --version)"
echo "  - pm2  $(pm2 --version)"
