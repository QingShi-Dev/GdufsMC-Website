# CMS 内容自动同步：固定 content 目录

2026-10-02：本地实现，尚未在生产安装、启用或验收。服务器仍以现场状态为准。

用户已选择始终使用 `H:\GDUFSMC-web\content\news`，接受短暂维护。站点继续读取 `CONTENT_ROOT=H:\GDUFSMC-web`，没有增加指针、版本图片 URL 或新的运行时接口。

## 实际流程

CMS 把内容保存并提交到 `main` 后，Actions 调用服务器上预先安装的工具。工具比较**生产代码 commit 到候选 commit** 的全部受检提交；只有均在 `content/` 内且内容版本向前时，才提交内容任务。代码曾改动又撤销仍要求完整发布；历史过长或 API 列表截断也保守转完整构建。

现有网络服务账户 runner 只写任务队列、读取结果。管理员计划任务每分钟检查一次队列，共用 `shared/deployment.lock`，下载候选的完整内容、校验字段/图片和文件哈希，复查 `main` 及生产版本，然后：

1. 确认只有一个 `gdufsmc`，其路径及 CONTENT_ROOT 与记录一致。
2. 停止这个 PM2 应用，确认进程已停。
3. 保留旧目录，将完整候选放到固定 `Root/content`。
4. 重启同一个应用，核对整个线上内容树的哈希、代码标记、新闻 slug/标题、一个详情的文本、前八名榜单玩家与分数，以及一个图片的完整字节。
5. 记录内容 commit，提交 EdgeOne purge 并查询结果。

正常更新有停服窗口，Caddy/源站访问可能短暂失败；这里没有实现专用维护页。下载与首次校验发生在停服前。整个同步只替换 `content` 数据；工具、状态和备份放在各自运维目录，业务代码与程序 release 不改变。

坏内容、过期任务不会开始停服。切换或健康检查异常会尝试恢复旧目录并重启；恢复不成功则明确失败并保留日志。进程被强杀、断电等留下未完成 journal 时，后续任务会停止并要求管理员检查，不宣称这种中断能无人值守恢复。

## 一次性上线步骤

### 1. 提交改造，先生成完整包

将本轮脚本、workflow、文档，以及希望上线的内容变更按审核流程提交到 `main`。本地图片重命名和正文引用属于用户已有修改，提交时一起核对，避免只提交其一。

暂不设置仓库变量 `CONTENT_SYNC_ENABLED`，或保持 `false`。Actions **Deliver content or build release** 会走完整构建，提供两个 artifact：

- `content-sync-tools-<commit>-<attempt>`：独立可运行的可信工具与依赖。
- `windows-release-<commit>-<attempt>`：程序归档、配套内容清单和管理员 publisher。

完整构建仍在 GitHub-hosted Windows runner 上执行，服务器不安装候选依赖或构建应用。工具 artifact 仅由管理员安装；后续内容提交不能更新它。

### 2. 管理员检查并安装固定任务

在服务器将工具 artifact 解压至**部署根目录以外**的新目录，例如 `H:\GDUFSMC-content-tools-download`。用现有 PM2 所属用户 `WINSERVER08\Administrator` 打开提升权限的 PowerShell。

```powershell
$tools = 'H:\GDUFSMC-content-tools-download'
$tccli = (Get-Command tccli -ErrorAction Stop).Source
$zoneId = '<现有 EdgeOne zone-id>'

# 只读检查；默认 runner 身份为 NT AUTHORITY\NETWORK SERVICE。
& "$tools\deploy\setup-content-sync.ps1" -Inspect
& "$tools\deploy\setup-content-sync.ps1" -DryRun -ToolDirectory $tools -TccliPath $tccli -ZoneId $zoneId

# 检查 DryRun 输出里的账户、PM2_HOME、Node/tccli 路径、生产基线后安装。
& "$tools\deploy\setup-content-sync.ps1" -Install -ToolDirectory $tools -TccliPath $tccli -ZoneId $zoneId
```

安装器会核对当前程序 marker 与私有部署状态，以及父目录权限。若拒绝，先按错误核对具体 ACL/版本漂移，不要给整个 runner 管理员权限，也不要递归授予部署根目录 Modify。准确 runner 身份应从 Windows 服务“登录身份”确认；如不同，用 `-RunnerIdentity` 明确传入。

默认 Node 路径为 `C:\Program Files\nodejs\node.exe`，PM2 为 `C:\npm\pm2.cmd`；可在安装命令用 `-NodePath`、`-Pm2Path` 指定真实路径。workflow 内固定 Node/工具路径必须与安装一致。必须使用现有管理员的 PM2_HOME。

安装布局：

| 路径 | 用途及权限 |
|---|---|
| `content-tools/` | 固定脚本、依赖、非秘密配置；管理员写，runner 读执行 |
| `coordination/queue/` | runner 写请求；只接受 commit/仓库/id/时间，不能传脚本或任意路径 |
| `coordination/results/`、`coordination/code/` | 管理员写，runner 读 |
| `coordination/staging/` | 管理员下载和校验的候选，runner 不可写 |
| `shared/` | 原私有锁、PM2 配置、部署/内容状态、journal、诊断；不向 runner 开放 |
| `content-backups/`、`content-failed/` | 旧内容及失败内容，保留用于恢复 |

计划任务 `GdufsmcContentQueue` 用管理员 S4U 身份、最高权限执行固定入口，每分钟及开机触发，同一任务不并发。它不修改既有 PM2 开机服务。安装器不自动开启 GitHub 变量，也不立即替换内容。

### 3. 核对计划任务的外部访问，再发布一次配套版本

管理员 tccli 配置需能执行 `teo:CreatePurgeTask` 和 `teo:DescribePurgeTasks`，使用当前 zone。计划任务上下文必须实际可读凭据并能访问 GitHub/腾讯云 HTTPS；交互终端可用不代表 S4U 任务也可用。不要把凭据给 runner 或写入队列。

管理员任务**必须**在仅管理员/SYSTEM 可读的 `shared/content-sync-secrets.json` 配置只读仓库 token：`{"githubToken":"..."}`，权限限定目标仓库 Contents: Read。runner 的临时 GITHUB_TOKEN 不会传给独立计划任务；匿名限额不足以持续逐提交及逐文件检查，因此缺少管理员凭据会明确拒绝。用受控本地编辑器创建，不把真实 token 放进命令历史、仓库或聊天。

按 [部署手册](README.md#当前发布方式github-构建管理员手动发布) 下载、校验并解包 `windows-release`，使用该 artifact 内的新版 `publish-release.ps1` 和同目录 `content-operations.ps1` 完整发布一次。新包有 `contentSyncVersion: 1` 和 `content-snapshot/{manifest.json,content/}`。

publisher 会先用候选配套内容在临时端口验包，再在停服窗口同步程序和固定内容目录，建立 `shared/content-state.json`。首次旧生产文件会保留备份；若旧内容没有可证实的 Git commit，不会编造基线。未建立配套基线时，纯内容任务只会转回完整构建。

```powershell
Get-Content 'H:\GDUFSMC-web\coordination\code\current.json' -Raw
Invoke-WebRequest 'http://127.0.0.1:3000/__release.json' -UseBasicParsing
Start-ScheduledTask -TaskName 'GdufsmcContentQueue'
Get-ScheduledTaskInfo -TaskName 'GdufsmcContentQueue'
```

核对代码 commit/releaseId 与源站一致，contentCommit 是本次包的 commit。空队列执行成功只能证明任务启动正常；API 凭据和内容链路仍须下一步实际验收。

### 4. 打开开关并做一次 CMS 验收

确认仓库 `main` 和 `.github/workflows/**` 变更受审核，现有 self-hosted runner 不接收不可信 PR 代码。然后在仓库 **Settings → Secrets and variables → Actions → Variables** 新增：

```text
CONTENT_SYNC_ENABLED = true
```

先手动运行工作流，保持 `force_full_build=false`，验证已部署 commit 的 noop/待清缓存路径。再通过 CMS 修改一篇文章的可见文字并保存到 `main`。预期 `content` job 成功、`build` job 跳过，约一分钟内开始处理；耗时还取决于下载、重启与 purge。

验收看三个位置：

- Actions 摘要/`coordination/results/<sha>-<run>-<attempt>.json`：`status=success`。
- 私有 `content-state.json` 的 `contentCommit` 前进、`purge.status=success`；`deployment-state.json.current.commit` 与源站 `__release.json` 保持原代码版本。
- 实际域名上的 `/news`、详情、图片和积分榜内容符合本次提交。自动 HTTP 检查是采样，不代替全部内容的人工呈现检查。

随后在测试环境检查新增/删除文章、重命名图片、坏内容被拒绝、旧任务重试和健康失败恢复。生产端到端通过后才能认定已启用完成。

## 日常行为与恢复

- **改代码或 workflow**：转完整构建，管理员继续按原流程发布；不会自动发布程序。CMS 改动前若存在尚未发布的代码，也走这条路。
- **旧任务**：候选不是最新 main，标记 `stale` 跳过；不会覆盖新内容。
- **同一内容重试**：已生效时不再次停服；若 purge 未完成，只查询已有 job。失败/过期的 purge job 才重新提交。
- **purge 失败**：Actions 失败但源站已更新。先修管理员凭据/API 权限，再重跑该工作流（新的 run attempt）；不得把这种情况当作内容未上线。新版 full publisher 原有 purge 仍是警告式提交，完整确认由 noop 内容任务完成。
- **请求等候超时**：管理员任务可能仍在处理，先看对应结果、任务状态、锁和 journal；不要直接重复手工覆盖目录。
- **普通激活失败**：脚本尝试恢复旧内容及旧状态并重启。日志在 `shared/content-operation-error.json`，操作进度在 `shared/content-journal.json`；不公开这些私有文件。
- **未完成 journal / CRITICAL**：先将 GitHub 开关设为 `false` 并停用内容计划任务，确认没有 publisher/worker 正运行。管理员检查 journal 的 phase、backupPath、oldContentState/oldCodeProjection；确认 `gdufsmc` 停止后恢复记录的内容与状态，再启动并验证。完整发布 journal 还需恢复记录的程序 PM2 config 与 deployment-state。核对健康后才将 journal 标为 completed 并恢复任务。不能在进程仍读目录时 rename，也不能盲删 journal 解除闸门。
- **需要完整包**：手动运行工作流并选择 `force_full_build=true`，即使内容开关开启也会跳过服务器队列。
- **服务器 runner 离线或内容任务失败**：启用开关后，自动分流依赖这个 runner，普通代码 push 的构建也可能等待/中止。用 `force_full_build=true` 手动生成完整包；这不会自动发布程序或掩盖原内容任务的失败。
- **停止自动同步**：仓库变量设为 `false` 阻止新任务；已入队任务仍可能执行，需同时停用计划任务并检查是否有正在进行的维护。

备份、暂存、失败目录和请求结果不自动清理。管理员定期检查磁盘，仅删除已确认不被当前/上一程序版本、内容状态或未完成 journal 引用的目录。不要用 `robocopy /MIR` 清理这些运维目录。

固定图片 URL 按当前内容树服务。删除或改名后，旧浏览器页面/尚未刷新的 CDN HTML 可能仍引用旧 URL；purge 不能召回已经打开的页面。需要保留历史页面图片时，在内容中暂时保留旧文件名，不能指望备份目录自动通过网站访问。

工具升级需管理员明确更换可信 bundle，并与新 schema 同时评估；内容提交不能升级校验器。当前校验策略会拒绝空新闻目录，不能借 CMS 删除全部文章来隐式清空站点。

## 本地验证

```powershell
pnpm test:content
powershell -NoProfile -File scripts/test-content-operations.ps1
powershell -NoProfile -File scripts/test-content-activation.ps1
powershell -NoProfile -File scripts/test-content-purge.ps1
node scripts/verify-content-root.mjs . --json
node scripts/package-content-tools.mjs
```

Node 用例覆盖 GitHub 变化判定、来源/哈希、工具依赖闭包、健康检查及 purge 重试；PowerShell 用临时目录和模拟 PM2 检查切换及恢复，不操作真实服务。Windows PowerShell 5.1 与 PowerShell 7 都应通过。完整发布包仍需 CI 的 Node 24.21.0 构建/解包/运行验证和服务器现场验收。

EdgeOne 的输入文件使用 [TCCLI 官方 `--cli-input-json` 用法](https://cloud.tencent.com/document/product/440/34013)，状态查询按 [DescribePurgeTasks](https://intl.cloud.tencent.com/zh/document/api/1145/50532) 的 `job-id` filter 实现。
