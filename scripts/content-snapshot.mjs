// Data-only content sidecars. This module never switches the live directory.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MiB = 1024 * 1024;
// Keep aligned with verify-content-root.mjs and content-source.mjs.
const LIMITS = { files: 10000, directories: 1000, depth: 16, totalBytes: 512 * MiB,
  textBytes: MiB, imageBytes: 32 * MiB };
const IMAGES = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg"]);
const validator = fileURLToPath(new URL("./verify-content-root.mjs", import.meta.url));
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function commitSha(commit) {
  if (typeof commit !== "string" || !SHA.test(commit)) fail("INVALID_COMMIT", "A full lowercase commit SHA is required");
}
function parts(path) {
  if (typeof path !== "string" || !path) fail("UNSAFE_PATH", "Empty manifest path");
  const result = path.split("/");
  if (result.length > LIMITS.depth || result.some((name) => !name || name === "." || name === ".." ||
      /[<>:"\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))) fail("UNSAFE_PATH", "Unsafe Windows content path");
  return result;
}
function fileLimit(path) {
  if (/^news\/[^/]+\.md$/.test(path) || path === "leaderboard/index.yml") return LIMITS.textBytes;
  if (path.startsWith("news/images/") && IMAGES.has(extname(path).toLowerCase())) return LIMITS.imageBytes;
  fail("UNSUPPORTED_FILE", "Unsupported content file path");
}
async function ancestors(path, allowMissing = false) {
  for (let cursor = resolve(path); ; cursor = dirname(cursor)) {
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("UNSAFE_ROOT", "Content ancestors must be ordinary directories");
    } catch (error) { if (!(allowMissing && error.code === "ENOENT")) throw error; }
    if (dirname(cursor) === cursor) return;
  }
}
async function absent(path) {
  try { await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  fail("DESTINATION_EXISTS", "Sidecar content and manifest must not already exist");
}

export async function createContentManifest(contentRoot, commit) {
  commitSha(commit);
  if (typeof contentRoot !== "string" || !contentRoot) fail("INVALID_ROOT", "A content directory is required");
  const root = resolve(contentRoot);
  await ancestors(root);
  const files = [];
  const seen = new Set();
  let directories = 0, totalBytes = 0;
  async function scan(path, rel = "", depth = 0) {
    if (depth > LIMITS.depth) fail("SNAPSHOT_LIMIT", "Content directory is too deep");
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) fail("UNSAFE_MODE", "Content links and junctions are not allowed");
    if (rel) {
      parts(rel);
      const key = rel.toLowerCase();
      if (seen.has(key)) fail("PATH_COLLISION", "Content paths collide on Windows");
      seen.add(key);
    }
    if (stat.isDirectory()) {
      if (++directories > LIMITS.directories) fail("SNAPSHOT_LIMIT", "Too many content directories");
      for (const name of (await readdir(path)).sort()) await scan(join(path, name), rel ? rel + "/" + name : name, depth + 1);
      return;
    }
    if (!stat.isFile()) fail("UNSAFE_MODE", "Content must contain ordinary files only");
    if (stat.size <= 0 || stat.size > fileLimit(rel)) fail("FILE_LIMIT", "Content file is empty or too large");
    totalBytes += stat.size;
    if (files.length >= LIMITS.files || totalBytes > LIMITS.totalBytes) fail("SNAPSHOT_LIMIT", "Content exceeds snapshot size or file-count policy");
    const bytes = await readFile(path);
    if (bytes.length !== stat.size) fail("CONTENT_CHANGED", "Content changed while creating a manifest");
    files.push({ path: rel, size: bytes.length, sha256: digest(bytes) });
  }
  await scan(root);
  return { version: 1, commit, files };
}

function checkManifest(manifest, expectedCommit) {
  commitSha(expectedCommit);
  if (!record(manifest) || manifest.version !== 1 || manifest.commit !== expectedCommit ||
      !Array.isArray(manifest.files) || Object.keys(manifest).sort().join(",") !== "commit,files,version") {
    fail("INVALID_MANIFEST", "Manifest schema or commit does not match");
  }
  if (manifest.files.length > LIMITS.files) fail("INVALID_MANIFEST", "Manifest file-count exceeds policy");
  const seen = new Set();
  let total = 0;
  for (const entry of manifest.files) {
    if (!record(entry) || Object.keys(entry).sort().join(",") !== "path,sha256,size") fail("INVALID_MANIFEST", "Malformed manifest file entry");
    parts(entry.path);
    if (seen.has(entry.path.toLowerCase())) fail("INVALID_MANIFEST", "Duplicate manifest path");
    seen.add(entry.path.toLowerCase());
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > fileLimit(entry.path) ||
        typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) fail("INVALID_MANIFEST", "Invalid manifest size or digest");
    total += entry.size;
    if (total > LIMITS.totalBytes) fail("INVALID_MANIFEST", "Manifest total size exceeds policy");
  }
}

export async function verifyContentManifest(contentRoot, manifest, expectedCommit) {
  checkManifest(manifest, expectedCommit);
  const actual = await createContentManifest(contentRoot, expectedCommit);
  if (actual.files.length !== manifest.files.length) fail("MANIFEST_MISMATCH", "Snapshot has extra or missing files");
  const expected = new Map(manifest.files.map((entry) => [entry.path, entry]));
  for (const entry of actual.files) {
    const wanted = expected.get(entry.path);
    if (!wanted || wanted.size !== entry.size || wanted.sha256 !== entry.sha256) {
      fail("MANIFEST_MISMATCH", "Snapshot differs from its manifest: " + entry.path);
    }
  }
  return manifest;
}

export async function validateContent(parent) {
  let result;
  try {
    result = await exec(process.execPath, [validator, resolve(parent), "--json"], {
      encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 4 * MiB,
    });
  } catch (cause) {
    const error = new Error("Content validation failed");
    error.code = "CONTENT_VALIDATION_FAILED";
    try { error.report = JSON.parse(cause.stdout); } catch { /* No candidate output in diagnostic messages. */ }
    throw error;
  }
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { fail("INVALID_VALIDATOR_OUTPUT", "Content validator did not return JSON"); }
  if (!record(report?.summary) || report.summary.errors !== 0) fail("CONTENT_VALIDATION_FAILED", "Content validator reported errors");
  return report;
}

export async function writeContentSidecar(parent, sourceParent, commit) {
  commitSha(commit);
  if (typeof parent !== "string" || !parent || typeof sourceParent !== "string" || !sourceParent) {
    fail("INVALID_ROOT", "Sidecar destination and source parent are required");
  }
  const destination = resolve(parent);
  const source = join(resolve(sourceParent), "content");
  const overlap = relative(source, destination);
  if (!overlap || (!isAbsolute(overlap) && overlap !== ".." && !overlap.startsWith(".." + sep))) {
    fail("UNSAFE_DESTINATION", "A sidecar cannot be written inside its source content");
  }
  await ancestors(destination, true);
  await absent(join(destination, "content"));
  await absent(join(destination, "manifest.json"));
  const manifest = await createContentManifest(source, commit);
  await mkdir(destination, { recursive: true });
  await mkdir(join(destination, "content"));
  for (const entry of manifest.files) {
    const path = join(destination, "content", ...parts(entry.path));
    await mkdir(dirname(path), { recursive: true });
    const bytes = await readFile(join(source, ...parts(entry.path)));
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) fail("CONTENT_CHANGED", "Content changed while copying the sidecar");
    await writeFile(path, bytes, { flag: "wx" });
  }
  await verifyContentManifest(join(destination, "content"), manifest, commit);
  await validateContent(destination);
  await writeFile(join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}
