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
      "font-src 'self' data:",
      // api.github.com: Sveltia GitHub backend 读写
      // raw.githubusercontent.com: 媒体 fetch
      "connect-src 'self' https://api.github.com https://raw.githubusercontent.com",
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
};

export default nextConfig;
