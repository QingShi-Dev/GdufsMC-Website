#!/usr/bin/env bash
# gdufsmc-install-cert.sh
# 拿 Let's Encrypt 证书 — 假设 DNS 已经解析到本机
#
# 用法: sudo bash install-cert.sh your-domain.com

set -euo pipefail

DOMAIN=${1:?"用法: $0 your-domain.com"}

if [ "$(id -u)" -ne 0 ]; then
  echo "需要 root 权限"
  exit 1
fi

# 验证 DNS 已经解析了
echo "==> 检查 DNS: ${DOMAIN} → $(getent hosts "${DOMAIN}" 2>/dev/null | awk '{print $1}' || echo '未解析')"
RESOLVED_IP=$(getent hosts "${DOMAIN}" 2>/dev/null | awk '{print $1}' | head -1 || true)
PUBLIC_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "unknown")

if [ -z "$RESOLVED_IP" ]; then
  echo "ERROR: 域名 ${DOMAIN} 没解析到任何 IP"
  echo "请先把 A 记录指到本机公网 IP: ${PUBLIC_IP}"
  exit 1
fi

if [ "$RESOLVED_IP" != "$PUBLIC_IP" ]; then
  echo "WARNING: DNS 解析到 ${RESOLVED_IP}, 本机公网 IP ${PUBLIC_IP}"
  echo "Let's Encrypt 验证会失败, 继续? (5s 后自动继续, Ctrl+C 取消)"
  sleep 5
fi

# 准备 certbot webroot 目录
mkdir -p /var/www/certbot

# nginx 临时给 80 端口开个豁口 (certbot standalone 需要)
# 我们用 webroot 方式, 不需要停 nginx
echo "==> 用 certbot webroot 拿证书 (不需要停 nginx)"
certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" -d "www.${DOMAIN}" \
  --non-interactive --agree-tos --register-unsafely-without-email \
  || {
    echo "certbot 失败, 改用 nginx 插件试一次"
    certbot --nginx -d "$DOMAIN" -d "www.${DOMAIN}" \
      --non-interactive --agree-tos --register-unsafely-without-email
  }

# 自动续期 (certbot 装的时候已经加 cron, 这里加个保险)
echo "==> 测试自动续期"
certbot renew --dry-run

# reload nginx 加载新证书
nginx -t && systemctl reload nginx

echo ""
echo "=========================================="
echo "证书申请成功!"
echo "=========================================="
echo "证书路径: /etc/letsencrypt/live/${DOMAIN}/"
echo "  - fullchain.pem   (证书链, nginx ssl_certificate 用)"
echo "  - privkey.pem     (私钥, nginx ssl_certificate_key 用)"
echo ""
echo "自动续期: certbot.timer (systemd)"
echo "查看: systemctl list-timers | grep certbot"
echo ""
echo "下一步: 部署代码"
echo "  本地: bash deploy/app-deploy.sh ubuntu@<server-ip> /opt/gdufsmc"
