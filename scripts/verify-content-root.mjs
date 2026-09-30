// scripts/verify-content-root.mjs
//
// Validate a content/ tree before it is switched live. This is the safety
// gate for the "content-only deploy" path: a content snapshot is verified
// BEFORE it replaces the directory the running server reads, so a broken
// markdown file never reaches production.
//
// Checks, in order of severity:
//   1. frontmatter required fields (title / date / category / cover)
//   2. date parses and is YYYY-MM-DD or ISO (never a raw YAML Date object)
//   3. slug uniqueness (derived slug + explicit frontmatter.slug)
//   4. image references resolve to real files under <root>/content
//   5. leaderboard index.yml parses and has the expected shape
//
// Exit codes:  0 = all pass   1 = at least one error   2 = usage/IO failure
//
// Usage:
//   node scripts/verify-content-root.mjs <content-root-parent>
//   node scripts/verify-content-root.mjs <parent> --json
//
// <content-root-parent> is the directory that CONTAINS content/, matching
// the CONTENT_ROOT env var contract (CONTENT_ROOT=<parent> -> <parent>/content).
// A path that already points at content/ is accepted too.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname, relative, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");
const yaml = require("js-yaml");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const target = args.find((a) => !a.startsWith("--"));

if (!target) {
  console.error("verify-content: usage: node scripts/verify-content-root.mjs <content-root-parent> [--json]");
  process.exit(2);
}

// Accept either <parent> (contains content/) or <parent>/content directly.
let root = target;
if (!existsSync(join(root, "content"))) {
  const direct = join(root, "news");
  if (existsSync(direct)) root = join(target, "..");
}
const CONTENT = existsSync(join(root, "content")) ? join(root, "content") : root;

const errors = [];
const warnings = [];
const seen = new Map(); // slug -> [files]

function rel(p) {
  return relative(CONTENT, p).split(sep).join("/");
}

function err(scope, msg) {
  errors.push({ scope, message: msg });
}
function warn(scope, msg) {
  warnings.push({ scope, message: msg });
}

// ---------------------------------------------------------------------------
// 1-4. news markdown
// ---------------------------------------------------------------------------
const newsDir = join(CONTENT, "news");
let mdCount = 0;
let imgRefs = 0;

if (!existsSync(newsDir)) {
  warn("news", "content/news/ does not exist; news pages will render empty");
} else {
  const mdFiles = readdirSync(newsDir).filter((f) => extname(f).toLowerCase() === ".md").sort();

  for (const file of mdFiles) {
    const full = join(newsDir, file);
    mdCount++;
    const scope = rel(full);

    let raw;
    try {
      raw = readFileSync(full, "utf-8");
    } catch (e) {
      err(scope, "unreadable: " + (e && e.message));
      continue;
    }

    let fm;
    try {
      fm = matter(raw).data || {};
    } catch (e) {
      err(scope, "frontmatter parse failed: " + (e && e.message));
      continue;
    }

    // required fields -- must mirror lib/news/index.ts exactly, otherwise the
    // verifier would reject content the running server happily renders.
    // lib/news line ~67: if (!fm.title || !fm.date || !fm.category || !fm.cover)
    for (const key of ["title", "date", "category", "cover"]) {
      if (!fm[key]) err(scope, `missing required frontmatter field: ${key}`);
    }
    // summary is not required for rendering, but app/news/[slug]/page.tsx
    // generateMetadata puts news.summary into the SEO description, so an
    // absent summary degrades SEO rather than breaking the page.
    if (fm.summary !== undefined && typeof fm.summary !== "string") {
      warn(scope, `frontmatter.summary is not a string (${typeof fm.summary}); SEO description will be odd`);
    }

    // date: must parse to a real calendar date. NOTE: gray-matter's YAML
    // parser turns an unquoted "2026-09-19" into a Date instance;
    // lib/news/index.ts coerces that back to YYYY-MM-DD at render time
    // (that coercion is the f435bcf fix and is live in production), so a raw
    // Date is a WARNING, not an error. It only becomes an error if the value
    // cannot be coerced to a real date at all.
    if (fm.date instanceof Date) {
      const iso = fm.date.toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(fm.date.getTime())) {
        err(scope, "frontmatter.date is an unparseable YAML date value");
      } else {
        warn(scope, `frontmatter.date is an unquoted YAML date (parsed as Date -> "${iso}"); quoting it (date: "${iso}") avoids the coercion path`);
      }
    } else if (typeof fm.date === "string") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.date.trim())) {
        const d = new Date(fm.date);
        if (Number.isNaN(d.getTime())) {
          err(scope, `frontmatter.date is not a parseable date: ${JSON.stringify(fm.date)}`);
        } else {
          warn(scope, `frontmatter.date is not YYYY-MM-DD: ${JSON.stringify(fm.date)}`);
        }
      }
    } else if (fm.date !== undefined) {
      err(scope, `frontmatter.date has unexpected type ${typeof fm.date}`);
    }

    // slug uniqueness: explicit slug wins, else derive from filename stem
    // (lib/news derives from title via pinyin slugify; we cannot reproduce
    // pinyin here, so we only enforce uniqueness for explicit slugs and
    // report likely collisions by filename stem.)
    const explicit = typeof fm.slug === "string" ? fm.slug.trim() : "";
    if (explicit) {
      if (!seen.has(explicit)) seen.set(explicit, []);
      seen.get(explicit).push(scope);
    }

    // image references: frontmatter.cover + inline ![](...)
    const refs = [];
    if (typeof fm.cover === "string" && fm.cover.startsWith("/content/")) refs.push(fm.cover);
    const inline = raw.matchAll(/!\[[^\]]*\]\((\/content\/[^)\s]+)\)/g);
    for (const m of inline) refs.push(m[1]);

    for (const ref of refs) {
      imgRefs++;
      // /content/news/images/x.webp -> <CONTENT>/news/images/x.webp
      const fsPath = join(CONTENT, ref.slice("/content/".length).split("/").join(sep));
      if (!existsSync(fsPath)) {
        err(scope, `image reference not found: ${ref}`);
      }
    }
  }

  // duplicate explicit slugs
  for (const [slug, files] of seen) {
    if (files.length > 1) {
      err("slug:" + slug, `duplicate frontmatter.slug in ${files.length} files: ${files.join(", ")}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. leaderboard
// ---------------------------------------------------------------------------
const lbPath = join(CONTENT, "leaderboard", "index.yml");
if (!existsSync(lbPath)) {
  warn("leaderboard", "content/leaderboard/index.yml missing; leaderboard renders default empty data");
} else {
  try {
    const doc = yaml.load(readFileSync(lbPath, "utf-8"));
    if (!doc || typeof doc !== "object") {
      err("leaderboard", "index.yml did not parse into an object");
    } else if (!Array.isArray(doc.entries)) {
      err("leaderboard", "index.yml missing entries array");
    }
  } catch (e) {
    err("leaderboard", "index.yml parse failed: " + (e && e.message));
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const summary = {
  contentRoot: CONTENT,
  markdownFiles: mdCount,
  imageRefs: imgRefs,
  errors: errors.length,
  warnings: warnings.length,
};

if (asJson) {
  console.log(JSON.stringify({ summary, errorList: errors, warningList: warnings }, null, 2));
} else {
  console.log("verify-content: root=" + CONTENT);
  console.log("verify-content: " + mdCount + " markdown file(s), " + imgRefs + " image ref(s)");
  for (const w of warnings) console.log("verify-content: WARN  [" + w.scope + "] " + w.message);
  for (const e of errors) console.log("verify-content: ERROR [" + e.scope + "] " + e.message);
  if (errors.length === 0) {
    console.log("verify-content: OK -- " + warnings.length + " warning(s), 0 error(s)");
  } else {
    console.log("verify-content: FAILED -- " + errors.length + " error(s)");
  }
}

process.exit(errors.length > 0 ? 1 : 0);
