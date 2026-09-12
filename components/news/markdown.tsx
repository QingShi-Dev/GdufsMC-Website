"use client";

/**
 * Markdown 渲染器 — News 详情页正文用
 * - react-markdown + remark-gfm (GFM = GitHub Flavored Markdown)
 * - 自己写 components, 不依赖 @tailwindcss/typography
 * - 图片: rounded-xl + 边框 + 懒加载
 * - 链接: 外链自动 target=_blank + rel=noopener
 * - 代码块 / 行内代码 / 表格 / 引用 / 列表 全支持
 *
 * 客户端组件: react-markdown 内部用 hook, 不能在 RSC 里直接用
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

export function MarkdownContent({ children }: { children: string }) {
  return (
    <div className="text-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          p: ({ children }) => <p className="mb-4 leading-relaxed text-base">{children}</p>,
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold mt-8 mb-4 text-slate-900">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-bold mt-6 mb-3 text-slate-900">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-bold mt-5 mb-2 text-slate-900">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-6 mb-4 space-y-1.5 marker:text-slate-400">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 mb-4 space-y-1.5 marker:text-slate-400 marker:font-semibold">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => {
            const isExternal = typeof href === "string" && /^https?:\/\//.test(href);
            return (
              <a
                href={href}
                className="text-brand-600 hover:underline font-medium"
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
              >
                {children}
              </a>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-brand-300 pl-4 my-4 text-slate-600 italic bg-brand-50/50 py-2 rounded-r">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) => {
            const isBlock = typeof className === "string" && className.includes("language-");
            if (isBlock) {
              return (
                <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto my-4 text-sm font-mono leading-relaxed">
                  <code>{children}</code>
                </pre>
              );
            }
            return (
              <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 text-[0.9em] font-mono">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          img: ({ src, alt }) => {
            // P1-4: typeof guard, src 不是 string 时不渲染 (避免 broken <img src="">)
            if (typeof src !== "string" || src.length === 0) return null;
            return (
              // eslint-disable-next-line @next/next/no-img-element -- Markdown 内的本地图片
              <img
                src={src}
                alt={alt ?? ""}
                loading="lazy"
                className="rounded-xl my-6 w-full border border-slate-200/80 shadow-sm"
              />
            );
          },
          hr: () => <hr className="my-8 border-slate-200" />,
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-900">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-slate-100 px-3 py-2">{children}</td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
