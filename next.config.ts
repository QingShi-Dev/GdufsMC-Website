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
  // HTML 边缘缓存策略: 浏览器不缓存 (max-age=0), CDN 缓存 1 天 (s-maxage=86400),
  //   过期后 1 天内继续 serve stale + 后台刷新 (stale-while-revalidate=86400).
  // 部署后通过 publish-release.ps1 调 EdgeOne purge API 立即 invalidate, 让用户
  //   看到新版本无需等待 s-maxage 到期. 这条会被下方的 /api/*, /_next/static/*,
  //   /admin/* 独立 header 覆盖.
  {
    key: "Cache-Control",
    value: "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400",
  },
];

// /_next/static/* — Next.js hashed 静态资源, 永久缓存 (immutable)
const STATIC_ASSET_HEADERS: { key: string; value: string }[] = [
  { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
];

// /api/* — 动态响应, 永不缓存
const API_HEADERS: { key: string; value: string }[] = [
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
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
  // E2: tile images are served by Caddy from H:\GDUFSMC-web\public\images\,
  // not by Next.js. Exclude them from the standalone trace so they stay out
  // of the release tarball. lib/map/loader.ts reads these at build time via
  // fs.readdirSync + path.join(process.cwd(), "public", ...), but Next.js
  // sees the dynamic filesystem ops and conservatively traces everything.
  // Excluding here tells the tracer the files don't need to ship with the
  // app at runtime.
  outputFileTracingExcludes: {
    "/*": [
      "./public/images/**/*",
      // Next.js's dist/ ships .map (sourcemaps, ~70 MB), .ts (types, ~2 MB),
      // .md (docs, ~2.6 MB). None of these are needed at runtime; only the
      // compiled .js matters. Stripping these cuts the tarball ~75 MB.
      "**/*.map",
      "**/*.ts",
      "**/*.md",
    ],
  },
  async headers() {
    return [
      // 主路径: 安全 CSP + HTML 边缘缓存 (s-maxage=86400)
      //  - max-age=0: 浏览器不缓存 HTML, 刷新必拿最新
      //  - s-maxage=86400: CDN 边缘缓存 1 天 (部署后调 EdgeOne purge 立即失效)
      //  - stale-while-revalidate=86400: 过期后 1 天内 serve stale + 后台刷新
      {
        source: "/:path*",
        headers: MAIN_SECURITY_HEADERS,
      },
      // /admin/* 路径: 放宽 CSP 允许 Sveltia CMS, 加 no-store + noindex
      {
        source: "/admin/:path*",
        headers: ADMIN_SECURITY_HEADERS,
      },
      // /api/* 路径: 动态响应, no-store (覆盖 MAIN 的 s-maxage)
      {
        source: "/api/:path*",
        headers: API_HEADERS,
      },
      // /_next/static/* 路径: hashed 静态资源, immutable (覆盖 MAIN 的 s-maxage)
      {
        source: "/_next/static/:path*",
        headers: STATIC_ASSET_HEADERS,
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
