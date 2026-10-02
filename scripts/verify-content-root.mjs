// Validate a complete, stationary content snapshot BEFORE activation.
// Usage: node scripts/verify-content-root.mjs <parent-or-content-dir>
//          [--json] [--allow-empty-news]
// Exit: 0 valid; 1 invalid content; 2 usage / filesystem IO failure.
// This CLI does not synchronize files or certify a changing live directory.
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import matter from "gray-matter";
import * as yaml from "js-yaml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { slugify } from "../lib/slugify-core.mjs";

const MiB = 1024 * 1024;
// Fixed deployment policy, never supplied by candidate content.
const limits = { files: 10000, directories: 1000, depth: 16, totalBytes: 512 * MiB, textBytes: MiB, imageBytes: 32 * MiB };
const imageExtensions = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg"]);
const categories = new Set(["公告", "更新", "活动", "公告-维护"]);
const parser = unified().use(remarkParse).use(remarkGfm);
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const allowEmpty = args.includes("--allow-empty-news");
const targets = args.filter((arg) => !arg.startsWith("--"));
const errors = [];
const warnings = [];
const files = new Map();
const directories = new Set();
let content = "";
let ioFailed = false;
let markdownFiles = 0;
let imageRefs = 0;
let fileCount = 0;
let directoryCount = 0;
let totalBytes = 0;
const articleSlugs = [];
const err = (scope, message) => errors.push({ scope, message });
const warn = (scope, message) => warnings.push({ scope, message });
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const outside = (root, path) => {
  const rel = relative(root, path);
  return rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel);
};

function report(code) {
  const summary = {
    contentRoot: content, markdownFiles, imageRefs, fileCount, totalBytes, articleSlugs,
    errors: errors.length, warnings: warnings.length,
  };
  if (asJson) {
    console.log(JSON.stringify({ summary, errorList: errors, warningList: warnings }, null, 2));
  } else {
    console.log("verify-content: root=" + content);
    console.log("verify-content: " + markdownFiles + " markdown file(s), " + imageRefs + " image ref(s)");
    for (const item of warnings) console.log("verify-content: WARN [" + item.scope + "] " + item.message);
    for (const item of errors) console.log("verify-content: ERROR [" + item.scope + "] " + item.message);
    console.log(code === 0 ? "verify-content: OK" : "verify-content: FAILED");
  }
  process.exitCode = code;
}
function io(scope, error) {
  ioFailed = true;
  err(scope, "filesystem IO failure: " + error.message);
}

// lstat on content alone misses symlink/junction ancestors.
function checkAncestors(path) {
  for (let cursor = path; ; cursor = dirname(cursor)) {
    const st = lstatSync(cursor);
    if (st.isSymbolicLink()) {
      err("root", "symbolic link or junction is not allowed: " + cursor);
      return false;
    }
    if (!st.isDirectory()) {
      err("root", "expected a directory: " + cursor);
      return false;
    }
    if (dirname(cursor) === cursor) return true;
  }
}
class ContentLimitError extends Error {}
function scan(path, rel = "", depth = 0) {
  if (depth > limits.depth) { err(rel, "directory depth exceeds " + limits.depth); return; }
  const st = lstatSync(path);
  if (st.isSymbolicLink()) { err(rel, "symbolic links and junctions are not allowed"); return; }
  if (outside(content, realpathSync(path))) { err(rel, "resolved path escapes content"); return; }
  if (st.isDirectory()) {
    directoryCount++;
    if (directoryCount > limits.directories) throw new ContentLimitError("too many directories");
    directories.add(rel);
    for (const name of readdirSync(path).sort()) {
      if (/[<>:"\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        err(rel, "unsupported Windows filename: " + name);
        continue;
      }
      scan(join(path, name), rel ? rel + "/" + name : name, depth + 1);
    }
    return;
  }
  if (!st.isFile()) { err(rel, "expected a regular file"); return; }
  fileCount++;
  totalBytes += st.size;
  if (fileCount > limits.files || totalBytes > limits.totalBytes) {
    throw new ContentLimitError("snapshot exceeds file-count or total-size limit");
  }
  const isNews = /^news\/[^/]+\.md$/.test(rel);
  const isBoard = rel === "leaderboard/index.yml";
  const isImage = rel.startsWith("news/images/") && imageExtensions.has(extname(rel).toLowerCase());
  if (!isNews && !isBoard && !isImage) { err(rel, "unsupported content path or file type"); return; }
  const max = isImage ? limits.imageBytes : limits.textBytes;
  if (st.size === 0 || st.size > max) { err(rel, "file must be nonempty and at most " + max + " bytes"); return; }
  files.set(rel, { path, size: st.size });
}

// YAML Date objects can already have rolled over, so check the lexical scalar.
function validDate(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return false;
  return !match[4] || (Number(match[4]) < 24 && Number(match[5]) < 60 &&
    Number(match[6]) < 60 && Number.isFinite(Date.parse(value)));
}

function verifyImage(url, scope) {
  imageRefs++;
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname || parsed.username || parsed.password) throw new Error("invalid URL");
      warn(scope, "external image is not checked offline: " + url);
    } catch { err(scope, "invalid external image URL: " + url); }
    return;
  }
  // Public assets belong to code releases and cannot be certified here.
  if (!url.startsWith("/content/")) { err(scope, "local image must use /content/: " + url); return; }
  let decoded;
  try {
    decoded = decodeURIComponent(url.split(/[?#]/, 1)[0].slice("/content/".length));
  } catch { err(scope, "malformed image URL encoding: " + url); return; }
  const parts = decoded.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\\:\u0000-\u001f]/.test(part)) ||
      outside(content, resolve(content, ...parts))) {
    err(scope, "image path escapes content or is unsafe: " + url);
    return;
  }
  const file = files.get(parts.join("/"));
  if (!file || !decoded.startsWith("news/images/") || !imageExtensions.has(extname(decoded).toLowerCase())) {
    err(scope, "image reference is not a permitted regular file: " + url);
  }
}

function markdownImages(body, scope) {
  const nodes = [];
  const pending = [parser.parse(body)];
  while (pending.length) {
    const node = pending.pop();
    nodes.push(node);
    if (node.children) pending.push(...node.children.slice().reverse());
  }
  const definitions = new Map();
  for (const node of nodes) {
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  }
  for (const node of nodes) {
    if (node.type === "image") verifyImage(node.url, scope);
    if (node.type === "imageReference") {
      const url = definitions.get(node.identifier);
      if (url) verifyImage(url, scope);
      else err(scope, "unresolved Markdown image reference: " + node.identifier);
    }
  }
}

function readText(file) {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file.path));
}
function verifyNews() {
  if (!directories.has("news")) err("news", "content/news directory is required");
  const articles = [...files].filter(([name]) => /^news\/[^/]+\.md$/.test(name));
  markdownFiles = articles.length;
  if (articles.length === 0 && !allowEmpty) {
    err("news", "no markdown articles; use --allow-empty-news only for an intentional empty snapshot");
  }
  const slugs = new Map();
  for (const [scope, file] of articles) {
    let raw;
    try { raw = readText(file); } catch (error) {
      if (error.code === "ERR_ENCODING_INVALID_ENCODED_DATA") err(scope, "invalid UTF-8");
      else io(scope, error);
      continue;
    }
    try {
      // gray-matter also has executable engines. Check ONLY plain YAML before
      // invoking it; never evaluate a candidate's ---javascript frontmatter.
      if (!/^---[ \t]*\r?\n/.test(raw) || !/^---[ \t]*\r?$/m.test(raw.slice(raw.indexOf("\n") + 1))) {
        err(scope, "plain YAML frontmatter delimiters are required");
        continue;
      }
      const parsed = matter(raw);
      const fm = parsed.data;
      const lexical = yaml.load(parsed.matter, { schema: yaml.JSON_SCHEMA });
      if (!record(fm) || !record(lexical)) { err(scope, "frontmatter must be an object"); continue; }
      for (const key of ["title", "category", "cover"]) {
        if (!text(fm[key])) err(scope, "frontmatter." + key + " must be a nonempty string");
      }
      if (text(fm.category) && !categories.has(fm.category)) err(scope, "unknown news category: " + fm.category);
      for (const key of ["summary", "badge", "slug"]) {
        if (fm[key] !== undefined && typeof fm[key] !== "string") err(scope, "frontmatter." + key + " must be a string");
      }
      if (fm.pinned !== undefined && typeof fm.pinned !== "boolean") err(scope, "frontmatter.pinned must be a boolean");
      if (!validDate(lexical.date)) err(scope, "frontmatter.date must be a real YYYY-MM-DD or ISO timestamp");
      else if (fm.date instanceof Date) {
        if (!Number.isFinite(fm.date.getTime())) err(scope, "invalid YAML date");
        else warn(scope, "unquoted YAML date; quoting YYYY-MM-DD avoids runtime coercion");
      } else if (typeof fm.date !== "string") err(scope, "unexpected frontmatter.date type");
      if (text(fm.title) && (fm.slug === undefined || typeof fm.slug === "string")) {
        const slug = fm.slug?.trim() || slugify(fm.title);
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) err(scope, "slug must contain lowercase letters, numbers and separated hyphens");
        if (slugs.has(slug)) err(scope, "duplicate effective slug " + slug + " (also " + slugs.get(slug) + ")");
        else { slugs.set(slug, scope); articleSlugs.push(slug); }
      }
      if (text(fm.cover)) verifyImage(fm.cover, scope);
      markdownImages(parsed.content, scope);
    } catch (error) { err(scope, "content parse failed: " + error.message); }
  }
}
function verifyLeaderboard() {
  const scope = "leaderboard/index.yml";
  const file = files.get(scope);
  if (!file) { err(scope, "leaderboard/index.yml is required"); return; }
  let raw;
  try { raw = readText(file); } catch (error) {
    if (error.code === "ERR_ENCODING_INVALID_ENCODED_DATA") err(scope, "invalid UTF-8");
    else io(scope, error);
    return;
  }
  try {
    const data = yaml.load(raw);
    if (!record(data) || !Array.isArray(data.entries)) { err(scope, "leaderboard must be an object with an entries array"); return; }
    for (const key of ["title", "subtitle"]) {
      if (data[key] !== undefined && typeof data[key] !== "string") err(scope, key + " must be a string");
    }
    for (const [index, entry] of data.entries.entries()) {
      const entryScope = scope + ":entries[" + index + "]";
      if (!record(entry)) { err(entryScope, "entry must be an object"); continue; }
      if (!Number.isSafeInteger(entry.rank) || entry.rank < 1) err(entryScope, "rank must be a positive integer");
      if (!text(entry.player)) err(entryScope, "player must be a nonempty string");
      if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) err(entryScope, "score must be a finite number");
      if (entry.change !== undefined && !["up", "down", "same"].includes(entry.change)) err(entryScope, "invalid change");
    }
  } catch (error) { err(scope, "leaderboard parse failed: " + error.message); }
}

if (targets.length !== 1 || args.some((arg) => arg.startsWith("--") && !["--json", "--allow-empty-news"].includes(arg))) {
  err("usage", "node scripts/verify-content-root.mjs <parent-or-content-dir> [--json] [--allow-empty-news]");
  report(2);
} else {
  try {
    const target = resolve(targets[0]);
    if (checkAncestors(target)) {
      content = basename(target).toLowerCase() === "content" ? target : join(target, "content");
      try { scan(content); } catch (error) {
        if (error instanceof ContentLimitError) err("content", error.message);
        else if (error.code === "ENOENT" && !directories.has("")) err("content", "content directory is required");
        else throw error;
      }
      verifyNews();
      verifyLeaderboard();
    }
  } catch (error) { io("content", error); }
  report(ioFailed ? 2 : errors.length ? 1 : 0);
}
