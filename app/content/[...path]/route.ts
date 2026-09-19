/**
 * /content/[...path] — catch-all route 服务仓库根 content/ 下任意静态文件
 *
 * 用途:
 * - Sveltia CMS 上传图片存到 content/news/images/<hash>.webp
 * - markdown 用绝对路径 /content/news/images/<hash>.webp 引用
 * - 这个 route 把请求映射到 content/ 下对应文件, 返回字节流
 *
 * 设计:
 * - catch-all [...path] 匹配 /content/foo/bar/baz
 * - URL 路径 = content/ + 文件相对路径, 用 path.join 拼
 * - 安全: 用 path.relative 防 ../ 路径遍历 (跨平台稳)
 *
 * MIME: 按扩展名推断 (webp/png/jpg/gif/svg)
 *
 * 缓存: 短缓存 + must-revalidate
 */

import { readFile, stat } from "node:fs/promises";
import { resolve, extname, relative, isAbsolute } from "node:path";
import { NextResponse } from "next/server";

const CONTENT_ROOT = resolve(process.cwd(), "content");

const MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path: segments } = await params;
  if (!segments || segments.length === 0) {
    return new NextResponse("not found", { status: 404 });
  }

  // 拼绝对路径 + 防路径遍历 (../)
  const requested = resolve(CONTENT_ROOT, ...segments);
  const rel = relative(CONTENT_ROOT, requested);
  if (rel.startsWith("..") || rel === ".." || isAbsolute(rel)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  try {
    const st = await stat(requested);
    if (!st.isFile()) {
      return new NextResponse("not a file", { status: 404 });
    }
    const buf = await readFile(requested);
    const mime = MIME[extname(requested).toLowerCase()] ?? "application/octet-stream";

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(st.size),
        "Cache-Control": "public, max-age=3600, must-revalidate",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}