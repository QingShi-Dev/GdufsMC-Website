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
copyIn(PUBLIC_DIR, "public");
copyIn(NEXT_STATIC, join(".next", "static"));
copyIn(CONTENT_DIR, "content");

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

// use paths relative to the repo root for both -C and -f so tar does not
// misinterpret a Windows drive letter (e.g. "G:") as a remote tape device.
const stageRel = relative(ROOT, STAGE);
const outRel = join(relative(ROOT, OUTPUT_ROOT), tarName);

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
