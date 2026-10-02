// Isolated Git mechanics behind the CMS content branch, exercised against a
// throwaway repository. No network, no GitHub, no real repository is touched.
//
// Why this exists: publish_mode: simple means the CMS pushes straight to a
// content branch, and scripts/content-sync.mjs later reconciles that branch with
// main. The invariants here are the ones that must never regress -- a stale
// compare-and-swap must not be able to clobber a concurrent editor save, and a
// merge conflict must stop without moving the branch head. They are cheap to
// check and expensive to discover in production.
//
// Usage: node scripts/test-cms-branch-lifecycle.mjs [results-json-path]
// With a path, a machine-readable report is written there for CI to upload.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const reportPath = process.argv[2] ? resolve(process.argv[2]) : null;
const output = resolve("outputs");
mkdirSync(output, { recursive: true });
const cwd = mkdtempSync(join(output, "cms-branch-test-"));

// stderr is captured into the thrown error on purpose: these checks fail on
// git's exit code, and without the message a failure is just "Command failed".
const git = (...args) => {
  let stdout;
  try {
    stdout = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const detail = [error.stderr, error.stdout, error.message].filter(Boolean).join(" | ").trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  console.log(`git ${args.join(" ")}`, stdout);
  return stdout;
};

const results = [];
// Fail fast on purpose. These checks share Git state, so continuing after a
// failure would report cascading nonsense rather than the real cause.
const check = (name, fn) => {
  try {
    fn();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    throw error;
  }
};
const commit = (file, text) => {
  writeFileSync(join(cwd, file), text);
  git("add", file);
  git("commit", "-m", `test ${file}`);
  return git("rev-parse", "HEAD");
};

let failure = null;
try {
  git("init", "-b", "main");
  git("config", "user.name", "CMS isolated test");
  git("config", "user.email", "cms-test@example.invalid");
  commit("news.txt", "base\n");
  commit("scores.txt", "base\n");
  git("checkout", "-b", "cms/content");

  const news = commit("news.txt", "news batch 1\n");
  commit("scores.txt", "scores batch 1\n");
  check("news and scores are preserved on one branch", () => {
    assert.equal(git("show", "HEAD:news.txt"), "news batch 1");
    assert.equal(git("show", "HEAD:scores.txt"), "scores batch 1");
    git("merge-base", "--is-ancestor", news, "HEAD");
  });

  git("checkout", "main");
  git("merge", "--no-ff", "cms/content", "-m", "simulate manual approval of batch 1");
  check("after merge work branch fast-forwards without force", () => {
    git("checkout", "cms/content");
    git("merge", "--ff-only", "main");
    assert.equal(git("rev-parse", "HEAD"), git("rev-parse", "main"));
  });

  const batch2 = commit("news.txt", "news batch 2\n");
  git("checkout", "main");
  commit("app.txt", "code update\n");
  git("checkout", "cms/content");
  check("new batch survives merging main code updates", () => {
    git("merge", "--no-edit", "main");
    assert.equal(git("show", "HEAD:news.txt"), "news batch 2");
    assert.equal(git("show", "HEAD:app.txt"), "code update");
    git("merge-base", "--is-ancestor", batch2, "HEAD");
  });

  check("stale compare-and-swap cannot overwrite concurrent save", () => {
    const stale = git("rev-parse", "HEAD");
    const latest = commit("scores.txt", "concurrent CMS save\n");
    assert.throws(() => git("update-ref", "refs/heads/cms/content", stale, stale));
    assert.equal(git("rev-parse", "HEAD"), latest);
  });

  git("checkout", "main");
  commit("news.txt", "conflicting main edit\n");
  git("checkout", "cms/content");
  check("merge conflict stops without moving branch head", () => {
    const before = git("rev-parse", "HEAD");
    assert.throws(() => git("merge", "--no-edit", "main"));
    assert.equal(git("rev-parse", "HEAD"), before);
    assert.ok(git("diff", "--name-only", "--diff-filter=U").includes("news.txt"));
    git("merge", "--abort");
    assert.equal(git("show", "HEAD:news.txt"), "news batch 2");
  });
} catch (error) {
  failure = error;
} finally {
  const report = {
    scope: "Local isolated Git mechanics only. No GitHub Actions, PR creation or real merge executed.",
    results,
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status !== "PASS").length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (reportPath) {
    mkdirSync(join(reportPath, ".."), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
  // The fixture is a throwaway repo; leaving it behind accumulates a directory
  // per run under outputs/ and used to be the main thing in there.
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

if (failure) {
  console.error(failure.message);
  process.exitCode = 1;
}
