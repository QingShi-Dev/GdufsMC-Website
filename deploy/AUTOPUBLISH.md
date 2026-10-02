# Actions 完整构建自动发布

完整链路：GitHub `build` 验证成功 → self-hosted `publish` 下载本次 build 的 artifact ID → 固定投递客户端生成 ZIP → 独立管理员任务发布 → Actions 等待成功/失败结果。纯内容更新继续使用现有 `GdufsmcContentQueue`；两个发布器共用原来的 `shared/deployment.lock`，新包装脚本不另加锁。

## 一次性启用

1. 先让包含这些改动的 `main` 完整构建通过，保持仓库变量 `RELEASE_PUBLISH_ENABLED` 未设置或为 `false`。必要时在 Actions 手动运行并勾选 `force_full_build`。
2. 下载可信的 `windows-release-…` artifact，在服务器解压到独立安装目录，例如 `H:\GDUFSMC-release-install`，保留 `outputs/` 和 `deploy/`。不要执行其他来源的 publisher；SHA256 检查用于发现损坏，不能证明来源。全量自动发布意味着允许该仓库的 `main` 构建代码及包内 publisher 以现有 PM2 管理员身份运行，必须继续保护 `main`、Actions 和 runner。
3. 用 **WINSERVER08\Administrator 的提升权限 PowerShell** 运行：

```powershell
cd H:\GDUFSMC-release-install
.\deploy\setup-release-publish.ps1 -DryRun
.\deploy\setup-release-publish.ps1 -Install
Get-ScheduledTask -TaskName GdufsmcReleasePublish
Start-ScheduledTask -TaskName GdufsmcReleasePublish
Get-ScheduledTaskInfo -TaskName GdufsmcReleasePublish
```

安装前会检查当前身份、部署根 ACL、Node **24.21.0**、既有 PM2 home、PM2 路径、已安装 content tools 和 deployment-state。默认 runner 身份为 `NT AUTHORITY\NETWORK SERVICE`，实际不同则给安装命令加 `-RunnerIdentity '实际账户'`。已有安装/任务时拒绝覆盖；安装中断后应检查已生成目录和任务，不能直接用 `-Force` 重装。

安装只复制固定工具到 `H:\GDUFSMC-web\release-tools`，新增 **GdufsmcReleasePublish**（S4U、管理员、启动及每分钟触发）。`IgnoreNew` 防止计划任务自身重入，执行时间不设上限，以便发布失败后的恢复有时间完成。此设置与 [Microsoft 的任务超时说明](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-executiontimelimit) 一致。现有 content task、PM2 开机服务和 Caddy 不变。

4. 确认空队列执行退出码为 0 后，在 GitHub 仓库 Settings → Secrets and variables → Actions → **Variables** 添加 `RELEASE_PUBLISH_ENABLED=true`。无需新增 GitHub secret 或 SSH 凭据。
5. 推送新的代码提交到 `main`，或手动运行 `force_full_build=true`。检查 `build` 和 `publish` 两个 job。`publish` 按 [download-artifact 的 artifact-ids 参数](https://github.com/actions/download-artifact/blob/v4/action.yml) 精确下载上游构建产物；不 checkout，也不在 runner 上执行下载来的脚本。
6. 现场验收源站 `http://127.0.0.1:3000/__release.json` 的 commit、`/news` 新内容、PM2 online 和 CDN 展示。完整 publisher 的 EdgeOne purge 失败仍沿用现有警告语义；Actions 成功不等于 CDN purge 已完成。

本地测试使用隔离临时目录和模拟 publisher，不能代替生产身份、任务、ACL、真实 PM2 回滚和网站验收。

## 目录及权限

| 路径（相对 `H:\GDUFSMC-web`） | 用途 | runner 权限 |
|---|---|---|
| `release-tools/` | 管理员安装的固定客户端、worker 和准备脚本 | RX |
| `release-delivery/inbox/` | Actions ZIP 投递区 | Modify |
| `release-delivery/results/` | 按 run ID / attempt / commit 返回结果 | RX |
| `release-delivery/logs/` | 每个请求的完整发布 transcript | 无 |
| `release-delivery/paused.json` | 失败/中断后暂停标记 | 只读 |
| `artifacts/` | 管理员保护的 ZIP 和 `release-YY.M.P` 归档 | 无 |
| `candidate/` | 同名 release 解包目录 | 不新增权限 |
| `incoming/` | 历史临时目录；每次准备/发布尝试结束后清空 | 不新增权限 |

runner 不直接写生产 artifacts：客户端先创建 `<run>-<attempt>-<commit>.uploading`，完成后原子改名为 `.zip`。管理员 worker 独占读取 ZIP，复制到 artifacts 的新文件，再删除投递副本。复制会创建继承管理员权限的新文件，避免同盘移动保留 runner 可写 ACL。未完成的 `.uploading` 不会被消费；异常中断留下的文件由管理员核对来源后清理。

投递区和 archive 内脚本都是全量代码发布入口；不要把该权限授予 CMS 内容队列或其他非可信提交。`content-tools`、`coordination` 及其 ACL 不变。

## 准备与发布规则

- 扫描 ZIP 文件名升序，逐个发布。多个包分别经过停服窗口；首个失败立即停止。
- 从 artifacts 中严格匹配 `release-YY.M.P` 的目录取当年当月最大序号，加一；无目录从 1 开始。按服务器本地日期编号，不改 `release.json.id`。
- ZIP 解压成功后立即删除；按年、月、序号数值保留最新 3 个 archive 目录，输出删除日志。`-KeepArtifacts` 禁止轮换，`-Keep N` 可调整保留数。未来日期的目录挤掉本次版本时会拒绝操作，要求先检查时钟。
- 必须有且只有一对 tar.gz / SHA256，名称与哈希一致。ZIP 路径及 tar 路径、文件类型在解压前验证；拒绝越界、链接、reparse point，已有目录不覆盖。
- 解包到 `candidate/<同名版本>`，验证 `server.js`、可解析的 `release.json`、Windows x64 / Node 24.21.0 / contentSyncVersion 1，拒绝顶层 `content/`。自动投递还必须匹配请求 commit。
- 调用包内 `deploy/publish-release.ps1`，停服、同步内容、健康检查、恢复、purge 保持现有行为。固定工具不会因新包出现而自动更新。
- 成功删除 candidate；失败保留 candidate 和本次 archive，清理 `incoming`。后续人工批准的新发布仍可能按保留策略轮换旧 archive，排查资料应先另行保存。清理遇到异常链接会拒绝删除并报告失败。
- `DryRun` 只打印计划，不创建目录、日志、锁文件，也不校验尚未解开的包。空投放目录退出码为 0。

## 手工预览或投放

管理员可把可信 ZIP 放进 artifacts，然后运行固定脚本。手动批量运行前应禁用独立自动发布任务并确认其未运行，避免两个包装器争用编号或清理目录；不要同时执行历史 incoming 手工发布。

```powershell
& H:\GDUFSMC-web\release-tools\publish-from-artifacts.ps1 -DryRun
& H:\GDUFSMC-web\release-tools\publish-from-artifacts.ps1
# 仅发布指定 ZIP、保留所有归档：
& H:\GDUFSMC-web\release-tools\publish-from-artifacts.ps1 -ZipName windows-release.zip -KeepArtifacts
```

计划任务只消费 inbox 中符合 `<run>-<attempt>-<commit>.zip` 格式的 Actions 请求。手动放 artifacts 的其他 ZIP 需运行以上命令。脚本也可在首次安装包的 `deploy/` 中运行，但必须保留同目录 `artifact-operations.ps1` 和 `content-operations.ps1`。

## 失败、超时与恢复

Actions 最多等待结果 30 分钟；等待失败或用户取消不会终止独立管理员任务，也不会终止 publisher 的回滚。超时后先确认任务和源站状态，不要马上重新发包。

worker 写入 `processing` 后才开始消费。失败会先写 `paused.json` 再写 `failed` 结果，停止后续请求；服务器重启等造成 `processing` 遗留时，下次也会暂停。成功/失败结果保留，不重复执行同一请求。完整日志位于 `release-delivery/logs/publish-<请求ID>.log`，普通 runner 只读简要结果。

恢复步骤：

1. 将 `RELEASE_PUBLISH_ENABLED` 设为 `false`；禁用 **GdufsmcReleasePublish** 的后续触发并确认当前执行已结束。不要强制结束正在回滚的进程，也不要操作 `GdufsmcContentQueue`。
2. 查看 transcript、源站 marker、PM2、`shared/deployment-state.json` 和内容 journal。若 publisher 报恢复失败，按 [CONTENT-SYNC.md](CONTENT-SYNC.md) 的 journal 恢复流程先恢复线上。包装器不会声称“回滚一定成功”。
3. 对因进程中断遗留的 `results/<请求ID>.json`，人工核实后使用固定 `content-operations.ps1` 的 `Write-ContentJsonAtomic` 将 `processing` 改为实际 `success` 或 `failed`，保留 requestId；否则下次仍会检测到中断并暂停。失败结果不要删除来强迫重试。
4. 审核 inbox 里尚未处理的 ZIP，将不再需要的包移到队列以外；保存失败 candidate/archive 和日志。核对所有失败/中断请求完成处置后，由管理员删除 `paused.json`。
5. 恢复任务并重新开启变量，推送修复提交或重跑**整个** workflow 生成新的程序 release。只重跑 publish job 会复用旧包；若旧 `release.json.id` 已存在，现有 publisher 会拒绝覆盖。

停止自动发布只需关闭变量并禁用上述独立任务；已经开始的发布仍应等待完成。工具升级需管理员在任务空闲且禁用时显式更新 `release-tools` 中的固定文件，再验证并恢复任务，不自动替换 content tools。

## 本地验证

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -File scripts/test-artifact-publish.ps1
pwsh -NoProfile -NonInteractive -File scripts/test-artifact-publish.ps1
```

覆盖编号/跨年、数值轮换、零写入 dry-run、实际 ZIP/tar、校验失败、危险路径、publisher 非零退出、清理、投递与结果回传、重复请求和中断暂停。CI 在上传发布 artifact 之前运行两种 PowerShell 的这些测试。
