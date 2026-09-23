import type { NextConfig } from "next";

/**
 * 安全 HTTP 响应头 + CSP
 *
 * 设计权衡:
 * - script-src / style-src 留 'unsafe-inline': Next.js 16 + framer-motion + Tailwind v4
 *   在 prod 仍会注入内联脚本/样式; 改 nonce 方案需要 middleware 配合, 单独项目不值得。
 *   如果以后要更严, 走 Next 官方 nonce 教程加 header 即可。
 * - frame-ancestors 'none': 完全禁止被 iframe 嵌入 (防止 clickjacking)。
 * - object-src 'none': 禁止 Flash/Java 等插件 (现代浏览器已无意义但属 hygiene)。
 * - HSTS 只在 HTTPS 部署下生效; 一年 + includeSubDomains + preload 资格 (慎用 preload,
 *   一旦提交就难撤销, 公网正式域名才加, 测试域名不加)。
 *
 * 拆分: 主体 CSP 不含 unpkg.com (降低外部 CDN 劫持面), /admin/* 单独放行 Sveltia 需要的 unpkg
 *   - 主路径: script-src 'self' 'unsafe-inline' — 不含 unpkg
 *   - /admin: script-src 'self' 'unsafe-inline' https://unpkg.com — 放行 Sveltia CMS
 *   - 其他 admin 限制 (no-store / noindex) 在 /admin 路径下叠加
 */

// 通用安全头 (主路径)
const MAIN_SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 主路径不引入 unpkg — Sveltia CMS 是 /admin 后台, 不该污染主页面 CSP
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

// /admin/* 安全头 — 放宽 CSP 允许 unpkg (Sveltia CMS), 加 no-store + noindex
//   - Sveltia CMS runtime + locales + schema 都从 unpkg.com 拉
//   - no-store: 不让 CDN/浏览器缓存 admin 页面 (config.yml 含仓库结构, 防泄露)
//   - X-Robots-Tag noindex: 不让搜索引擎索引后台
const ADMIN_SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "Cache-Control",
    value: "no-store, no-cache, must-revalidate, private",
  },
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // unpkg.com: Sveltia CMS 运行时脚本 (admin 是唯一允许外部 CDN 的路径)
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline'",
      // raw.githubusercontent.com: Sveltia 预览媒体
      // avatars.githubusercontent.com: Sveltia 显示 GitHub 用户头像
      "img-src 'self' data: blob: https://raw.githubusercontent.com https://avatars.githubusercontent.com",
      // fonts.gstatic.com / cdn.jsdelivr.net: Sveltia CMS 字体
      "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
      // api.github.com: Sveltia GitHub backend 读写
      // raw.githubusercontent.com: 媒体 fetch
      // unpkg.com: Sveltia 运行时 fetch locales/*.json + schema/*
      "connect-src 'self' data: https://api.github.com https://raw.githubusercontent.com https://unpkg.com",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./content/**/*"],
  },
  async headers() {
    return [
      // 主路径: 安全 CSP, 不含外部 CDN
      {
        source: "/:path*",
        headers: MAIN_SECURITY_HEADERS,
      },
      // /admin/* 路径: 放宽 CSP 允许 Sveltia CMS, 加 no-store + noindex
      {
        source: "/admin/:path*",
        headers: ADMIN_SECURITY_HEADERS,
      },
    ];
  },
  /**
   * /admin 重写 — Next.js dev server redirect() 跟带中文注释的 page.tsx
   * 组合会抛 ByteString 错误, 改用 rewrites 在 header 层重写 URL,
   * 完全不进 app router page render
   */
  async rewrites() {
    return [
      { source: "/admin", destination: "/admin/index.html" },
      { source: "/admin/", destination: "/admin/index.html" },
    ];
  },
};

export default nextConfig;
