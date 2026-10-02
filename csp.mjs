/**
 * Content-Security-Policy construction, shared by next.config.ts and
 * scripts/test-csp.mjs so the two can never drift apart.
 *
 * Why a module instead of inline arrays: the admin policy's script-src carries a
 * sha256 of the inline <script> in public/admin/index.html. A hand-copied hash
 * silently stops matching the moment that script is edited, and the symptom is a
 * blank admin page with a CSP error nobody reads. Deriving it from the file at
 * build time makes the drift impossible.
 *
 * Plain .mjs (not .ts) so the test can import it with plain node, and so
 * next.config.ts can bundle it without pulling anything into the app.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ADMIN_INDEX = resolve(process.cwd(), "public/admin/index.html");

/**
 * sha256 CSP sources for every inline <script> in the admin shell.
 *
 * The regex only matches elements with no `src`, so the vendored Sveltia bundle
 * under public/admin/vendor/ is correctly ignored -- it is served from our own
 * origin and is already covered by 'self'.
 *
 * @returns {string[]} e.g. ["'sha256-1dlm...'"]
 */
export function adminInlineScriptSources() {
  const html = readFileSync(ADMIN_INDEX, "utf8");
  const bodies = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1],
  );
  if (bodies.length === 0) {
    // Fail the build rather than ship a policy that silently permits nothing.
    throw new Error("public/admin/index.html declares no inline <script>; the admin CSP hash list cannot be built.");
  }
  return bodies.map(
    (body) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`,
  );
}

/**
 * CSP for the public site.
 *
 * script-src keeps 'unsafe-inline' because Next.js emits inline flight-payload
 * and bootstrap scripts, and because a per-request nonce would force dynamic
 * rendering on every page and disable the EdgeOne s-maxage=86400 HTML caching
 * this deployment depends on.
 *
 * script-src-attr 'none' is the layer worth having: it is evaluated BEFORE
 * script-src's 'unsafe-inline' and only governs inline event handler attributes
 * (onerror=, onclick=, ...). React attaches listeners through the root and
 * react-markdown runs rehype-sanitize, so the app itself has no inline handlers.
 * This closes the <img onerror=...> style injection that content edits could
 * otherwise reach, without touching how Next.js serves its own scripts.
 *
 * style-src is split so the two surfaces can be tightened independently later:
 * style-src-attr must keep 'unsafe-inline' because framer-motion and Next both
 * render style="" attributes during SSR, while style-src-elem is the surface a
 * future nonce/hash migration would have to satisfy.
 */
export function mainContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "style-src-elem 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * CSP for the Sveltia CMS admin.
 *
 * No 'unsafe-inline' in script-src and no third-party origin at all. The CMS
 * bundle, its locales and its config schema are all built into
 * public/admin/vendor/ by CI at a pinned commit, so the old unpkg.com /
 * fonts.gstatic.com / cdn.jsdelivr.net allowances described a runtime that no
 * longer exists (upstream bundles the schema specifically so a CDN-blocking CSP
 * works -- see vite.config.js "bundle-schema").
 *
 * style-src keeps 'unsafe-inline' on purpose: the admin shell has a static <style>
 * block, and the Svelte bundle injects styles at runtime. Style injection cannot
 * execute script in any current browser, so this is a far smaller concession
 * than the script-src one and is not worth fighting a third-party bundle over.
 */
export function adminContentSecurityPolicy() {
  return [
    "default-src 'self'",
    `script-src 'self' ${adminInlineScriptSources().join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https://raw.githubusercontent.com https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' data: https://api.github.com https://raw.githubusercontent.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
