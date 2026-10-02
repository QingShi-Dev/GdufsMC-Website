// Offline tests: every GitHub response is mocked, no candidate code is run.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ContentSourceError, GitHubContentSource, decideContentUpdate } from "./content-source.mjs";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const repo = "example/site";
const code = (value) => (error) => error instanceof ContentSourceError && error.code === value;
const changed = (path, extra = {}) => ({ filename: path, status: "modified", ...extra });
const defaultFiles = [changed("content/news/one.md")];
function comparison(extra = {}) {
  return { status: "ahead", total_commits: 1, base_commit: { sha: A }, merge_base_commit: { sha: A },
    files: defaultFiles, commits: [{ sha: B }], ...extra };
}
function mock(handler, options = {}) {
  const calls = [];
  const source = new GitHubContentSource({ repo, ...options, fetchImpl: async (url, init) => {
    assert.ok(url.startsWith("https://api.github.com/repos/" + repo + "/"));
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    const path = url.slice(("https://api.github.com/repos/" + repo).length);
    calls.push({ path, init });
    const data = await handler(path, init, calls.length);
    return data instanceof Response ? data : new Response(JSON.stringify(data), { status: 200 });
  } });
  return { source, calls };
}
function compareMock(data = comparison(), detail = () => ({ sha: B, files: defaultFiles })) {
  return mock((path) => {
    if (path.startsWith("/compare/")) return data;
    const match = /^\/commits\/([a-f0-9]{40})\?per_page=100&page=(\d+)$/.exec(path);
    assert.ok(match, "Unexpected comparison request: " + path);
    return detail(match[1], Number(match[2]));
  });
}
function temporaryRoot(t) {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, "content-source-test-"));
  t.after(() => {
    const rel = relative(parent, resolve(root));
    assert.ok(!isAbsolute(rel) && !rel.startsWith("..") && !rel.includes(sep) && rel.startsWith("content-source-test-"));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
const dir = (path) => ({ path, mode: "040000", type: "tree", sha: C });
function blob(path, value) {
  const bytes = Buffer.from(value);
  const sha = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
  return { entry: { path, mode: "100644", type: "blob", sha, size: bytes.length },
    response: { sha, size: bytes.length, encoding: "base64", content: bytes.toString("base64") }, bytes };
}
function snapshotData() {
  const news = blob("content/news/one.md", "Article data only\n");
  const board = blob("content/leaderboard/index.yml", "entries: []\n");
  return { tree: [dir("content"), dir("content/news"), dir("content/leaderboard"), news.entry, board.entry],
    blobs: new Map([[news.entry.sha, news.response], [board.entry.sha, board.response]]), news, board };
}
function snapshotMock(data = snapshotData(), overrides = {}) {
  return mock((path) => {
    if (path === "/git/trees/" + B + "?recursive=1") return { truncated: false, tree: data.tree, ...overrides };
    if (path.startsWith("/git/blobs/")) {
      const value = data.blobs.get(path.slice("/git/blobs/".length));
      assert.ok(value, "Requested a non-content or unknown blob");
      return value;
    }
    assert.fail("Unexpected snapshot request: " + path);
  });
}

test("repo, SHA and credential inputs are validated before requests", async () => {
  for (const repo of ["https://github.com/a/b", "a/../b", "a/b?token=x", "a/..", "a/b/c"]) {
    assert.throws(() => new GitHubContentSource({ repo }), code("INVALID_REPO"));
  }
  assert.throws(() => new GitHubContentSource({ repo, token: "bad\r\nheader" }), code("INVALID_TOKEN"));
  const { source, calls } = mock(() => assert.fail("Unexpected request"));
  await assert.rejects(() => source.compare("main", B), code("INVALID_SHA"));
  assert.equal(calls.length, 0);
});

test("head reads main with optional authorization and no token in the URL", async () => {
  const secret = "private-test-token";
  const { source, calls } = mock((path, init) => {
    assert.equal(path, "/commits/main");
    assert.equal(init.headers.Authorization, "Bearer " + secret);
    return { sha: B };
  }, { token: secret });
  assert.equal(await source.head(), B);
  assert.ok(!calls[0].path.includes(secret));
});

test("HTTP errors fail without exposing response bodies or credentials", async () => {
  const secret = "sensitive-test-token";
  const { source, calls } = mock(() => new Response(secret, { status: 404 }), { token: secret });
  await assert.rejects(() => source.compare(A, B), (error) => error.code === "NOT_FOUND" && !String(error).includes(secret));
  assert.equal(calls.length, 1);
});

test("rate limits and server errors get at most three attempts", async () => {
  const { source, calls } = mock((_path, _init, count) => count < 3
    ? new Response("retry", { status: count === 1 ? 429 : 503, headers: { "retry-after": "0" } }) : { sha: B });
  assert.equal(await source.head(), B);
  assert.equal(calls.length, 3);
  const failing = mock(() => new Response("unavailable", { status: 503, headers: { "retry-after": "0" } }));
  await assert.rejects(() => failing.source.head(), code("HTTP_ERROR"));
  assert.equal(failing.calls.length, 3);
});

test("oversized and malformed JSON responses fail closed", async () => {
  const huge = mock(() => new Response("{}", { headers: { "content-length": String(3 * 1024 * 1024) } }));
  await assert.rejects(() => huge.source.head(), code("RESPONSE_LIMIT"));
  const invalid = mock(() => new Response("not json"));
  await assert.rejects(() => invalid.source.head(), code("INVALID_RESPONSE"));
});

test("comparison keeps rename sources and scans bounded commit history", async () => {
  const files = [changed("content/news/new.md", { status: "renamed", previous_filename: "content/news/old.md" })];
  const { source, calls } = compareMock(comparison({ files }), () => ({ sha: B, files }));
  const result = await source.compare(A, B);
  assert.equal(result.files[0].previousPath, "content/news/old.md");
  assert.equal(result.base, A);
  assert.equal(result.candidate, B);
  assert.equal(result.truncated, false);
  assert.equal(calls.length, 2);
});

test("a reverted code change hidden by net diff still forces full deploy", async () => {
  const { source, calls } = compareMock(comparison({ total_commits: 2, commits: [{ sha: C }, { sha: B }] }),
    (sha) => ({ sha, files: [changed("app/page.tsx")] }));
  const result = await source.compare(A, B);
  assert.ok(result.files.some((file) => file.path === "app/page.tsx"));
  assert.equal(calls.length, 2, "Stops once a full deployment is proven necessary");
  assert.equal(decideContentUpdate({ codeCommit: A, candidateCommit: B, headCommit: B, comparison: result }).mode, "full");
});

test("commit files are paged until the complete list is read", async () => {
  const { source, calls } = compareMock(comparison(), (sha, page) => ({ sha, files: page === 1
    ? Array.from({ length: 100 }, (_, index) => changed(`content/news/page-one-${index}.md`))
    : [changed("content/news/page-two.md")] }));
  const result = await source.compare(A, B);
  assert.ok(result.files.some((file) => file.path.endsWith("page-two.md")));
  assert.equal(result.truncated, false);
  assert.equal(calls.length, 3);
});

test("GitHub's 300 comparison-file boundary is conservatively truncated", async () => {
  const files = Array.from({ length: 300 }, (_, index) => changed(`content/news/${index}.md`));
  const { source, calls } = compareMock(comparison({ files }));
  assert.equal((await source.compare(A, B)).truncated, true);
  assert.equal(calls.length, 1);
});

test("histories over 100 commits require full deployment", async () => {
  const { source, calls } = compareMock(comparison({ total_commits: 101 }));
  assert.equal((await source.compare(A, B)).truncated, true);
  assert.equal(calls.length, 1);
});

test("GitHub's 3000 files per commit boundary is conservatively truncated", async () => {
  const { source, calls } = compareMock(comparison(), (sha, page) => ({ sha,
    files: Array.from({ length: 100 }, (_, index) => changed(`content/news/page-${page}-${index}.md`)) }));
  assert.equal((await source.compare(A, B)).truncated, true);
  assert.equal(calls.length, 31);
});

for (const [name, extra] of [
  ["missing history", { commits: [] }],
  ["wrong baseline", { base_commit: { sha: C } }],
  ["unproven ancestry", { merge_base_commit: { sha: C } }],
  ["unknown status", { status: "unknown" }],
  ["rename without old path", { files: [changed("content/news/new.md", { status: "renamed" })] }],
]) {
  test(`comparison rejects ${name}`, async () => {
    await assert.rejects(() => compareMock(comparison(extra)).source.compare(A, B), code("INVALID_COMPARISON"));
  });
}

function decision(extra = {}) {
  return decideContentUpdate({ codeCommit: A, currentContentCommit: C, candidateCommit: B, headCommit: B,
    comparison: { base: A, candidate: B, status: "ahead", totalCommits: 1, truncated: false,
      files: [{ path: "content/news/one.md", status: "modified" }] }, ...extra });
}
test("decision rejects stale jobs before checking already-active state", () => {
  assert.equal(decision({ headCommit: C, currentContentCommit: B }).mode, "stale");
  assert.equal(decision({ currentContentCommit: B }).mode, "noop");
  assert.equal(decision().mode, "content");
  assert.equal(decision({ codeCommit: undefined }).mode, "full");
  assert.equal(decision({ comparison: undefined }).mode, "full");
});

test("renames across the content boundary require full deployment", () => {
  for (const [path, previousPath] of [["content/news/new.md", "scripts/old.md"], ["app/new.md", "content/news/old.md"]]) {
    assert.equal(decision({ comparison: { base: A, candidate: B, status: "ahead", truncated: false,
      files: [{ path, previousPath, status: "renamed" }] } }).mode, "full");
  }
});

test("diverged, behind, unsafe, truncated and mismatched comparisons fail closed", () => {
  for (const extra of [{ status: "diverged" }, { status: "behind" }, { truncated: true }, { base: C },
    { candidate: C }, { files: [] }, { files: [{ path: "content/../app.ts", status: "modified" }] }]) {
    const value = { base: A, candidate: B, status: "ahead", truncated: false, files: [{ path: "content/news/a.md", status: "modified" }], ...extra };
    assert.equal(decision({ comparison: value }).mode, "full");
  }
});

test("already-deployed code can receive its missing content snapshot", () => {
  assert.equal(decision({ codeCommit: B, comparison: { base: B, candidate: B, status: "identical", files: [], truncated: false } }).mode, "content");
});

test("snapshot downloads only content blobs, verifies bytes, and returns a separate manifest", async (t) => {
  const data = snapshotData();
  data.tree.push(blob("scripts/untrusted.js", "throw new Error('never download me')").entry);
  const { source, calls } = snapshotMock(data);
  const root = temporaryRoot(t);
  const result = await source.snapshot(B, root);
  assert.equal(result.version, 1);
  assert.equal(result.commit, B);
  assert.equal(result.files.length, 2);
  assert.equal(result.files.find((file) => file.path === "news/one.md").sha256, createHash("sha256").update(data.news.bytes).digest("hex"));
  assert.deepEqual(readFileSync(join(root, "content", "news", "one.md")), data.news.bytes);
  assert.equal(existsSync(join(root, "content", "manifest.json")), false);
  assert.equal(existsSync(join(root, "scripts")), false);
  assert.equal(calls.length, 3);
});

test("existing staging content is never overwritten", async (t) => {
  const root = temporaryRoot(t);
  await snapshotMock().source.snapshot(B, root);
  writeFileSync(join(root, "content", "news", "one.md"), "Keep local data");
  await assert.rejects(() => snapshotMock().source.snapshot(B, root), code("DESTINATION_EXISTS"));
  assert.equal(readFileSync(join(root, "content", "news", "one.md"), "utf8"), "Keep local data");
});

test("truncated or missing content trees are rejected before creating content", async (t) => {
  const root = temporaryRoot(t);
  await assert.rejects(() => snapshotMock(undefined, { truncated: true }).source.snapshot(B, root), code("TRUNCATED_TREE"));
  await assert.rejects(() => snapshotMock(undefined, { tree: [] }).source.snapshot(B, root), code("MISSING_CONTENT"));
  assert.equal(existsSync(join(root, "content")), false);
});

for (const path of ["content/../outside.md", "content/news/CON.md", "content/news/bad:name.md", "content/news/bad\\name.md", "content/news/trailing.md.", "content/news//one.md"] ) {
  test(`snapshot rejects unsafe path ${path}`, async (t) => {
    const data = snapshotData();
    data.tree.push(blob(path, "data").entry);
    await assert.rejects(() => snapshotMock(data).source.snapshot(B, temporaryRoot(t)), code("UNSAFE_PATH"));
  });
}

for (const [type, mode] of [["blob", "120000"], ["blob", "100755"], ["commit", "160000"]]) {
  test(`snapshot rejects Git mode ${mode}`, async (t) => {
    const data = snapshotData();
    data.tree[3] = { ...data.tree[3], type, mode };
    await assert.rejects(() => snapshotMock(data).source.snapshot(B, temporaryRoot(t)), code("UNSAFE_MODE"));
  });
}

test("snapshot rejects unsupported files and Windows case collisions", async (t) => {
  const data = snapshotData();
  data.tree.push(blob("content/news/run.js", "code").entry);
  await assert.rejects(() => snapshotMock(data).source.snapshot(B, temporaryRoot(t)), code("UNSUPPORTED_FILE"));
  data.tree.pop();
  data.tree.push(blob("content/news/ONE.md", "collision").entry);
  await assert.rejects(() => snapshotMock(data).source.snapshot(B, temporaryRoot(t)), code("PATH_COLLISION"));
});

test("snapshot enforces zero-byte and per-file sizes before downloading blobs", async (t) => {
  for (const [path, size] of [["content/news/one.md", 0], ["content/news/one.md", 1024 * 1024 + 1],
    ["content/news/images/large.png", 32 * 1024 * 1024 + 1]]) {
    const data = snapshotData();
    data.tree[3] = { ...data.tree[3], path, size };
    const { source, calls } = snapshotMock(data);
    await assert.rejects(() => source.snapshot(B, temporaryRoot(t)), code("FILE_LIMIT"));
    assert.equal(calls.length, 1);
  }
});

test("snapshot enforces total-byte, file-count, directory-count and depth limits", async (t) => {
  for (const entries of [
    Array.from({ length: 17 }, (_, index) => ({ path: `content/news/images/${index}.png`, mode: "100644", type: "blob", sha: A, size: 32 * 1024 * 1024 })),
    Array.from({ length: 10001 }, (_, index) => ({ path: `content/news/${index}.md`, mode: "100644", type: "blob", sha: A, size: 1 })),
    Array.from({ length: 1001 }, (_, index) => dir(`content/news/images/dir-${index}`)),
  ]) {
    const data = snapshotData();
    data.tree.push(...entries);
    await assert.rejects(() => snapshotMock(data).source.snapshot(B, temporaryRoot(t)), code("SNAPSHOT_LIMIT"));
  }
  const data = snapshotData();
  data.tree.push(dir("content/" + Array.from({ length: 17 }, () => "deep").join("/")));
  await assert.rejects(() => snapshotMock(data).source.snapshot(B, temporaryRoot(t)), code("UNSAFE_PATH"));
});

test("blob hashes are checked against tree object IDs", async (t) => {
  const data = snapshotData();
  const response = data.blobs.get(data.news.entry.sha);
  response.content = Buffer.from("x".repeat(data.news.bytes.length)).toString("base64");
  await assert.rejects(() => snapshotMock(data).source.snapshot(B, temporaryRoot(t)), code("BLOB_HASH_MISMATCH"));
});

test("malformed base64 and mismatched blob metadata fail closed", async (t) => {
  for (const change of [{ content: "!!!!" }, { size: 999 }, { sha: C }, { encoding: "utf8" }]) {
    const data = snapshotData();
    Object.assign(data.blobs.get(data.news.entry.sha), change);
    await assert.rejects(() => snapshotMock(data).source.snapshot(B, temporaryRoot(t)), code("INVALID_BLOB"));
  }
});

test("multi-megabyte images allow GitHub's JSON-escaped base64 line wrapping", async (t) => {
  const data = snapshotData();
  const image = blob("content/news/images/large.png", Buffer.alloc(4 * 1024 * 1024, 42));
  image.response.content = image.response.content.match(/.{1,60}/g).join("\n") + "\n";
  data.tree.push(image.entry);
  data.blobs.set(image.entry.sha, image.response);
  const root = temporaryRoot(t);
  const result = await snapshotMock(data).source.snapshot(B, root);
  assert.equal(result.files.find((file) => file.path === "news/images/large.png").size, image.bytes.length);
  assert.deepEqual(readFileSync(join(root, "content", "news", "images", "large.png")), image.bytes);
});
