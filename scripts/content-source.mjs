// Trusted GitHub data reader. Never checks out or executes candidate code.
import { createHash } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MiB = 1024 * 1024;
const LIMITS = Object.freeze({ files: 10000, directories: 1000, depth: 16,
  totalBytes: 512 * MiB, textBytes: MiB, imageBytes: 32 * MiB });
const SHA = /^[a-f0-9]{40}$/;
const IMAGE = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg"]);
const STATUSES = new Set(["ahead", "identical", "behind", "diverged"]);
const FILE_STATUSES = new Set(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]);

export class ContentSourceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "ContentSourceError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}
const fail = (code, message, status) => { throw new ContentSourceError(code, message, status); };
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function sha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) fail("INVALID_SHA", label + " must be a full lowercase Git SHA");
  return value;
}
function contentPath(path) {
  return typeof path === "string" && path.startsWith("content/") && path.length > "content/".length;
}
function safeParts(path) {
  if (typeof path !== "string" || path.length === 0) fail("UNSAFE_PATH", "Empty content path");
  const parts = path.split("/");
  if (parts.length > LIMITS.depth || parts.some((part) => !part || part === "." || part === ".." ||
    /[<>:"\\|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    fail("UNSAFE_PATH", "Unsafe or over-deep Windows content path");
  }
  return parts;
}
function allowedFile(path) {
  if (/^news\/[^/]+\.md$/.test(path) || path === "leaderboard/index.yml") return LIMITS.textBytes;
  if (path.startsWith("news/images/") && IMAGE.has(extname(path).toLowerCase())) return LIMITS.imageBytes;
  fail("UNSUPPORTED_FILE", "Snapshot contains an unsupported content file");
}
function comparisonFile(file) {
  if (!isRecord(file) || typeof file.filename !== "string" || !file.filename || !FILE_STATUSES.has(file.status) ||
      (file.previous_filename !== undefined && (typeof file.previous_filename !== "string" || !file.previous_filename)) ||
      (file.status === "renamed" && !file.previous_filename)) {
    fail("INVALID_COMPARISON", "Malformed comparison file entry");
  }
  return { path: file.filename, ...(file.previous_filename ? { previousPath: file.previous_filename } : {}), status: file.status };
}
function touchesCode(file) {
  return !contentPath(file.path) || (file.previousPath !== undefined && !contentPath(file.previousPath));
}

async function boundedJson(response, maxBytes) {
  const length = Number(response.headers?.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) fail("RESPONSE_LIMIT", "GitHub response exceeds the size limit");
  let text;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          fail("RESPONSE_LIMIT", "GitHub response exceeds the size limit");
        }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    text = Buffer.concat(chunks, size).toString("utf8");
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) fail("RESPONSE_LIMIT", "GitHub response exceeds the size limit");
  }
  try { return JSON.parse(text); }
  catch { fail("INVALID_RESPONSE", "GitHub returned invalid JSON"); }
}

/** fetchImpl is injectable for offline tests. Credentials never enter errors. */
export class GitHubContentSource {
  #base;
  #token;
  #fetch;
  constructor({ repo, token, fetchImpl = globalThis.fetch } = {}) {
    if (typeof repo !== "string" || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repo) ||
      repo.split("/").some((part) => part === "." || part === "..") || repo.length > 200) {
      fail("INVALID_REPO", "repo must be an owner/repository pair");
    }
    if (token !== undefined && (typeof token !== "string" || /[\r\n]/.test(token))) {
      fail("INVALID_TOKEN", "Invalid GitHub credential format");
    }
    if (typeof fetchImpl !== "function") fail("INVALID_FETCH", "fetchImpl must be a function");
    this.#base = "https://api.github.com/repos/" + repo;
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  async #get(path, maxBytes = 2 * MiB) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
        if (this.#token) headers.Authorization = "Bearer " + this.#token;
        const response = await this.#fetch(this.#base + path, { headers, signal: controller.signal, redirect: "error" });
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          const retry = Number(response.headers?.get("retry-after"));
          await response.body?.cancel();
          clearTimeout(timer);
          await new Promise((done) => setTimeout(done, Number.isFinite(retry) && retry >= 0 ? Math.min(retry * 1000, 2000) : 250 * (attempt + 1)));
          continue;
        }
        if (response.status !== 200) {
          await response.body?.cancel();
          fail(response.status === 404 ? "NOT_FOUND" : "HTTP_ERROR", "GitHub request failed with HTTP " + response.status, response.status);
        }
        return await boundedJson(response, maxBytes);
      } catch (error) {
        if (error instanceof ContentSourceError) throw error;
        // Do not propagate fetch messages, URLs, headers, or response bodies.
        if (attempt === 2) fail(controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR", "GitHub request failed after bounded retries");
        await new Promise((done) => setTimeout(done, 250 * (attempt + 1)));
      } finally { clearTimeout(timer); }
    }
    fail("NETWORK_ERROR", "GitHub request failed");
  }

  async head() {
    const result = await this.#get("/commits/main");
    return sha(result?.sha, "main commit");
  }

  async compare(base, candidate) {
    sha(base, "base"); sha(candidate, "candidate");
    // GitHub includes changed files only on page 1, capped at 300 across the
    // entire comparison. Paging commits cannot recover a truncated file list.
    const result = await this.#get("/compare/" + base + "..." + candidate + "?per_page=100&page=1", 8 * MiB);
    if (!isRecord(result) || !STATUSES.has(result.status) || !Array.isArray(result.files) ||
        !Number.isSafeInteger(result.total_commits) || result.total_commits < 0 ||
        result.base_commit?.sha !== base) fail("INVALID_COMPARISON", "GitHub comparison is incomplete or mismatched");
    if (result.status === "ahead" && result.merge_base_commit?.sha !== base) {
      fail("INVALID_COMPARISON", "Comparison does not prove the code baseline is an ancestor");
    }
    if (result.status === "identical" && (base !== candidate || result.files.length !== 0 || result.total_commits !== 0)) {
      fail("INVALID_COMPARISON", "Inconsistent identical comparison");
    }
    const files = result.files.map(comparisonFile);
    const comparison = { base, candidate, status: result.status, files, totalCommits: result.total_commits,
      truncated: files.length >= 300 || result.total_commits > 100 };
    if (comparison.truncated || result.status !== "ahead" || files.some(touchesCode)) return comparison;
    // Net diffs hide a code change followed by a revert. Inspect every commit
    // in a bounded history; long/incomplete histories always require full deploy.
    if (!Array.isArray(result.commits) || result.total_commits < 1 ||
        result.commits.length !== result.total_commits || result.commits.at(-1)?.sha !== candidate ||
        new Set(result.commits.map((item) => item?.sha)).size !== result.total_commits) {
      fail("INVALID_COMPARISON", "Comparison omitted or mismatched its commit history");
    }
    const seen = new Set(files.map((file) => JSON.stringify(file)));
    for (const commit of result.commits) {
      sha(commit?.sha, "comparison commit");
      for (let page = 1; page <= 30; page++) {
        const detail = await this.#get("/commits/" + commit.sha + "?per_page=100&page=" + page, 8 * MiB);
        if (detail?.sha !== commit.sha || !Array.isArray(detail.files) || detail.files.length > 100) {
          fail("INVALID_COMPARISON", "Commit file pagination is incomplete or mismatched");
        }
        for (const item of detail.files) {
          const file = comparisonFile(item);
          const key = JSON.stringify(file);
          if (!seen.has(key)) { seen.add(key); files.push(file); }
          if (touchesCode(file)) return comparison;
        }
        if (detail.files.length < 100) break;
        if (page === 30) comparison.truncated = true;
      }
      if (comparison.truncated) break;
    }
    return comparison;
  }

  async snapshot(commit, destinationParent) {
    sha(commit, "commit");
    if (typeof destinationParent !== "string" || !destinationParent) fail("INVALID_DESTINATION", "A staging destination is required");
    const result = await this.#get("/git/trees/" + commit + "?recursive=1", 16 * MiB);
    if (!isRecord(result) || !Array.isArray(result.tree) || result.truncated !== false) {
      fail("TRUNCATED_TREE", "A complete Git tree is required");
    }
    const entries = [];
    const names = new Map();
    const directoryNames = new Set([""]);
    let total = 0;
    let contentTree = false;
    for (const item of result.tree) {
      if (!isRecord(item) || typeof item.path !== "string") fail("INVALID_TREE", "Malformed Git tree entry");
      if (item.path !== "content" && !contentPath(item.path)) continue;
      if (item.path === "content") {
        if (contentTree || item.type !== "tree" || item.mode !== "040000") fail("INVALID_TREE", "content must be one ordinary directory");
        contentTree = true;
        continue;
      }
      const path = item.path.slice("content/".length);
      const parts = safeParts(path);
      const normalized = path.toLowerCase();
      if (names.has(normalized)) fail("PATH_COLLISION", "Content paths collide on Windows");
      names.set(normalized, item.type);
      for (let count = 1; count < parts.length; count++) directoryNames.add(parts.slice(0, count).join("/"));
      if (item.type === "tree" && item.mode === "040000") {
        directoryNames.add(path);
      } else {
        if (item.type !== "blob" || item.mode !== "100644") fail("UNSAFE_MODE", "Only ordinary non-executable content files are allowed");
        sha(item.sha, "blob");
        const limit = allowedFile(path);
        if (!Number.isSafeInteger(item.size) || item.size <= 0 || item.size > limit) fail("FILE_LIMIT", "Content file exceeds the size policy");
        total += item.size;
        entries.push({ path, parts, sha: item.sha, size: item.size });
        if (entries.length > LIMITS.files || total > LIMITS.totalBytes) fail("SNAPSHOT_LIMIT", "Snapshot exceeds file-count or total-size policy");
      }
      if (directoryNames.size > LIMITS.directories) fail("SNAPSHOT_LIMIT", "Snapshot exceeds directory-count policy");
    }
    if (!contentTree) fail("MISSING_CONTENT", "The commit has no content tree");
    for (const dir of directoryNames) {
      if (dir && names.has(dir.toLowerCase()) && names.get(dir.toLowerCase()) !== "tree") {
        fail("PATH_COLLISION", "A content file is also used as a directory");
      }
    }
    const parent = resolve(destinationParent);
    await checkDestinationAncestors(parent);
    await mkdir(parent, { recursive: true });
    const root = join(parent, "content");
    try { await mkdir(root); }
    catch (error) { if (error.code === "EEXIST") fail("DESTINATION_EXISTS", "Staging content directory must not already exist"); throw error; }
    const manifest = { version: 1, commit, files: [] };
    const blobs = new Map();
    for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path, "en"))) {
      let bytes = blobs.get(entry.sha);
      if (!bytes) {
        const encodedSize = Math.ceil(entry.size / 3) * 4;
        // GitHub wraps base64 lines; JSON escapes those line endings too.
        const blob = await this.#get("/git/blobs/" + entry.sha, encodedSize + Math.ceil(encodedSize / 60) * 4 + 128 * 1024);
        if (!isRecord(blob) || blob.sha !== entry.sha || blob.size !== entry.size || blob.encoding !== "base64" || typeof blob.content !== "string") {
          fail("INVALID_BLOB", "GitHub blob metadata differs from the tree");
        }
        const encoded = blob.content.replace(/[\r\n]/g, "");
        const padding = encoded.indexOf("=");
        if (encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded) ||
            (padding !== -1 && (padding < encoded.length - 2 || !/^={1,2}$/.test(encoded.slice(padding))))) {
          fail("INVALID_BLOB", "GitHub blob is not valid base64");
        }
        bytes = Buffer.from(encoded, "base64");
        if (bytes.length !== entry.size || createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex") !== entry.sha) {
          fail("BLOB_HASH_MISMATCH", "Downloaded bytes do not match the Git blob SHA");
        }
        blobs.set(entry.sha, bytes);
      }
      if (bytes.length !== entry.size) fail("INVALID_BLOB", "Duplicate blob size differs from the tree");
      const destination = resolve(root, ...entry.parts);
      const rel = relative(root, destination);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) fail("UNSAFE_PATH", "File escapes the staging directory");
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: "wx" });
      manifest.files.push({ path: entry.path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    return manifest;
  }
}

async function checkDestinationAncestors(path) {
  for (let cursor = path; ; cursor = dirname(cursor)) {
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("UNSAFE_DESTINATION", "Staging ancestors must be ordinary directories");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (dirname(cursor) === cursor) break;
  }
}

/** Decision uses the deployed CODE commit, never HEAD~1 or content baseline. */
export function decideContentUpdate({ codeCommit, currentContentCommit, candidateCommit, headCommit, comparison } = {}) {
  sha(candidateCommit, "candidateCommit"); sha(headCommit, "headCommit");
  if (candidateCommit !== headCommit) return { mode: "stale", reason: "Candidate is no longer main HEAD" };
  if (candidateCommit === currentContentCommit) return { mode: "noop", reason: "This content commit is already active" };
  if (typeof codeCommit !== "string" || !SHA.test(codeCommit)) return { mode: "full", reason: "Deployed code baseline is missing or invalid" };
  if (!isRecord(comparison) || comparison.base !== codeCommit || comparison.candidate !== candidateCommit ||
      !Array.isArray(comparison.files) || comparison.truncated !== false) {
    return { mode: "full", reason: "A complete comparison against deployed code is required" };
  }
  if (!["ahead", "identical"].includes(comparison.status)) return { mode: "full", reason: "Deployed code is not a proven ancestor of candidate" };
  if (comparison.status === "identical") {
    if (codeCommit !== candidateCommit || comparison.files.length !== 0) return { mode: "full", reason: "Inconsistent identical comparison" };
    return { mode: "content", reason: "Code is already deployed; synchronize its content snapshot" };
  }
  if (comparison.files.length === 0) return { mode: "full", reason: "Empty change list does not establish a content-only update" };
  for (const file of comparison.files) {
    if (!isRecord(file) || !FILE_STATUSES.has(file.status) || !contentPath(file.path) ||
        (file.status === "renamed" && !file.previousPath) ||
        (file.previousPath !== undefined && !contentPath(file.previousPath))) {
      return { mode: "full", reason: "Changes since deployed code include non-content paths or incomplete rename data" };
    }
    try {
      safeParts(file.path.slice("content/".length));
      if (file.previousPath) safeParts(file.previousPath.slice("content/".length));
    } catch { return { mode: "full", reason: "Comparison contains unsafe content paths" }; }
  }
  return { mode: "content", reason: "All changes since deployed code are confined to content" };
}
