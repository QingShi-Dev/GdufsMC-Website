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
 */
const SECURITY_HEADERS: { key: string; value: string }[] = [
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
    // 如果要走 https://hstspreload.org/ 预提交, 改成:
    // value: "max-age=63072000; includeSubDomains; preload"
    // 注意: preload 一旦提交极难撤销, 只在确认长期用 https 时再加
  },
  // CSP — default-src 'self' 是兜底, 各资源类型单独细化
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js 16 + framer-motion + Tailwind v4 需要 unsafe-inline
      // unpkg.com: Sveltia CMS 从 CDN 加载脚本 (/admin 路由)
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline'",
      // raw.githubusercontent.com: Sveltia 预览媒体 (上传/已上传图片)
      // avatars.githubusercontent.com: Sveltia 显示 GitHub 用户头像
      "img-src 'self' data: blob: https://raw.githubusercontent.com https://avatars.githubusercontent.com",
      // fonts.gstatic.com / cdn.jsdelivr.net: Sveltia CMS 字体 (Material Symbols + Source Sans 3 + Noto Mono)
//   jsdelivr 是 fontsource CDN, Sveltia 默认从这拉字体
      "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
      // api.github.com: Sveltia GitHub backend 读写
      // raw.githubusercontent.com: 媒体 fetch
      // unpkg.com: Sveltia 运行时 fetch locales/*.json + schema/* (locale 化 / 配置校验)
      // data:: Sveltia 用 fetch 加载 data:image/svg+xml 的 logo SVG
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
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
