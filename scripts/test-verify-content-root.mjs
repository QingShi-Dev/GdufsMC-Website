// CLI regression checks for the snapshot gate. Fixtures never touch content/.
// Run: node scripts/test-verify-content-root.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const verifier = fileURLToPath(new URL("./verify-content-root.mjs", import.meta.url));
const tempParent = resolve(tmpdir());
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const cover = "/content/news/images/cover.png";

function article(fields = {}, body = "A visible article body.") {
  const frontmatter = {
    title: "Example article",
    date: "2026-10-01",
    category: "公告",
    cover,
    ...fields,
  };
  return "---\n" + Object.entries(frontmatter)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n") + "\n---\n" + body + "\n";
}

function write(root, path, contents) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
  return file;
}

function temporaryRoot(t) {
  const root = mkdtempSync(join(tempParent, "verify-content-test-"));
  t.after(() => {
    // Verify the absolute target before recursive cleanup on Windows.
    const rel = relative(tempParent, resolve(root));
    assert.ok(!isAbsolute(rel) && !rel.startsWith("..") && !rel.includes(sep));
    assert.ok(rel.startsWith("verify-content-test-"));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function fixture(t, news = { "example.md": article() }) {
  const root = temporaryRoot(t);
  mkdirSync(join(root, "content", "news"), { recursive: true });
  for (const [name, contents] of Object.entries(news)) {
    write(root, `content/news/${name}`, contents);
  }
  write(root, "content/news/images/cover.png", image);
  write(root, "content/leaderboard/index.yml", "entries: []\n");
  return root;
}

function run(args) {
  const result = spawnSync(process.execPath, [verifier, ...args], {
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function verify(root, expectedExit, extra = []) {
  const result = run([root, "--json", ...extra]);
  assert.equal(result.status, expectedExit, result.stdout + result.stderr);
  if (expectedExit === 2) return result;
  const report = JSON.parse(result.stdout);
  for (const key of ["markdownFiles", "imageRefs", "errors", "warnings"]) {
    assert.ok(Number.isInteger(report.summary[key]), `Missing summary.${key}`);
  }
  if (expectedExit === 0) assert.equal(report.summary.errors, 0);
  if (expectedExit === 1) assert.ok(report.summary.errors > 0);
  return report;
}

test("valid snapshot accepts parent and direct content paths; summary is optional", (t) => {
  const root = fixture(t);
  const report = verify(root, 0);
  assert.equal(report.summary.markdownFiles, 1);
  assert.equal(report.summary.imageRefs, 1);
  verify(join(root, "content"), 0);
});

test("missing CLI argument and unknown option are usage errors", (t) => {
  assert.equal(run(["--json"]).status, 2);
  verify(fixture(t), 2, ["--unknown-option"]);
});

test("nonexistent root is an IO error", (t) => {
  verify(join(temporaryRoot(t), "does-not-exist"), 2);
});

test("existing empty root fails content validation", (t) => {
  verify(temporaryRoot(t), 1);
});

test("empty news needs an explicit flag and a complete directory structure", (t) => {
  const root = fixture(t, {});
  verify(root, 1);
  const report = verify(root, 0, ["--allow-empty-news"]);
  assert.equal(report.summary.markdownFiles, 0);
  unlinkSync(join(root, "content", "leaderboard", "index.yml"));
  verify(root, 1, ["--allow-empty-news"]);
  verify(temporaryRoot(t), 1, ["--allow-empty-news"]);
});

test("allow-empty-news does not excuse a missing news directory", (t) => {
  const root = fixture(t, {});
  renameSync(join(root, "content", "news"), join(root, "removed-news"));
  verify(root, 1, ["--allow-empty-news"]);
});

test("missing cover fails", (t) => {
  verify(fixture(t, { "example.md": article({ cover: undefined }) }), 1);
});

test("an unquoted YAML date remains valid with a warning", (t) => {
  const raw = article().replace('date: "2026-10-01"', "date: 2026-10-01");
  const report = verify(fixture(t, { "example.md": raw }), 0);
  assert.ok(report.summary.warnings > 0);
});

for (const date of ["2026-99-99", "2026-02-29", "not-a-date"]) {
  test(`invalid calendar date ${date} fails`, (t) => {
    verify(fixture(t, { "example.md": article({ date }) }), 1);
  });
}

test("a real leap day passes", (t) => {
  verify(fixture(t, { "example.md": article({ date: "2024-02-29" }) }), 0);
});

test("an unquoted invalid YAML date cannot silently roll into March", (t) => {
  const raw = article().replace('date: "2026-10-01"', "date: 2026-02-30");
  verify(fixture(t, { "example.md": raw }), 1);
});

for (const language of ["javascript", "js"]) {
  test(`${language} frontmatter is rejected without executing its contents`, (t) => {
    const root = fixture(t);
    const sentinel = join(root, "frontmatter-executed.txt");
    const payload = `(require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "executed"), ` +
      JSON.stringify({ title: "Attack", date: "2026-10-01", category: "公告", cover }) + ")";
    write(root, "content/news/example.md", `---${language}\n${payload}\n---\nArticle\n`);
    verify(root, 1);
    assert.equal(existsSync(sentinel), false, "Frontmatter executed before rejection");
  });
}

for (const field of ["title", "category", "cover", "summary"]) {
  test(`object-valued ${field} fails before React renders it`, (t) => {
    verify(fixture(t, { "example.md": article({ [field]: { bad: "value" } }) }), 1);
  });
}

test("numeric slug fails before runtime trim", (t) => {
  verify(fixture(t, { "example.md": article({ slug: 123 }) }), 1);
});

test("duplicate explicit slugs fail", (t) => {
  verify(fixture(t, {
    "one.md": article({ title: "First", slug: "same" }),
    "two.md": article({ title: "Second", slug: "same" }),
  }), 1);
});

test("duplicate derived pinyin slugs fail", (t) => {
  verify(fixture(t, {
    "one.md": article({ title: "欢迎" }),
    "two.md": article({ title: "欢迎" }),
  }), 1);
});

test("an explicit slug colliding with a derived pinyin slug fails", (t) => {
  verify(fixture(t, {
    "one.md": article({ title: "欢迎" }),
    "two.md": article({ title: "Second", slug: "huan-ying" }),
  }), 1);
});

test("inline image titles, reference images, and encoded spaces resolve", (t) => {
  const body = [
    '![Inline](/content/news/images/extra.png "Caption")',
    "![Reference][photo]",
    ' [photo]: /content/news/images/extra.png "Caption"',
    "![Space](/content/news/images/space%20image.png)",
  ].join("\n\n");
  const root = fixture(t, { "example.md": article({}, body) });
  write(root, "content/news/images/extra.png", image);
  write(root, "content/news/images/space image.png", image);
  const report = verify(root, 0);
  assert.equal(report.summary.imageRefs, 4);
});

for (const [name, body] of [
  ["inline title", '![Missing](/content/news/images/missing.png "Caption")'],
  ["reference style", "![Missing][photo]\n\n[photo]: /content/news/images/missing.png"],
  ["encoded spaces", "![Missing](/content/news/images/missing%20image.png)"],
]) {
  test(`missing ${name} image fails`, (t) => {
    verify(fixture(t, { "example.md": article({}, body) }), 1);
  });
}

test("Markdown image examples inside fenced and inline code are ignored", (t) => {
  const body = [
    "```markdown",
    "![Example](/content/news/images/not-a-real-image.png)",
    "```",
    "`![Example](/content/news/images/also-not-real.png)`",
  ].join("\n");
  const report = verify(fixture(t, { "example.md": article({}, body) }), 0);
  assert.equal(report.summary.imageRefs, 1);
});

test("a directory cannot satisfy an image reference", (t) => {
  verify(fixture(t, { "example.md": article({ cover: "/content/news/images" }) }), 1);
});

test("an image path cannot escape content even if the target file exists", (t) => {
  const root = fixture(t, {
    "example.md": article({ cover: "/content/../outside.png" }),
  });
  write(root, "outside.png", image);
  verify(root, 1);
});

test("encoded traversal cannot escape content", (t) => {
  const root = fixture(t, {
    "example.md": article({ cover: "/content/%2e%2e/outside.png" }),
  });
  write(root, "outside.png", image);
  verify(root, 1);
});

test("malformed percent encoding is a content error", (t) => {
  verify(fixture(t, {
    "example.md": article({ cover: "/content/news/images/%E0%A4%A.png" }),
  }), 1);
});

test("unknown executable files are not accepted into a content snapshot", (t) => {
  const root = fixture(t);
  write(root, "content/news/script.js", "console.log('unexpected script');\n");
  verify(root, 1);
});

test("zero-byte image files fail even when all references exist", (t) => {
  const root = fixture(t);
  truncateSync(join(root, "content", "news", "images", "cover.png"), 0);
  verify(root, 1);
});

for (const [name, path, size] of [
  ["markdown larger than 1 MiB", "content/news/example.md", 1024 * 1024 + 1],
  ["image larger than 32 MiB", "content/news/images/cover.png", 32 * 1024 * 1024 + 1],
]) {
  test(`${name} fails before parsing or decoding`, (t) => {
    const root = fixture(t);
    // Extend the temporary file without allocating a large JavaScript buffer.
    truncateSync(join(root, path), size);
    verify(root, 1);
  });
}

function junction(t, target, link) {
  try {
    symlinkSync(target, link, "junction");
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`Cannot create a junction in this environment: ${error.code}`);
      return false;
    }
    throw error;
  }
}

test("a content junction pointing outside the snapshot is rejected", (t) => {
  const root = fixture(t);
  const external = temporaryRoot(t);
  write(external, "external.png", image);
  const link = join(root, "content", "news", "images", "linked");
  if (!junction(t, external, link)) return;
  write(root, "content/news/example.md", article({ cover: "/content/news/images/linked/external.png" }));
  verify(root, 1);
});

test("a symlink in a supplied root's ancestors is rejected", (t) => {
  const root = fixture(t);
  const wrapper = temporaryRoot(t);
  const link = join(wrapper, "linked-parent");
  if (!junction(t, root, link)) return;
  verify(join(link, "content"), 1);
});

test("missing leaderboard fails even with valid news", (t) => {
  const root = fixture(t);
  unlinkSync(join(root, "content", "leaderboard", "index.yml"));
  verify(root, 1);
});

for (const [name, contents] of [
  ["invalid YAML", "entries: [\n"],
  ["missing entries", "title: Board\n"],
  ["non-array entries", "entries: wrong\n"],
  ["null entry", "entries: [null]\n"],
  ["rank zero", "entries: [{rank: 0, player: Alice, score: 1}]\n"],
  ["fractional rank", "entries: [{rank: 1.5, player: Alice, score: 1}]\n"],
  ["string rank", 'entries: [{rank: "1", player: Alice, score: 1}]\n'],
  ["empty player", 'entries: [{rank: 1, player: "   ", score: 1}]\n'],
  ["numeric player", "entries: [{rank: 1, player: 123, score: 1}]\n"],
  ["string score", 'entries: [{rank: 1, player: Alice, score: "1"}]\n'],
  ["infinite score", "entries: [{rank: 1, player: Alice, score: .inf}]\n"],
  ["NaN score", "entries: [{rank: 1, player: Alice, score: .nan}]\n"],
  ["unknown change", "entries: [{rank: 1, player: Alice, score: 1, change: sideways}]\n"],
]) {
  test(`leaderboard rejects ${name}`, (t) => {
    const root = fixture(t);
    write(root, "content/leaderboard/index.yml", contents);
    verify(root, 1);
  });
}

test("valid leaderboard accepts optional change and finite fractional scores", (t) => {
  const root = fixture(t);
  write(root, "content/leaderboard/index.yml", [
    "entries:",
    "  - {rank: 1, player: Alice, score: 12.5}",
    "  - {rank: 2, player: Bob, score: 10, change: up}",
    "  - {rank: 3, player: Carol, score: 5, change: down}",
    "  - {rank: 4, player: Dave, score: 0, change: same}",
    "",
  ].join("\n"));
  verify(root, 0);
});

test("complete image rename and article additions/deletions validate as snapshots", (t) => {
  const root = fixture(t);
  verify(root, 0);
  renameSync(
    join(root, "content", "news", "images", "cover.png"),
    join(root, "content", "news", "images", "renamed.png"),
  );
  const nextCover = "/content/news/images/renamed.png";
  write(root, "content/news/example.md", article({ cover: nextCover }));
  write(root, "content/news/new.md", article({ title: "New article", cover: nextCover }));
  assert.equal(verify(root, 0).summary.markdownFiles, 2);
  unlinkSync(join(root, "content", "news", "example.md"));
  assert.equal(verify(root, 0).summary.markdownFiles, 1);
});

for (const [name, path] of [
  ["news", "content/news/example.md"],
  ["leaderboard", "content/leaderboard/index.yml"],
]) {
  test(`invalid UTF-8 ${name} is a content error, not an IO failure`, (t) => {
    const root = fixture(t);
    write(root, path, Buffer.from([0xc3, 0x28]));
    verify(root, 1);
  });
}
