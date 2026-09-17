/**
 * @deprecated 已迁移到 content/news/*.md + lib/news/index.ts (Markdown + frontmatter)
 *
 * 历史:
 * - 之前这里存的是 hardcoded 的 NewsItem[] (TS 数组)
 * - 现在改用 Markdown 文件 + frontmatter, 配合 Sveltia CMS 后台编辑
 * - 这个文件保留只是为了提醒"这里曾经是数据源", 不要往里加内容
 *
 * 实际入口:
 * - 数据文件: content/news/*.md
 * - 数据访问: @/lib/news (lib/news/index.ts)
 */