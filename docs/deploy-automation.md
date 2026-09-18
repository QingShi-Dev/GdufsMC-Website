# GitHub Actions 自动部署 — 配置指南

## 一次性配置（3 步）

### 1. 生成专用 SSH key（不要用主登录 key）

在本地终端（**不是服务器**）：

```powershell
ssh-keygen -t ed25519 -C "github-actions-deploy" -f $HOME/.ssh/id_ed25519_gha
# 提示 passphrase 时直接回车 (空)
```

会生成两个文件：
- `id_ed25519_gha` — 私钥（要给 GitHub）
- `id_ed25519_gha.pub` — 公钥（要给服务器）

### 2. 公钥加到服务器

```powershell
# 把公钥内容打印出来
Get-Content $HOME/.ssh/id_ed25519_gha.pub

# 复制整段 (ssh-ed25519 AAAA... 那行)
```

SSH 到服务器：

```bash
ssh ubuntu@<your-server-ip>
```

在服务器上：

```bash
# 把刚复制的公钥追加到 authorized_keys
echo "ssh-ed25519 AAAA... (粘贴你复制的内容)" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

这样 GH Actions 用这把专属 key 访问，不会跟你的日常登录 key 混。

### 3. 在 GitHub repo 配 Secrets

打开 https://github.com/QingShi-Dev/GdufsMC-Website/settings/secrets/actions

点 **"New repository secret"**，加 3 个：

| Name | Value |
|------|-------|
| `SERVER_HOST` | 服务器 IP（如 `1.2.3.4`） |
| `SERVER_USER` | SSH 用户名（如 `ubuntu`） |
| `SSH_PRIVATE_KEY` | 整个 `id_ed25519_gha` 文件的内容（多行，包括头尾的 `-----BEGIN/END-----`） |

> ⚠️ `SSH_PRIVATE_KEY` 粘贴时**整段**，不要漏 `-----BEGIN OPENSSH PRIVATE KEY-----` 和 `-----END OPENSSH PRIVATE KEY-----`。

---

## 触发部署

**自动触发**：Sveltia CMS 编辑 → 点"发布" → commit 到 main → GH Actions 跑 build+deploy → 3-5 分钟上线

**手动触发**：GitHub repo → Actions → "Deploy to production" → Run workflow

---

## 第一次跑前要确认的事

| 检查项 | 怎么验 |
|--------|--------|
| 服务器 `/opt/gdufsmc` 存在 | `ssh ubuntu@<ip> 'ls /opt/gdufsmc'` |
| 服务器已装 pnpm + pm2 | `ssh ubuntu@<ip> 'pnpm -v; pm2 -v'` |
| 服务器有 deploy/ecosystem.config.js | 跟着代码 rsync 一起传过去 |
| nginx 已配反代 3000 → 443 | 跟现有部署一样 |

如果服务器上**还没** `/opt/gdufsmc`，需要先跑一次手动部署：

```bash
bash deploy/app-deploy.sh ubuntu@<ip> /opt/gdufsmc
```

让初始目录、依赖、PM2 进程都就位，再启用 GH Actions 自动部署。

---

## 排错

### Actions 跑失败 — SSH 连接不上

1. 检查 secrets 的 `SSH_PRIVATE_KEY` 是否完整（包含 BEGIN/END 行）
2. 检查 `SERVER_USER` 是否正确（`ubuntu` 还是 `root`）
3. 检查服务器的 `~/.ssh/authorized_keys` 真的有你加的公钥
4. 服务器 sshd 是否允许 key 登录：`/etc/ssh/sshd_config` 里 `PubkeyAuthentication yes`

### 构建失败

看 Actions 里的报错：
- **typecheck/lint 失败**：本地先 `pnpm typecheck && pnpm lint` 跑通再 push
- **build OOM**：GitHub runner 有 7G 内存，不会 OOM，除非你有超大依赖

### 部署成功但网站没更新

1. PM2 是不是真的重启了？看 Actions 日志里 `pm2 status` 输出
2. nginx 反代到 3000 端口正确吗？`curl -I http://127.0.0.1:3000/` 看响应
3. ISR 60s 缓存：访问过一次 `/news/[slug]` 之后 60s 内不会重生成，刷新或换个新 URL 试试

### 回滚

GH Actions 失败不会动服务器（只在 ssh 成功+build 成功后才 rsync）。如果新版本上线后有问题：

```bash
ssh ubuntu@<ip> 'pm2 restart gdufsmc --update-env'  # 重启回退无效, 实际是回 git
```

真正的回滚：在本地 `git revert` 那次 commit → push → GH Actions 自动跑回旧版本。