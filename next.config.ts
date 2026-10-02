import type { NextConfig } from "next";

import { adminContentSecurityPolicy, mainContentSecurityPolicy } from "./csp.mjs";

/**
 * 安全 HTTP 响应头 + CSP
 *
 * CSP 的实际内容在 csp.mjs 里构造 (与 scripts/test-csp.mjs 共用同一个模块,
 * 策略和它的测试不可能对不上)。这里只负责挂到哪条路径上。
 *
 * 设计权衡:
 * - 主路径 script-src 保留 'unsafe-inline': Next.js 16 会注入内联 flight payload
 *   和 bootstrap 脚本; 而改 nonce 方案会让所有页面强制动态渲染, 并且废掉本
 *   部署赖以支撑的 EdgeOne HTML 边缘缓存 (s-maxage=86400), 代价与收益不成比例.
 * - 主路径用 script-src-attr 'none' 补上真正有价值的这一层: 它在 script-src
 *   之前生效, 只管内联事件属性 (onerror= 之类), 而 React 事件是委托到 root 的,
 *   react-markdown 又过了 rehype-sanitize, 所以站内本来就没有内联 handler.
 *   加上它, "content 里塞一个 <img onerror=...>" 这条注入路径被 CSP 直接堵死,
 *   且不影响 Next 自己输出脚本的方式.
 * - /admin 的 script-src 只留 'self' + 内联脚本的 sha256, 完全没有 'unsafe-inline'.
 *   CMS bundle / locales / schema 都由 CI 打进 public/admin/vendor/ (固定 commit),
 *   所以以前那几条 unpkg.com / fonts.gstatic.com / cdn.jsdelivr.net 放行描述的是
 *   一个已经不存在的运行时.
 * - frame-ancestors 'none': 完全禁止被 iframe 嵌入 (防止 clickjacking).
 * - object-src 'none': 禁止 Flash/Java 等插件 (现代浏览器已无意义但属 hygiene).
 * - HSTS 只在 HTTPS 部署下生效; 一年 + includeSubDomains + preload 资格 (慎用 preload,
 *   一旦提交就难撤销, 公网正式域名才加, 测试域名不加)。
 *
 * 拆分: 主体 CSP 不含任何外部 CDN, /admin 单独一套 (同样不含外部 CDN, 但多两条
 *   GitHub API/媒体域), 其他 admin 限制 (no-store / noindex) 在 /admin 路径下叠加。
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
    value: mainContentSecurityPolicy(),
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

// /admin/* 安全头 — 加 no-store + noindex；CSP 里只留 'self' + 内联脚本哈希
//   - CMS bundle / locales / schema 全部由 CI 打进 public/admin/vendor/（固定 commit），
//     运行时同源，因此不再需要任何外部 CDN 放行
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
    value: adminContentSecurityPolicy(),
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
