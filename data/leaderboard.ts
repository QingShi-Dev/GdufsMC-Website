/**
 * @deprecated — 已迁移到 content/leaderboard/index.yml + lib/leaderboard
 *
 * 历史:
 * - 之前这里是写死的 TS 数组 (mock 数据)
 * - 现在改用 YAML 文件 + gray-matter 解析, 配合 Sveltia CMS files collection 编辑
 * - 数据访问层在 @/lib/leaderboard (lib/leaderboard/index.ts)
 * - 类型定义在 @/lib/leaderboard/types (client-safe, 组件从这取)
 *
 * 不要往这里加内容, Sveltia 不认识这个文件
 */