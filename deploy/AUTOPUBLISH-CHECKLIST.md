# 自动发布上线验收清单

> 时间：2026-10-03 · 代码已实现，**尚未在生产验收**
> 严格按顺序执行。**任何一步失败就停，不要跳到下一步。**
>
> 关键原则：先证明「发布成功」路径，再证明「失败回滚」路径，最后才自动化。
> 顺序反了的话，第一次失败可能就停服停在那儿。

---

## 零、前提确认（只读，零风险）

```powershell
# 服务器上执行
cd C:\Users\Administrator

# 1. 当前生产状态（回滚的兜底）
(Invoke-WebRequest http://127.0.0.1:3000/__release.json -UseBasicParsing).Content
Get-Content 'H:\GDUFSMC-web\shared\deployment-state.json' -Raw
# 记下 current.id 和 current.commit —— 后面要对照
```

```powershell
# 2. 仓库变量必须是 false（现在还不能开）
#    GitHub → Settings → Secrets and variables → Actions → Variables
#    RELEASE_PUBLISH_ENABLED 应该不存在或为 false
```

**通过标准**：能正常读到两个 JSON，变量是关的。

---

## 一、DryRun（只读，不动任何文件）

**需要先把一个 zip 放进 artifacts**。如果没有，先跳到「准备测试包」那节。

```powershell
$tools = 'H:\GDUFSMC-web\release-tools'   # 如果还没装，见「准备」

& "$tools\publish-from-artifacts.ps1" -DryRun
```

**检查输出里的这几行**：

```
[时间] Prepare <zip名> -> release-26.10.N        ← 版本号算对了吗
[时间] DRY RUN: expand ZIP to ...; delete ZIP only after successful extraction.
[时间] DRY RUN: remove old artifact release-...  ← 要删的版本对吗
[时间] DRY RUN: verify exactly one SHA256/tarball pair; extract to ...
[时间] DRY RUN: invoke artifact deploy/publish-release.ps1; clear incoming on success/failure
```

**通过标准**：
- ✅ 版本号符合规则（同年月最大 +1）
- ✅ 要删的旧版本 ≤ 3 个保留
- ✅ **DryRun 之后 `artifacts\` 和 `candidate\` 内容完全没变**（自己确认一下）

**如果版本号算错**（比如服务器日期是 2027 年）：
```
New version sorts outside the retention window; check server date or use KeepArtifacts.
```
→ 检查系统日期，或用 `-KeepArtifacts` 绕过。

---

## 二、手工发布一次（真实停服）

**这一步会停服。** 挑没人用的时候。

```powershell
& "$tools\publish-from-artifacts.ps1"
```

**观察这些**：

| 时机 | 期望 |
|---|---|
| 开始 | `Prepare <zip> -> release-26.10.N` |
| 解压后 | `ZIP extracted; deleting <zip>` |
| 清理旧版 | `Remove old artifact release-...`（如有） |
| 校验 | `SHA256 verified; extracting release with System32/tar.exe.` |
| 发布前 | `Publish release-26.10.N (commit <40位>), source <zip>` |
| **publisher 输出** | `DEPLOY SUCCEEDED: <id>` + `EdgeOne purge submitted successfully` |
| 收尾 | `Published release-26.10.N; remove successful candidate.` + `Clear incoming after this attempt.` |

**发布后立即验证**：

```powershell
# 1. 新版本生效
(Invoke-WebRequest http://127.0.0.1:3000/__release.json -UseBasicParsing).Content
#    commit 应该等于刚才日志里的 commit

# 2. 部署状态同步
Get-Content 'H:\GDUFSMC-web\shared\deployment-state.json' -Raw
Get-Content 'H:\GDUFSMC-web\shared\content-state.json' -Raw
#    codeCommit 应该也前进了

# 3. 线上能访问（绕过 EdgeOne 缓存）
$h = (Invoke-WebRequest 'http://127.0.0.1:3000/news' -UseBasicParsing).Content
if ($h -match '共\s*(\d+)\s*条') { "origin: $($Matches[1]) 条" }

# 4. 目录状态
Get-ChildItem 'H:\GDUFSMC-web\artifacts' -Directory | Select-Object Name
Get-ChildItem 'H:\GDUFSMC-web\candidate' -ErrorAction SilentlyContinue   # 应该空了
Get-ChildItem 'H:\GDUFSMC-web\incoming' -ErrorAction SilentlyContinue    # 应该空了
```

**通过标准**：
- ✅ `/__release.json` 的 commit 是新版本
- ✅ `content-state.json` 的 `codeCommit` 前进
- ✅ origin `/news` 正常显示文章
- ✅ `candidate\` 和 `incoming\` 空了
- ✅ `artifacts\` 里 zip 没了，目录在，≤ 3 个

**线上验证**（EdgeOne purge 后）：

```powershell
$h = (Invoke-WebRequest 'https://gdufscraft.top/news' -UseBasicParsing).Content
if ($h -match '共\s*(\d+)\s*条') { "线上: $($Matches[1]) 条" }
```

---

## 三、失败回滚（最重要，最容易被跳过）

**必须验。** `publish-release.ps1` 的回滚逻辑在真实环境从没跑过——今天所有部署都走的成功路径。

### 3.1 制造一个必然失败的包

```powershell
# 复制一份现有 zip，改坏 sha256
$test = 'H:\GDUFSMC-web\artifacts\corrupt-test.zip'
Copy-Item '<第一步用的那个 zip 已经删了，重新放一个>' $test
# 用 PowerShell 打开 zip 改掉 sha256.txt 的内容
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::Open($test, 'Update')
$e = $z.Entries | Where-Object { $_.FullName -like '*.sha256.txt' }
$r = New-Object IO.StreamReader($e.Open())
$null = $r.ReadToEnd(); $r.Dispose()
$s = $e.Open(); $s.SetLength(0)
$w = New-Object IO.StreamWriter($s)
$w.Write('0000000000000000000000000000000000000000000000000000000000000000  wrong.tar.gz')
$w.Flush(); $w.Dispose()
$z.Dispose()
"corrupted"
```

### 3.2 跑发布，应该失败

```powershell
& "$tools\publish-from-artifacts.ps1" -ZipName 'corrupt-test.zip'
```

**期望**：

```
[时间] FAILED release-26.10.N : SHA256 mismatch; artifact retained for diagnosis.
```

**关键检查——线上必须还活着**：

```powershell
(Invoke-WebRequest http://127.0.0.1:3000/__release.json -UseBasicParsing).Content
# commit 应该还是第二步那个版本，没变
$h = (Invoke-WebRequest 'http://127.0.0.1:3000/news' -UseBasicParsing).Content
# 正常显示
```

**还要确认**：
- `candidate\` 里留下了一个 release-26.10.N 目录（失败时**不删**，供排查）→ **手工删掉**
- `incoming\` 空了（finally 清的）
- `artifacts\` 里 corrupt-test.zip **还在**（sha256 失败时 zip 不删）

**通过标准**：**网站完全正常，PM2 没重启，release 目录没变。**

### 3.3 清理

```powershell
Remove-Item 'H:\GDUFSMC-web\artifacts\corrupt-test.zip' -Force
Remove-Item 'H:\GDUFSMC-web\candidate\release-26.10.N' -Recurse -Force
```

---

## 四、装计划任务（自动化）

前三步都过了再装。

```powershell
# 只读检查
& "$tools\setup-release-publish.ps1" -Inspect

# 演练
& "$tools\setup-release-publish.ps1" -DryRun -ToolDirectory $tools

# 安装
& "$tools\setup-release-publish.ps1" -Install -ToolDirectory $tools
```

**装完验证**：

```powershell
Get-ScheduledTaskInfo -TaskName 'GdufsmcReleasePublish' |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
# LastTaskResult 应该是 0（空 inbox 正常退出）
```

---

## 五、开变量

GitHub → Settings → Secrets and variables → Actions → **Variables**：

```
RELEASE_PUBLISH_ENABLED = true
```

**注意值只填 `true`**，不要写成 `RELEASE_PUBLISH_ENABLED = true`（之前 `CONTENT_SYNC_ENABLED` 就踩过这个坑）。

---

## 六、端到端

从 CMS 改一篇文章（只改文字）→ 保存。

**如果判定是 full**（改了 `config.yml` 之类）：

```
content job  → mode=full
build job    → 完整构建
publish job  → 下载 zip → 投递 → S4U 任务发布 → 等结果
```

**期望**：

| 检查点 | 期望 |
|---|---|
| `publish` job | success |
| 服务器日志 | `Published release-26.10.N` |
| `artifacts\` | zip 没了，多一个新目录 |
| `candidate\` + `incoming\` | 空的 |
| 线上 | 内容更新（purge 之后） |
| `deployment-state.json` | commit 前进 |

**在 servers 上查发布记录**：

```powershell
Get-ChildItem 'H:\GDUFSMC-web\release-delivery\results' | Sort-Object LastWriteTime -Descending |
  Select-Object -First 3 Name, LastWriteTime
Get-Content '<最新的那个>.json' -Raw
```

---

## 七、失败暂停机制

第三步失败时，`paused.json` 会被写（自动发布**永久停止**，防止连续失败）。

**恢复方法**：

```powershell
# 1. 先查为什么停了
Get-Content 'H:\GDUFSMC-web\release-delivery\paused.json' -Raw
Get-ChildItem 'H:\GDUFSMC-web\release-delivery\logs' | Sort-Object LastWriteTime -Descending |
  Select-Object -First 3 Name

# 2. 确认线上正常后
Get-Content 'H:\GDUFSMC-web\shared\deployment-state.json' -Raw   # current 正常？
(Invoke-WebRequest http://127.0.0.1:3000/news -UseBasicParsing).StatusCode

# 3. 确认没问题才删
Remove-Item 'H:\GDUFSMC-web\release-delivery\paused.json' -Force
```

**任何时候看到 `paused.json` 存在，自动发布就是停的**，必须人工确认后才能删。

---

## 八、关闭自动发布（出问题时）

最快：把仓库变量改成 `false`。

```powershell
# 或者直接停任务（更快，立即生效）
Disable-ScheduledTask -TaskName 'GdufsmcReleasePublish'
```

**注意**：关变量只阻止**新请求**，已在 `inbox\` 里的 zip 仍会被处理。要彻底停，得停任务。

---

## 九、待清理的东西（上线一段时间后）

| 路径 | 内容 | 何时清 |
|---|---|---|
| `candidate\release-26.10.N` | 失败发布留下的 | **每次失败后手工删**（第三步会看到） |
| `release-delivery\inbox\` | 未处理的 zip | 正常情况处理完就空 |
| `release-delivery\logs\` | transcript 日志 | 累积，**不会自动清**，定期手工删 |
| `release-delivery\results\` | 每次发布的记录 | 同上 |
| `content-backups\` | content 备份 | 累积，需定期检查 |

**这些都不自动清理。** 磁盘会慢慢涨。建议每月检查一次。

---

## 十、完整验收清单

- [ ] 零、前提状态读到了，变量是关的
- [ ] 一、DryRun 版本号算对，文件没被动
- [ ] 二、真实发布成功，`/__release.json` commit 前进
- [ ] 二、`content-state.json` 的 codeCommit 前进
- [ ] 二、`candidate\` / `incoming\` 空了
- [ ] 二、线上 origin 和公网都能看
- [ ] **三、坏包被拒，线上完全没受影响**
- [ ] 三、失败后 zip 还在、candidate 留下、incoming 清了
- [ ] 四、计划任务装上，`LastTaskResult=0`
- [ ] 五、`RELEASE_PUBLISH_ENABLED=true`（只填 true）
- [ ] 六、端到端发布成功
- [ ] 七、`paused.json` 机制理解清楚

**第三步是整份清单里最重要的一条。** 没验过回滚就开自动发布，等于赌。
