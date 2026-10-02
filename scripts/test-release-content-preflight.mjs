// Regression tests for the release smoke test's external-content startup gate.
// Uses a tiny local HTTP fixture; no Next build or production files are needed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const smokeScript = join(repoRoot, "scripts", "test-release.mjs");
const marker = { id: "fixture", commit: "a".repeat(40) };

function fixture(t, { removeArticleOnStart = false } = {}) {
  const tempParent = resolve(tmpdir());
  const root = mkdtempSync(join(tempParent, "gdufsmc-release-preflight-"));
  const stage = join(root, "stage");
  const contentRoot = join(root, "external");
  const started = join(stage, "server-started.json");
  const article = join(contentRoot, "content", "news", "fixture.md");
  mkdirSync(stage);
  writeFileSync(join(stage, "release.json"), JSON.stringify(marker));
  writeFileSync(join(stage, "server.js"), `
const { createServer } = require("node:http");
const { writeFileSync, unlinkSync } = require("node:fs");
${removeArticleOnStart ? `unlinkSync(${JSON.stringify(article)});` : ""}
const server = createServer((req, res) => {
  if (req.url === "/__release.json") {
    res.setHeader("content-type", "application/json");
    res.end(${JSON.stringify(JSON.stringify(marker))});
  } else if (req.url === "/news") {
    res.end('<a href="/news/fixture">Fixture article</a>');
  } else {
    res.end("fixture");
  }
});
server.listen(Number(process.env.PORT), process.env.HOSTNAME, () => {
  writeFileSync(${JSON.stringify(started)}, JSON.stringify({ pid: process.pid }));
});
// Bound fixture lifetime even if the smoke process fails before its cleanup.
setTimeout(() => process.exit(2), 15000).unref();
`);
  t.after(() => {
    // The only recursive removal target is this test's freshly allocated tmp dir.
    assert.equal(dirname(resolve(root)), tempParent);
    assert.match(root.slice(tempParent.length + 1), /^gdufsmc-release-preflight-/);
    rmSync(root, { recursive: true, force: true });
  });
  return { stage, contentRoot, started, article };
}

function runSmoke(f, contentRoot = f.contentRoot) {
  const env = { ...process.env, RELEASE_EXTERNAL_CONTENT: "1" };
  // Windows environment variable names are case-insensitive.
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "CONTENT_ROOT") delete env[key];
  }
  if (contentRoot !== null) env.CONTENT_ROOT = contentRoot;
  const result = spawnSync(process.execPath, [smokeScript, f.stage], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /ReferenceError|fail is not defined/);
  return { ...result, output };
}

function rejectsBeforeStartup(f, contentRoot, diagnostic) {
  const result = runSmoke(f, contentRoot);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, diagnostic);
  assert.doesNotMatch(result.output, /spawning node server\.js/);
  assert.equal(existsSync(f.started), false, "the server must not start on invalid content");
  return result;
}

function addArticle(f) {
  mkdirSync(dirname(f.article), { recursive: true });
  writeFileSync(f.article, "---\ntitle: Fixture\nslug: fixture\n---\nVisible content\n");
}

async function assertServerStopped(f) {
  assert.equal(existsSync(f.started), true, "valid content must reach server startup");
  const { pid } = JSON.parse(readFileSync(f.started, "utf8"));
  for (let i = 0; i < 80; i++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await delay(25);
  }
  assert.fail("smoke cleanup left the fixture server running (pid " + pid + ")");
}

test("external content requires CONTENT_ROOT before server startup", (t) => {
  const f = fixture(t);
  rejectsBeforeStartup(f, null, /CONTENT_ROOT is not set/);
});

test("a nonexistent external root is rejected without claiming bundled fallback", (t) => {
  const f = fixture(t);
  const { output } = rejectsBeforeStartup(f, f.contentRoot, /does not contain a content\/ directory/);
  assert.doesNotMatch(output, /fall back/);
});

test("an existing parent without content is rejected before startup", (t) => {
  const f = fixture(t);
  mkdirSync(f.contentRoot);
  rejectsBeforeStartup(f, f.contentRoot, /does not contain a content\/ directory/);
});

test("content must be a directory, not a file", (t) => {
  const f = fixture(t);
  mkdirSync(f.contentRoot);
  writeFileSync(join(f.contentRoot, "content"), "not a directory");
  rejectsBeforeStartup(f, f.contentRoot, /does not contain a content\/ directory/);
});

test("missing news is rejected before startup", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.contentRoot, "content"), { recursive: true });
  rejectsBeforeStartup(f, f.contentRoot, /no markdown articles found/);
});

test("empty news with only an images directory is rejected before startup", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.contentRoot, "content", "news", "images"), { recursive: true });
  rejectsBeforeStartup(f, f.contentRoot, /no markdown articles found/);
});

test("news must be a directory, not a file", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.contentRoot, "content"), { recursive: true });
  writeFileSync(join(f.contentRoot, "content", "news"), "not a directory");
  rejectsBeforeStartup(f, f.contentRoot, /no markdown articles found/);
});

test("valid external content reaches HTTP checks and cleans up the server", async (t) => {
  const f = fixture(t);
  addArticle(f);
  const result = runSmoke(f);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /ALL CHECKS PASSED/);
  assert.match(result.output, /PASS.*news-list-renders-content\(1 article\(s\)\)/);
  await assertServerStopped(f);
});

test("content lost after startup fails inside try and still cleans up the server", async (t) => {
  const f = fixture(t, { removeArticleOnStart: true });
  addArticle(f);
  const result = runSmoke(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /no markdown articles found/);
  await assertServerStopped(f);
});
