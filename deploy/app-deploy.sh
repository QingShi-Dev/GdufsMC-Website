#!/usr/bin/env bash
# gdufsmc-app-deploy.sh
# 部署 Next.js 应用: 同步代码 + 装依赖 + 重启 PM2
#
# 用法 (本地 Windows / macOS / Linux 都行, 需要 bash + rsync + ssh):
#   bash deploy/app-deploy.sh ubuntu@<server-ip> /opt/gdufsmc
#
# 例:
#   bash deploy/app-deploy.sh ubuntu@1.2.3.4 /opt/gdufsmc
#
# 流程:
#   1. 本地 pnpm build (确保产物最新)
#   2. rsync 同步 .next + public + configs (排除 node_modules)
#   3. 服务器上 pnpm install --prod
#   4. PM2 重启

set -euo pipefail

SSH_TARGET=${1:?"用法: $0 <user@host> [remote-dir]   例: $0 ubuntu@1.2.3.4 /opt/gdufsmc"}
REMOTE_DIR=${2:-/opt/gdufsmc}
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 本地目录: ${LOCAL_DIR}"
echo "==> 远端目录: ${SSH_TARGET}:${REMOTE_DIR}"

# 检查本地必要工具
for cmd in pnpm rsync ssh; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: 缺少命令 $cmd"
    exit 1
  fi
done

# 1) 本地 build
echo "==> [1/4] pnpm build (本地, 避免服务器 OOM)"
cd "$LOCAL_DIR"
pnpm build

# 2) rsync 同步 — 排除 node_modules, .git, 开发文件
echo "==> [2/4] rsync 同步 (排除 node_modules / .git / .next/cache)"
RSYNC_EXCLUDES=(
  --exclude='.git'
  --exclude='node_modules'
  --exclude='.next/cache'
  --exclude='.next/dev'
  --exclude='.next/types'
  --exclude='.idea'
  --exclude='*.log'
  --exclude='.env*'
  --exclude='tests'
  --exclude='coverage'
  --exclude='.DS_Store'
)

# 确保远端目录存在
ssh "$SSH_TARGET" "sudo mkdir -p ${REMOTE_DIR} && sudo chown -R \$USER:\$USER ${REMOTE_DIR}"

rsync -avz --delete "${RSYNC_EXCLUDES[@]}" \
  --exclude='.next' \
  "${LOCAL_DIR}/" "${SSH_TARGET}:${REMOTE_DIR}/"

# 单独同步 .next (build 产物, 不删, 因为 server 上首次没有)
echo "==> [3/4] rsync 同步 .next/ (build 产物)"
rsync -avz "${LOCAL_DIR}/.next/" "${SSH_TARGET}:${REMOTE_DIR}/.next/"

# 3) 服务器装依赖
echo "==> [4/4] 服务器装 prod 依赖 + PM2 部署"
ssh "$SSH_TARGET" "set -e
  cd ${REMOTE_DIR}
  pnpm install --prod --frozen-lockfile

  # ecosystem.config.js 是 CommonJS, 在 project root, PM2 直接吃
  pm2 delete gdufsmc 2>/dev/null || true
  pm2 start deploy/ecosystem.config.js
  pm2 save
  sleep 2
  pm2 status
  echo '---'
  echo '健康检查:'
  curl -s -o /dev/null -w 'HTTP %{http_code}  响应时间 %{time_total}s\n' http://127.0.0.1:3000/
  curl -s -o /dev/null -w 'API  /api/server-status: HTTP %{http_code}\n' http://127.0.0.1:3000/api/server-status
"

echo ""
echo "=========================================="
echo "部署完成!"
echo "=========================================="
echo ""
echo "远程操作提示:"
echo "  ssh ${SSH_TARGET} 'pm2 logs gdufsmc'      # 看实时日志"
echo "  ssh ${SSH_TARGET} 'pm2 restart gdufsmc'   # 手动重启"
echo "  ssh ${SSH_TARGET} 'pm2 monit'             # 资源监控"
echo ""
echo "下一步:"
echo "  1. 浏览器访问 https://${REMOTE_DIR##*/}  (前提: 域名已解析 + 证书已装)"
echo "  2. curl -I https://<your-domain> 检查响应头 (CSP / HSTS 应在)"
