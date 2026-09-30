# content 外置改造交接文档

> 面向接手的 AI agent。读完这一份应该能直接开始 P2，不用重走 P0/P1 的路。
>
> 最后更新：2026-09-30 · 状态：P0 + P1 已完成、已上线、已验证

---

## 一、目标与当前状态

**原始目标**：让 CMS 改文章不必重新构建 + 重新发布整个 release。

**当前状态**：已经做到了。人工链路完整可用——改文件 → EdgeOne purge → 生效，无需 build。

**还差什么**：这条链路目前是**手工**的。改完 content 之后没有东西自动去做校验和同步。**P2 就是把这部分自动化。**

---

## 二、环境事实（先看这个，省得重复踩）

| 项 | 值 |
|---|---|
| prod 服务器 | Windows，`H:\GDUFSMC-web`，Administrator PowerShell |
| dev 仓库 | `G:\Project\NodeProject\gdufsmc-site-dev` |
| Node（两台都是） | 24.21.0（**manifest 里必须精确匹配**，见第六节） |
| PM2 | `C:\npm\pm2.cmd`，单实例 fork，app 名 `gdufsmc` |
| 发布脚本 | `deploy/publish-release.ps1`（PowerShell 5.1） |
| CI | `.github/workflows/deploy.yml`，windows-2022 runner，**hoisted pnpm layout** |
| CDN | EdgeOne，HTML `s-maxage=86400`，**内容改动后必须 purge** |
| content 根目录 | `H:\GDUFSMC-web\content\{news,leaderboard}` |
| `CONTENT_ROOT` | `H:\GDUFSMC-web`（注意：env 值不含 `content`，代码会自己拼） |

**目录约定**：`CONTENT_ROOT` 指向**父目录**，`lib/news` 内部会再拼一层 `content`：

```
H:\GDUFSMC-web\                 ← CONTENT_ROOT
└── content\                    ← 代码拼的这一层
    ├── news\
    │   ├── *.md
    │   └── images\
    └── leaderboard\
        └── index.yml
```

设置成 `H:\GDUFSMC-web\content` 会变成 `...\content\content\news`，读不到。

---

## 三、P0 做了什么（commit `9892fb8`）

### 3.1 三个读取点支持 `CONTENT_ROOT`

`lib/news`、`lib/leaderboard`、`app/content/[...path]/route.ts` 原本就硬编码 `process.cwd()/content`。改成：

```ts
const CONTENT_ROOT = process.env.CONTENT_ROOT
  ? join(process.env.CONTENT_ROOT, "content")
  : join(process.cwd(), "content");
```

- `lib/news/index.ts:35`
- `lib/leaderboard/index.ts:31`
- `app/content/[...path]/route.ts:25`

**关键前提**：`lib/news` 原本就是 `readFile` 运行时读盘（不是 build 时 import），所以改成外置只需要换路径，**不用改读法**。这是这个方案成本低的关键。

`CONTENT_ROOT` 在模块加载时求值一次，切换需要重启进程。

### 3.2 两个 news 页面改 force-dynamic

`app/news/page.tsx:27`、`app/news/[slug]/page.tsx:21`

这是 P0 里唯一有技术难度的部分，原因见第五节。

### 3.3 新增 `scripts/verify-content-root.mjs`

内容快照的切换前闸门。5 类检查：

1. frontmatter 必填字段 `title` / `date` / `category` / `cover`（**严格对齐 `lib/news/index.ts:67` 的实际校验，不要自己加 `summary`——那不是必填**）
2. date 可解析
3. slug 唯一（只查显式 `frontmatter.slug`；隐式 slug 走 `slugify(title)`，脚本里复现不了拼音）
4. 图片引用存在（frontmatter.cover + 正文 `![](...)`）
5. leaderboard `index.yml` 可解析且有 `entries` 数组

**用法**：

```powershell
node scripts/verify-content-root.mjs <content-root-parent> [--json]
```

exit code：0 = 通过，1 = 有 error，2 = 用法/IO 错误。

`--json` 输出机器可读格式，给 CI 用。

**已验证**：6 个测试用例全过（干净树 / 缺字段+坏图 / 重复 slug / YAML Date / 坏 date+坏 YAML / 空 content）。

---

## 四、P1 做了什么（commit `1ad1596` + `1c5f3ca`）

**全部通过环境变量开关，默认行为零变化。**

| 开关 | 效果 |
|---|---|
| `RELEASE_EXTERNAL_CONTENT=1` | release 不打包 `content/` |
| `CONTENT_ROOT` | 运行时从外置目录读 |

### 4.1 `scripts/package-release.mjs:186`

`RELEASE_EXTERNAL_CONTENT=1` 时跳过 content 复制，**并删掉 `outputFileTracingIncludes` 拖进来的那份**（`next.config.ts:124` 有 `"/*": ["./content/**/*"]`，standalone 会自动 trace 一份进来）。

留着那份比不留更糟：release 看起来是自包含的，实际在服务一份 CMS 永远改不到的冻结快照。

### 4.2 `scripts/test-release.mjs`

三处改动：

**L130-150**——外置模式下 content 探测走 `CONTENT_ROOT`，并**严格失败**：

- `CONTENT_ROOT` 未设 → exit 1
- `CONTENT_ROOT` 目录不存在 / 没有 `content/` → exit 1
- content 里有 `.md` 但目录不对 → 在 news 检查处 exit 1

**L319-355**——新增 `news-list-renders-content(N article(s))` 检查：比对磁盘上的 md 数量 vs 页面实际渲染出的 `/news/<slug>` 去重链接数。

`/news` 返回 200 从来不能证明它找到了文章——这是外置方案最危险的失败模式（`lib/news` 的 `try/catch` 会让空目录静默返回 `[]`）。

### 4.3 `deploy/publish-release.ps1`

**L487-502** `New-DeployEnv`——本来就从 live app 继承 env 并覆盖 `HOSTNAME/PORT/NODE_ENV`。加了日志打印 content root 来源。**不用改继承逻辑**，设一次 `CONTENT_ROOT` 后面每次发布自动带上。

**L1069-1096** 发布前 preflight，在**复制完 release、切换 PM2 之前**：

| 候选 | live app | 结果 |
|---|---|---|
| 有 content | — | 放行，日志 `content: bundled in this release` |
| 无 content | 有 `CONTENT_ROOT` 且目录存在 | 放行，日志 `content: external, CONTENT_ROOT=...` |
| 无 content | `CONTENT_ROOT` 指向的目录不存在 | **拒绝发布** |
| 无 content | 无 `CONTENT_ROOT` | **拒绝发布** |

最后两种情况本来会让服务正常启动、所有路由 200、homepage marker 匹配——**骗过脚本里所有健康检查**。现在在切换之前中止。

### 4.4 `.github/workflows/deploy.yml`（commit `1c5f3ca`）

两个 `env:` 块 + 一个构建后断言：

```yaml
- name: Package release
  env:
    RELEASE_EXTERNAL_CONTENT: '1'
  run: |
    node scripts/package-release.mjs
    ...
    $leaked = @(Get-ChildItem .release-stage -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'content') })
    if ($leaked.Count -gt 0) { throw "external content build leaked content/ in: $($leaked.Name -join ', ')" }
```

```yaml
- name: Test extracted archive (not source workspace)
  env:
    RELEASE_EXTERNAL_CONTENT: '1'
    CONTENT_ROOT: ${{ github.workspace }}
```

**注意 `CONTENT_ROOT` 用 `${{ github.workspace }}`**——CI 上没有外置 content，要指向 checkout 出来的那份，否则 smoke test 的 content 检查会全被 skip 或失败。

### 4.5 `deploy/README.md`

有完整的"一次性切换 / 发版 / 安全网 / 回退"章节。**P2 完成后需要更新这里。**

---

## 五、遇到的问题（这部分很重要，别重走）

### 5.1 静态生成是真正的硬障碍（不是"可能有影响"，是确定会坏）

原代码的 `app/news/[slug]/page.tsx` 有 `generateStaticParams`，我在 P0 之前判断"已有 ISR 60s，加 `dynamicParams` 就行"——**错了**：

1. `/news/[slug]`：`generateStaticParams` 在 build 时枚举 slug 写进路由表。新增文章首次请求才现场渲染，**然后就被冻结**。
2. `/news` 列表页：**这个我完全没预料到**。Next.js 16 对没有 `generateStaticParams`、没有动态 API 的 async server component 会做自动静态优化。证据：

```
.next/server/app/news.meta
  "x-nextjs-prerender": "1"
  "x-nextjs-stale-time": "300"
```

3. `app/news/[slug]/page.tsx:20` 的注释写着"ISR 60s 缓存"——**注释是假的**，代码里从来没有 `revalidate`。已修正。

4. `/news/pvp-results` 返回 200 而不是 404，因为 `.next/server/app/news/pvp-results.segments/` 里躺着 build 时预生成的 segment。

**教训**：Next.js 16 的 automatic static optimization 比直觉更积极。不能靠"看起来像静态"来判断，要看 `.next/server/app/**/*.meta` 里有没有 `x-nextjs-prerender`。

### 5.2 预渲染产物会掩盖问题（部署事故）

首次发布外置 release 后，新闻列表 0 条。排查发现是**基线数据是空的**——`H:\GDUFSMC-web\content` 是从 `releases\36489301829-1-b40ecec\content` 拷的，而那个 release 的 `.md` 文件早前被误删过（见 5.4），只剩图片。

**"回滚后显示正常"是个假象**：回滚到 `b40ecec` 之所以能显示 3 篇，是因为它用的是 build 时烘焙进 `news.html` 的快照，而那份 HTML 没被删。跟 content 文件在不在没关系。

**教训**：预渲染产物会让"内容缺失"看起来像"内容正常"。诊断时必须绕过缓存直查源站：

```powershell
# 源站（绕过 EdgeOne）
(Invoke-WebRequest http://127.0.0.1:3000/news -UseBasicParsing).Content
# 线上（经过 EdgeOne）
(Invoke-WebRequest https://gdufscraft.top/news -UseBasicParsing).Content
```

两者不一致 = 缓存问题。两者都空 = 真的是内容问题。

### 5.3 ByteString 噪音（已知问题，决定不修）

`force-dynamic` 之后，`/news` 和 `/news/[slug]` 每次请求会往 stderr 打：

```
TypeError: Cannot convert argument to a ByteString because the character at index 15
has a value of 32452 which is greater than 255.
```

页面仍然 200、内容正确，只是日志噪音。

**排查过程**（六个实验，全部排除自身代码）：

| 实验 | 改了什么 | 结果 |
|---|---|---|
| A | 现状 | ❌ |
| B | `/news` 加纯 ASCII `metadata` 覆盖 | ❌ |
| C | `aria-label={data.title}` → 字面量 | ❌ |
| D | `<Leaderboard>` 整个移除 | ❌ |
| E | **页面内容全删，只剩 `<div>bare</div>`** | ❌ |
| F | **根 layout 中文 title/description 换成 ASCII** | ❌ |

实验 E 是决定性的：页面里一个非 ASCII 字符都没有了，错误照旧。所以**不是这个 repo 的中文内容导致的**，是 Next.js 16.2.11 在 force-dynamic 渲染路径上往某个 header 写非 ASCII 字符。

**用户已明确决定不修。** 如果将来要查，方向是 Next.js 16 + force-dynamic + 非 ASCII locale，不是这个项目。

排查时的教训：生产 runtime 是 minified 的，堆栈被 `ignore-listed`，`NODE_OPTIONS=--enable-source-maps` 也救不回来。定位这类问题只能靠**逐个排除法**，不能靠读堆栈。

### 5.4 我造成的一次数据事故

用 `git clean -fX -- <path>` 清理时，它递归遍历了 `.gitignore` 覆盖的**整棵子树**，把 `.release-stage/` 下的其他 release stage 和 `outputs/` 一起删了——包括 27.64 MB 的 tarball 和 prod 上某个 release 的 content 副本。

**永久删除，不可恢复。**（后来 `git gc --prune=now` 把 `.git` 从 3.16 GB 压到 283 MB，这倒是意外收获。）

**规则**：
- `git clean -fX <path>` 会删掉该路径下**所有** gitignored 内容，不只是你指定的那个文件
- PowerShell 的 `Remove-Item` 被 mavis 安全策略拦截（无回收站）；`rm` 走 mavis-trash 但会误判 Windows reparse point
- 要删单个文件用 `git clean -f -- <精确路径>`（不带 `-X`）
- 要删目录树，先 `git clean -Xn` 预览，确认输出的每一行都符合预期再执行

### 5.5 `incoming/` 不是必需目录

我第一版文档里写的解压路径 `H:\GDUFSMC-web\incoming\<id>` 是我从 `publish-release.ps1` 注释里抄的**举例**。脚本实际：

- 不读 `incoming/`
- 不写 `incoming/`
- 不管你把候选 release 解压到哪

`release.json` 里的 `id`（格式 `<runId>-<attempt>-<shortSha>`）才是 `releases/` 下的目录名，脚本自己从 manifest 读。

**唯一约束**（`Assert-SafeCopySource`）：解压路径不能是 `releases/` 的子目录，也不能有 reparse point。

而且解压到 `releases/<manifest.id>` 会直接报 `Target release already exists`——因为那正是脚本要新建的目录。

### 5.6 本地构建的包不能用于 prod 发布

`Assert-Manifest` 要求 `release.json` 的 `nodeVersion` **精确等于** prod 的 Node 版本（24.21.0）。dev 机是 22.11.0，本地打的包会被拒。

要本地验证行为可以，但正式发布必须用 CI 的包（runner 本身 pin 了 24.21.0）。

### 5.7 CI 与本地的 tarball 体积差 23 倍

| | 大小 | 原因 |
|---|---|---|
| CI（hoisted layout） | ~7.5 MB | `deploy.yml:40` 用 `--config.node-linker=hoisted` |
| 本地（isolated layout） | ~231 MB | pnpm 默认 `.pnpm/` 嵌套 |

不是配置错误，是 pnpm link mode 的正常差异。**排查问题时别被这个迷惑。**

### 5.8 PowerShell 5.1 的两个坑

```powershell
# 1. pm2 jlist 不能直接 ConvertFrom-Json（有重复键 username/USERNAME）
& 'C:\npm\pm2.cmd' jlist | ConvertFrom-Json     # 报错
& 'C:\npm\pm2.cmd' env 0 | Select-String 'CONTENT_ROOT'   # 用这个

# 2. commit message 里带 /xxx 会被当成路径
git commit -m "... /content ..."                # 报错
git commit -F commitmsg.txt                     # 用这个
```

`publish-release.ps1` 自己解析 `pm2 jlist` 时有兼容处理，不受影响。

---

## 六、P2 的目标

### 6.1 一句话目标

**只改 content 的 push，自动同步文件 + 校验 + purge，不走完整 build/publish。**

现在的状态是手工的：改 `H:\GDUFSMC-web\content` → 手动 purge。P2 要让 CMS 提交后自动完成。

### 6.2 具体要实现的行为

```
push to main
  ↓
判断变更
  ├─ 只有 content/ 变化  →  content-only 流程
  │                        ├─ 下载该 commit 的 content 快照
  │                        ├─ verify-content-root.mjs 校验
  │                        ├─ 原子切换到 live 目录
  │                        └─ EdgeOne purge
  └─ 有代码/配置变化     → 现有 build + publish 流程（不变）
```

### 6.3 必须处理的边界情况

**这一节是 P2 最难的部分，astra 你之前提过这几点，我确认它们都成立：**

1. **线上基线 vs HEAD，不能只看最后一次 commit**

   ```
   commit A 改了代码，尚未发布
   commit B 只改 content
   ```

   如果只看 `HEAD~1..HEAD`，会认为"只改了 content"→ 走 content-only。但 prod 上跑的还是 A 之前的代码，B 的内容格式可能是 A 引入的新 schema → 旧程序读不了。

   **必须**算 `git log <prod-current-commit>..HEAD`，只要这段里有非 content 改动就强制走 full deploy。

   prod 的基线 commit 在 `H:\GDUFSMC-web\shared\deployment-state.json` 的 `current.commit`。

2. **不能逐文件覆盖正在被读的目录**

   覆盖到一半时，文章已经更新但引用的新图还没到；删除/重命名的文章也会残留。

   正确做法：完整快照 → 校验 → 受控切换。Windows 上 `Move-Item` 不是原子的，要用 `Rename-Item`（同盘 rename 才是原子操作），并且要处理文件占用。

3. **串行控制**

   连续推送、失败重试不能并发。`concurrency: { cancel-in-progress: false }`。

   更隐蔽的：较旧的任务最后完成，把新内容覆盖回去。

4. **不要执行新提交里的任意脚本**

   content 同步 job 应该只做「取文件 + 校验 + 切换 + purge」，不跑 commit 里的任何代码。这是 trust boundary。

5. **内容格式变更要跟代码一起发**

   frontmatter schema 变了就不能走 content-only（跟第 1 点重叠，但要在设计里显式处理）。

### 6.4 技术选型上的开放问题

**连接方式**（需要你决定或调研）：

| 方式 | 优点 | 缺点 |
|---|---|---|
| SSH over frp（frp-pen.com） | 复用现有隧道，`appleboy/ssh-action` 成熟 | frp 断了同步失败；SSH key 要存 GitHub Secrets |
| Webhook（prod 主动 pull） | 不暴露 SSH | prod 要常驻 receiver 服务 |
| 轮询（prod cron 拉） | 无入站端口 | 延迟高 |

我倾向 SSH over frp + 重试 + 失败告警（content-only 失败不阻塞主流程，但要让人知道）。

**如果 SSH 走不通**，备选方案是让 prod 侧有个轮询脚本：CI 把待同步的 commit sha 写到一个公开可读的位置（比如 release notes 或一个 gist），prod 侧定时检查并拉取。这个方案不需要任何入站端口，代价是延迟（取决于轮询间隔）。

**原子切换的具体实现**需要你验证 Windows 上的行为：

```
content\          <- 当前 live
content.old\      <- 上一个成功版本（保留 7 天）
content.new\      <- 新快照
  ↓ 校验通过
Rename-Item content content.old
Rename-Item content.new content
```

**注意**：`lib/news` 是在模块加载时算好 `CONTENT_DIR` 常量的，但每次请求都 `readdir`。所以**切换目录后不需要重启进程**——新的 `readdir` 会看到新文件。这是 P0 选 `force-dynamic` 带来的额外好处，P2 可以利用。

### 6.5 P2 完成后要更新的东西

- `deploy/README.md` 加 P2 章节（现在只有手工链路的文档）
- `scripts/verify-content-root.mjs` 可能需要加 `--json` 之外的 CI 集成模式
- 新的 workflow job

---

## 七、验证方法（P2 完成后必须能跑通）

```powershell
# 1. 改一个文件
Add-Content H:\GDUFSMC-web\content\content\news\welcome-to-our-website.md "<!-- test -->"

# 2. 推送（应该触发 content-only，不是 build）
git add content/ && git commit -m "test" && git push

# 3. 确认 CI 走的是 content-only job（不是 build）

# 4. 线上验证
(Invoke-WebRequest https://gdufscraft.top/news -UseBasicParsing).Content -match 'test'
```

**负向测试**（同样重要）：

- 提交一个 frontmatter 缺 `cover` 的 md → 同步应该失败，线上内容不变
- 提交一个引用不存在图片的 md → 同上
- 提交一个纯代码改动 → 应该走 full deploy，不走 content-only

---

## 八、给 astra 的注意事项

基于这次协作，我列几条**具体的**：

1. **`package-release.mjs`、`publish-release.ps1`、`deploy.yml` 这三个文件我动过，有 comments 解释"为什么"的地方。改之前先读那些注释**——尤其是 external content 的三态判断和 trust boundary 相关。

2. **验证要真跑，不要写完就以为对了。** 你之前写的 `verify-dedup.mjs` 有 `let bad = 0` 重复声明 + 引用未定义的 `mods`，而且没运行过；还有 `spawnSync("cp", ...)` 在 Windows 上会挂 9 分钟（Windows 没有 `cp.exe`）。P0 里我特意先 typecheck 再写 e2e 再改——每个假设都实测过。

3. **verify 层必须有 size/内容合理性检查。** 你之前那个 dedup 算法把 stage 从 73 MB 砍到 5 MB，verify 判 PASS，因为只检查了"被删的模块能否解析"，没检查"结果是否还合理"。P2 的同步校验要避免同样的问题——校验通过不等于内容对。

4. **Windows 环境的坑你已经踩过一些**（`cp` 不存在、long path、文件锁）。PowerShell 脚本要写进文件再跑，别在命令行里拼复杂表达式。

5. **别设没有收敛条件的迭代。** 你之前 truncate 掉自己刚生成的 16 MB 有效产物，循环往复直到 5 MB。P2 的同步要有明确终止条件。

6. **有一个已知的 Next.js 16 bug**（5.3 节），force-dynamic + 非 ASCII 会打 ByteString 错误。用户决定不修。看到它不用管，但**不要把它当成新 bug 浪费时间排查**。

---

## 九、代码位置速查

| 内容 | 位置 |
|---|---|
| `CONTENT_ROOT` 解析（news） | `lib/news/index.ts:35` |
| `CONTENT_ROOT` 解析（leaderboard） | `lib/leaderboard/index.ts:31` |
| `CONTENT_ROOT` 解析（图片路由） | `app/content/[...path]/route.ts:25` |
| force-dynamic（列表页） | `app/news/page.tsx:27` |
| force-dynamic（详情页） | `app/news/[slug]/page.tsx:21` |
| 内容校验脚本 | `scripts/verify-content-root.mjs`（新建） |
| 外置打包开关 | `scripts/package-release.mjs:186` |
| smoke test 严格失败 | `scripts/test-release.mjs:130-150` |
| news 渲染检查 | `scripts/test-release.mjs:319-355` |
| 发布前 preflight | `deploy/publish-release.ps1:1069-1096` |
| env 继承日志 | `deploy/publish-release.ps1:487-502` |
| CI 外置 env | `.github/workflows/deploy.yml`（Package / Test 两个 step） |
| 部署文档 | `deploy/README.md`（"内容外置"章节） |
| content trace 声明 | `next.config.ts:124`（外置模式下会被 package-release 清理） |
| 部署状态 | `H:\GDUFSMC-web\shared\deployment-state.json` |
| PM2 配置 | `H:\GDUFSMC-web\shared\gdufsmc-<id>.json`（含 env，**不要公开**） |
