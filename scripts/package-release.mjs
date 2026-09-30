// scripts/package-release.mjs
//
// Build a self-contained, deployable release artifact from a Next.js
// "standalone" build. Node standard library only. No network access,
// no git, no external dependencies, no push.
//
// Steps:
//   1. derive a unique, strictly [a-z0-9-] releaseId from CI env
//   2. copy .next/standalone into .release-stage/<releaseId> (dereferenced)
//   3. supplement public / .next/static / content
//   4. ensure runtime essentials (server.js, .next/BUILD_ID) exist
//   5. write manifest release.json + public/__release.json
//   6. fail loudly if any sensitive file or symlink leaks into the artifact
//   7. tar the stage and emit a sha256 sidecar

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  writeSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";
import { copyReleaseTree } from "./copy-release-tree.mjs";
import { includeRuntimePackage, resolveRuntimeManifest } from "./include-runtime-package.mjs";
import { createRequire } from "node:module";

const copyLog = (message) => writeSync(1, "package-release: " + message + "\n");

const ROOT = resolve(process.cwd());
const STANDALONE = join(ROOT, ".next", "standalone");
const NEXT_STATIC = join(ROOT, ".next", "static");
const PUBLIC_DIR = join(ROOT, "public");
const CONTENT_DIR = join(ROOT, "content");
const BUILD_ID_FILE = join(ROOT, ".next", "BUILD_ID");
const STAGE_ROOT = join(ROOT, ".release-stage");
const OUTPUT_ROOT = join(ROOT, "outputs");

// CI captures stdout/stderr through pipes. Flush fatal diagnostics synchronously
// before exit so short-lived failures cannot lose their error messages.
function fail(msg) {
  writeSync(2, "package-release: " + msg + "\n");
  process.exit(1);
}

let phase = "initialization";
process.on("uncaughtException", (error) => {
  fail(JSON.stringify({
    phase,
    message: error.message,
    code: error.code,
    syscall: error.syscall,
    path: error.path,
    dest: error.dest,
    stack: error.stack,
  }, null, 2));
});

function beginPhase(name) {
  phase = name;
  writeSync(1, "package-release: phase=" + name + "\n");
}

// ---------------------------------------------------------------------------
// 1. releaseId
// ---------------------------------------------------------------------------
const githubSha = process.env.GITHUB_SHA || "";
if (!/^[0-9a-f]{40}$/.test(githubSha)) {
  fail(
    "GITHUB_SHA must be the full 40-char commit SHA (got: " +
      JSON.stringify(githubSha) +
      ")"
  );
}

const runId = (process.env.GITHUB_RUN_ID || "local").toString();
const runAttempt = (process.env.GITHUB_RUN_ATTEMPT || "0").toString();
const shortSha = githubSha.slice(0, 7);

// sanitize each segment to [a-z0-9-] so the final id is strictly compliant
function sanitize(seg) {
  return seg.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
const releaseId = [sanitize(runId), sanitize(runAttempt), shortSha].join("-");

if (!/^[a-z0-9-]+$/.test(releaseId)) {
  fail("releaseId contains illegal characters: " + releaseId);
}
if (/^-|-$/.test(releaseId)) {
  fail("releaseId must not start or end with a dash: " + releaseId);
}

console.log("package-release: releaseId=" + releaseId);

// ---------------------------------------------------------------------------
// 2. prerequisites + unique stage
// ---------------------------------------------------------------------------
beginPhase("validate standalone prerequisites");
if (!existsSync(STANDALONE)) {
  fail(
    "missing .next/standalone (run `next build` with output:'standalone' first): " +
      STANDALONE
  );
}
if (!existsSync(join(STANDALONE, "server.js"))) {
  fail("missing server.js in standalone: " + join(STANDALONE, "server.js"));
}

mkdirSync(STAGE_ROOT, { recursive: true });
const STAGE = join(STAGE_ROOT, releaseId);
if (existsSync(STAGE)) {
  fail("release stage already exists (refusing to overwrite): " + STAGE);
}

// ---------------------------------------------------------------------------
// 3. copy standalone (dereferenced) + supplements
// ---------------------------------------------------------------------------
beginPhase("copy standalone (dereference links)");
copyReleaseTree(STANDALONE, STAGE, copyLog);
console.log("package-release: copied standalone -> " + STAGE);

function copyIn(src, destRel) {
  if (!existsSync(src)) {
    console.warn("package-release: skip missing source: " + src);
    return;
  }
  const dest = join(STAGE, destRel);
  mkdirSync(dest, { recursive: true });
  copyReleaseTree(src, dest, copyLog);
  console.log("package-release: copied " + src + " -> " + dest);
}
// E2 architecture: public/images/ is shared across all releases via Caddy's
// file_server, not bundled per-release. Copy everything else from public/,
// but skip the images/ subdirectory (served from H:\GDUFSMC-web\public\images\).
if (existsSync(PUBLIC_DIR)) {
  const publicDest = join(STAGE, "public");
  mkdirSync(publicDest, { recursive: true });
  for (const entry of readdirSync(PUBLIC_DIR, { withFileTypes: true })) {
    if (entry.name === "images") {
      copyLog("skip public/images (shared via Caddy)");
      continue;
    }
    const srcPath = join(PUBLIC_DIR, entry.name);
    const destPath = join(publicDest, entry.name);
    copyReleaseTree(srcPath, destPath, copyLog);
  }
  copyLog("copied public/* (excluding images) -> " + publicDest);
} else {
  console.warn("package-release: skip missing source: " + PUBLIC_DIR);
}

// IMPORTANT: Next.js's standalone build copies the project's public/ directory
// into .next/standalone/public/, including public/images/. We already skipped
// the redundant copy from the project root above, but the standalone copy is
// still sitting in STAGE/public/. Remove it so images stay out of the release.
const stagedPublicImages = join(STAGE, "public", "images");
if (existsSync(stagedPublicImages)) {
  rmSync(stagedPublicImages, { recursive: true, force: true });
  copyLog("removed STAGE/public/images (served by Caddy from H:\\GDUFSMC-web\\public)");
}
copyIn(NEXT_STATIC, join(".next", "static"));

// content/ is optionally EXTERNAL.
//
// Default (RELEASE_EXTERNAL_CONTENT unset or "0"): content/ ships inside the
// release exactly as before, and the app reads <release>/content because
// lib/news + lib/leaderboard + app/content fall back to process.cwd().
// This is the safe legacy path; nothing changes for an existing deployment.
//
// "1": content/ is assumed to live outside the release, at the path the
// runtime env var CONTENT_ROOT points to (e.g. H:/GDUFSMC-web/content, which
// is where CMS edits land). The release then ships no content at all, which
// keeps news edits off the deploy path: changing an article is a file change
// in that directory, not a rebuild + republish.
//
// A release built with "1" MUST be started with CONTENT_ROOT set. Without it
// the app falls back to <release>/content, which does not exist, and every
// content-backed page degrades to empty (news list empty, leaderboard shows
// its default, /content/... images 404). That is a loud, visible failure
// rather than a silent one, but it is still a deploy-order dependency, so
// set CONTENT_ROOT in the PM2 ecosystem before publishing such a release.
const externalContent = process.env.RELEASE_EXTERNAL_CONTENT === "1";
if (externalContent) {
  copyLog(
    "SKIP content/ (RELEASE_EXTERNAL_CONTENT=1): content is served from " +
      "CONTENT_ROOT, which the runtime MUST provide (PM2 ecosystem or env)"
  );
  // next.config.ts traces ./content/**/* into .next/standalone, so a stale
  // copy can still land in STAGE even though we skipped our own copyIn().
  // Shipping it would be worse than shipping nothing: the release would look
  // self-contained while actually serving a frozen snapshot that CMS edits
  // never reach. Fail loudly instead of producing a misleading artifact.
  const leakedContent = join(STAGE, "content");
  if (existsSync(leakedContent)) {
    rmSync(leakedContent, { recursive: true, force: true });
    copyLog(
      "removed STAGE/content (traced in by outputFileTracingIncludes; " +
        "external content must come from CONTENT_ROOT at runtime)"
    );
  }
} else {
  copyIn(CONTENT_DIR, "content");
}

// Include every declared Next production dependency, not one missing package
// at a time. Use exactly the versions installed from the frozen lockfile.
// Platform-specific optional dependencies remain supplied by standalone tracing.
beginPhase("include and verify Next production dependencies");
const workspaceRequire = createRequire(join(ROOT, "package.json"));
const nextManifestPath = workspaceRequire.resolve("next/package.json");
const nextManifest = JSON.parse(readFileSync(nextManifestPath, "utf8"));
for (const name of Object.keys(nextManifest.dependencies || {})) {
  includeRuntimePackage(name, nextManifestPath,
    join(STAGE, "node_modules", "next", "node_modules"), copyLog);
}
const releaseRequire = createRequire(join(STAGE, "node_modules", "next", "dist", "shared", "lib", "constants.js"));
for (const name of Object.keys(nextManifest.dependencies || {})) {
  const resolved = resolveRuntimeManifest(name, join(STAGE, "node_modules", "next", "package.json"));
  if (relative(STAGE, resolved).startsWith("..")) fail("Dependency resolved outside release: " + resolved);
  console.log("package-release: verified runtime dependency " + name + " -> " + relative(STAGE, resolved));
}
releaseRequire("@next/env");
const helperPath = releaseRequire.resolve("@swc/helpers/_/_interop_require_default");
const helperRelative = relative(STAGE, helperPath);
if (helperRelative.startsWith("..") || resolve(helperPath) === resolve(STAGE)) {
  fail("SWC helper resolved outside release: " + helperPath);
}
releaseRequire("@swc/helpers/_/_interop_require_default");
console.log("package-release: verified SWC helper inside release: " + helperRelative);

// ---------------------------------------------------------------------------
// 4. ensure runtime essentials (server.js, .next/BUILD_ID)
// ---------------------------------------------------------------------------
let buildId = null;
const stageBuildId = join(STAGE, ".next", "BUILD_ID");
if (existsSync(stageBuildId)) {
  buildId = readFileSync(stageBuildId, "utf8").trim();
} else if (existsSync(BUILD_ID_FILE)) {
  buildId = readFileSync(BUILD_ID_FILE, "utf8").trim();
  mkdirSync(join(STAGE, ".next"), { recursive: true });
  writeFileSync(stageBuildId, buildId);
  console.log("package-release: wrote .next/BUILD_ID into stage");
}
if (!buildId) {
  fail("could not determine buildId (.next/BUILD_ID missing)");
}
if (!existsSync(join(STAGE, "server.js"))) {
  fail("server.js missing in stage after copy: " + join(STAGE, "server.js"));
}

// ---------------------------------------------------------------------------
// 5. manifest
// ---------------------------------------------------------------------------
const manifest = {
  id: releaseId,
  commit: githubSha,
  nodeVersion: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  buildId: buildId,
  createdAt: new Date().toISOString(),
};
const manifestStr = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(join(STAGE, "release.json"), manifestStr);
mkdirSync(join(STAGE, "public"), { recursive: true });
writeFileSync(join(STAGE, "public", "__release.json"), manifestStr);
console.log("package-release: wrote release.json and public/__release.json");

// ---------------------------------------------------------------------------
// 6a. sensitive-file scan (recursive, but skip node_modules to avoid
//     false positives on legitimate dependency files)
// ---------------------------------------------------------------------------
const ENV_RE = /^\.env$|^\.env\./; // .env, .env.local, .env.production, ...
const SECRETS_NAME = "secrets.caddy";
const KEY_EXT_RE = /\.(pem|key|pfx|keystore|jks|asc)$/;
const KEY_NAME_RE = /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)/;

// ---------------------------------------------------------------------------
// 5b. strip dev-only files from STAGE
//     outputFileTracingExcludes only affects the trace output, but the
//     standalone's node_modules (copied via copyReleaseTree from pnpm's
//     .pnpm/ virtual directory) ships .map / .ts / .md files we don't need
//     at runtime. Strip them to reduce the tarball ~75 MB.
//
//     NOTE: We deliberately do NOT strip directories (next/dist/build,
//     next/dist/trace, next/dist/telemetry, next/dist/compiled/@opentelemetry
//     etc.) because Next.js runtime requires helper modules from those paths
//     at boot. Aggressive directory stripping breaks the server with errors
//     like "Cannot find module '../build/output/log'" or
//     "Cannot find module 'next/dist/compiled/@opentelemetry/api'". The
//     .map/.ts/.md file extension strip alone saves ~62 MB; further cuts
//     are not safe without deeper analysis.
// ---------------------------------------------------------------------------
const RUNTIME_SKIP_EXTS = new Set(["map", "ts", "md"]);

function stripDevFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      stripDevFiles(full);
    } else if (entry.isFile()) {
      const ext = entry.name.includes(".")
        ? entry.name.slice(entry.name.lastIndexOf(".") + 1).toLowerCase()
        : "";
      if (RUNTIME_SKIP_EXTS.has(ext)) {
        rmSync(full, { force: true });
      }
    }
  }
}

stripDevFiles(STAGE);
console.log("package-release: stripped dev-only files (.map/.ts/.md) from STAGE");

// ---------------------------------------------------------------------------
// 5c. strip duplicate and unused packages from STAGE/node_modules
//
//     After pnpm dereference + Next.js standalone tracing, the staged
//     node_modules has several known duplications and dead code:
//
//     (a) .pnpm/node_modules/ — pnpm's "hoisted" reverse-lookup layer.
//         Next.js resolves dependencies via .pnpm/<pkg>@ver/node_modules/<pkg>
//         directly; the reverse-lookup layer is never read at runtime.
//         Raw savings: ~20 MB.
//
//     (c) capsize-font-metrics.json appears in both
//         node_modules/next/dist/server/ and
//         .pnpm/next@.../node_modules/next/dist/server/. The first is what
//         Next.js loads at runtime; the second is a tracing artifact. Drop
//         the .pnpm/.../next/ copy. Raw savings: ~4 MB.
//
//     (d) sharp + @img/sharp-* are runtime dependencies of the image API. Keep them.
//         Native binaries must remain available after packaging.
// ---------------------------------------------------------------------------
function stripDuplicates(stage) {
  const nm = join(stage, "node_modules");
  const pnpm = join(nm, ".pnpm");
  if (!existsSync(pnpm)) {
    copyLog("stripDuplicates: no .pnpm/ layout, skipping");
    return;
  }

  // (a) pnpm hoisted reverse-lookup layer
  const pnpmNm = join(pnpm, "node_modules");
  if (existsSync(pnpmNm)) {
    rmSync(pnpmNm, { recursive: true, force: true });
    copyLog("stripDuplicates: removed .pnpm/node_modules/ (pnpm hoisted reverse layer)");
  }

  // (c) duplicate capsize-font-metrics.json inside each .pnpm/<pkg>/.../next/dist/server/
  let capsizeCount = 0;
  for (const pkg of readdirSync(pnpm)) {
    const capsizePath = join(pnpm, pkg, "node_modules", "next", "dist", "server", "capsize-font-metrics.json");
    if (existsSync(capsizePath)) {
      rmSync(capsizePath, { force: true });
      capsizeCount++;
    }
  }
  if (capsizeCount) {
    copyLog(`stripDuplicates: removed ${capsizeCount} duplicate capsize-font-metrics.json copy/copies`);
  }

  // Keep sharp and @img, including virtual-store entries: the admin
  // image conversion route now loads them at runtime.

  // (f) Next.js 16 standalone + outputFileTracing double-copies the entire
  //     project public/ tree under STAGE/public/public/. That nested copy
  //     carries the full public/images directory (~93 MB raw), which gzip
  //     cannot fold. Drop it -- package-release.mjs only needs the top-level
  //     admin/ icons/ sw.js copies that come from copying the project's
  //     public/ directly (images/ is intentionally skipped below).
  const nestedPublic = join(STAGE, "public", "public");
  if (existsSync(nestedPublic)) {
    rmSync(nestedPublic, { recursive: true, force: true });
    copyLog("stripDuplicates: removed STAGE/public/public/ (Next.js 16 standalone + outputFileTracing double-copy of public/)");
  }
}
stripDuplicates(STAGE);

function scanSensitive(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue; // never over-scan dependency tree
      scanSensitive(full);
    } else if (
      ENV_RE.test(e.name) ||
      e.name === SECRETS_NAME ||
      KEY_EXT_RE.test(e.name) ||
      KEY_NAME_RE.test(e.name)
    ) {
      fail(
        "sensitive file would ship in artifact (must not leak): " +
          relative(STAGE, full)
      );
    }
  }
}
scanSensitive(STAGE);
console.log("package-release: sensitive-file scan passed");

// ---------------------------------------------------------------------------
// 6b. symlink scan (recursive, everything) -- dereference copy should have
//     resolved all symlinks; any survivor is a hard failure.
// ---------------------------------------------------------------------------
function scanSymlinks(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isSymbolicLink()) {
      fail(
        "symlink still present after dereferenced copy (must not ship symlinks): " +
          relative(STAGE, full)
      );
    } else if (e.isDirectory()) {
      scanSymlinks(full);
    }
  }
}
scanSymlinks(STAGE);
console.log("package-release: symlink scan passed");

// ---------------------------------------------------------------------------
// 7. tarball + sha256 sidecar
// ---------------------------------------------------------------------------
mkdirSync(OUTPUT_ROOT, { recursive: true });
const tarName = releaseId + ".tar.gz";
const tarPath = join(OUTPUT_ROOT, tarName);

// Use paths relative to the repo root for both -C and -f so tar does not
// misinterpret a Windows drive letter (e.g. "G:") as a remote tape device.
//
// We previously produced .tar.xz (~18 MB) but xz decompression on the
// GitHub Actions windows-2022 runner hangs for 8+ minutes (the runner's
// tar is the GNU tar from Git for Windows, and decompressing ~7400 small
// files with xz is bound by Windows Defender real-time AV inspection of
// every newly-extracted file). gzip decompression is ~8x faster on the
// same content and still universally supported (`-z` works on both bsdtar
// and GNU tar). The artifact grows from ~18 MB to ~25 MB; at 3 MB/s that
// is ~2 seconds longer upload, which is negligible.
const stageRel = relative(ROOT, STAGE);
const outRel = relative(ROOT, tarPath);

const tarRes = spawnSync(
  "tar",
  ["-czf", outRel, "-C", stageRel, "."],
  { stdio: "inherit" }
);
if (tarRes.status !== 0) {
  fail("tar failed with exit code " + String(tarRes.status));
}
console.log("package-release: created tarball " + tarPath);

const buf = readFileSync(tarPath);
const hash = createHash("sha256").update(buf).digest("hex");
const shaLine = hash + "  " + tarName + "\n";
const shaPath = join(OUTPUT_ROOT, releaseId + ".sha256.txt");
writeFileSync(shaPath, shaLine);
console.log("package-release: sha256 " + shaLine.trim());
console.log("package-release: wrote " + shaPath);

console.log("package-release: DONE releaseId=" + releaseId);
