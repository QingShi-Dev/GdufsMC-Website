// scripts/test-release.mjs
//
// Smoke-test a standalone release artifact locally. Starts `node server.js`
// bound to 127.0.0.1 on a random free port, waits for health, then exercises
// key routes with the built-in fetch. No external servers, no push. In the
// finally block it terminates ONLY the spawned child process.
//
// Usage:
//   node scripts/test-release.mjs [<stage-dir>]
// If no stage dir is given, the most recently modified directory under
// .release-stage/ is used.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(process.cwd());
const STAGE_ROOT = join(ROOT, ".release-stage");

function failEarly(msg) {
  console.error("test-release: " + msg);
  process.exit(1);
}

// thrown inside the try; lets finally run cleanup before we exit
function die(msg) {
  throw new Error(msg);
}

// ---------------------------------------------------------------------------
// resolve stage directory
// ---------------------------------------------------------------------------
let stageDir = process.argv[2];
if (stageDir) {
  stageDir = resolve(stageDir);
  if (!existsSync(stageDir) || !statSync(stageDir).isDirectory()) {
    failEarly("provided stage directory does not exist: " + stageDir);
  }
} else {
  if (!existsSync(STAGE_ROOT)) {
    failEarly("no stage dir arg and .release-stage missing; nothing to test");
  }
  const dirs = readdirSync(STAGE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(STAGE_ROOT, e.name));
  if (dirs.length === 0) {
    failEarly("no release stage directories found under .release-stage");
  }
  let newest = dirs[0];
  let newestMtime = statSync(newest).mtimeMs;
  for (const d of dirs.slice(1)) {
    const m = statSync(d).mtimeMs;
    if (m > newestMtime) {
      newest = d;
      newestMtime = m;
    }
  }
  stageDir = newest;
}
console.log("test-release: stageDir=" + stageDir);

if (!existsSync(join(stageDir, "server.js"))) {
  failEarly("server.js not found in stage: " + join(stageDir, "server.js"));
}

// ---------------------------------------------------------------------------
// expected release marker (for commit/id assertion)
// ---------------------------------------------------------------------------
let expected = null;
for (const p of [
  join(stageDir, "release.json"),
  join(stageDir, "public", "__release.json"),
]) {
  if (existsSync(p)) {
    try {
      expected = JSON.parse(readFileSync(p, "utf8"));
      break;
    } catch {
      // ignore malformed marker
    }
  }
}
if (!expected || !expected.id || !expected.commit) {
  console.warn("test-release: no release marker found; commit/id check skipped");
}

// ---------------------------------------------------------------------------
// pick a real public asset and a content image to probe
// ---------------------------------------------------------------------------
function firstPublicAsset() {
  const pub = join(stageDir, "public");
  if (!existsSync(pub)) return null;
  const stack = [pub];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        const rel = relative(join(stageDir, "public"), full).split("\\").join("/");
        return "/" + rel;
      }
    }
  }
  return null;
}
const publicAsset = firstPublicAsset();
if (!publicAsset) {
  console.warn("test-release: no public asset found; public check skipped");
}

// Where content lives for this run.
//
// A release built with RELEASE_EXTERNAL_CONTENT=1 ships no content/ at all and
// expects the runtime env CONTENT_ROOT to point at the parent of content/. The
// smoke test has to look in the SAME place the server will look, otherwise it
// probes an image the server cannot serve and reports a false failure.
//
//   RELEASE_EXTERNAL_CONTENT=1  -> <CONTENT_ROOT>/content/news/images
//   otherwise                   -> <stageDir>/content/news/images
//
// CONTENT_ROOT itself is inherited from the environment by the child below,
// so a caller can point the smoke test at any tree.
const externalContent = process.env.RELEASE_EXTERNAL_CONTENT === "1";
const contentRoot = externalContent ? process.env.CONTENT_ROOT : stageDir;
if (externalContent) {
  // An external-content release has no bundled content, so CONTENT_ROOT is not
  // optional and a wrong value is not a degraded-but-working state: the app
  // starts, answers 200 on every route, and shows an empty news list. Refuse
  // to "pass" a smoke test that only skipped the content checks.
  if (!contentRoot) {
    failEarly(
      "RELEASE_EXTERNAL_CONTENT=1 but CONTENT_ROOT is not set; the release has " +
        "no content/ and the server would read nothing"
    );
  }
  const contentDir = join(contentRoot, "content");
  if (!existsSync(contentDir) || !statSync(contentDir).isDirectory()) {
    failEarly(
      "RELEASE_EXTERNAL_CONTENT=1 and CONTENT_ROOT='" +
        contentRoot +
        "' does not contain a content/ directory. The server reads " +
        "<CONTENT_ROOT>/content and would not find the external content."
    );
  }
  const newsDir = join(contentDir, "news");
  if (!existsSync(newsDir) || !statSync(newsDir).isDirectory() || countNewsFiles() === 0) {
    failEarly(
      "RELEASE_EXTERNAL_CONTENT=1 but no markdown articles found in " +
        newsDir +
        ". The external content root is empty or wrong; server was not started."
    );
  }
}

function firstContentImage() {
  const imgDir = join(contentRoot, "content", "news", "images");
  if (!existsSync(imgDir)) return null;
  for (const e of readdirSync(imgDir, { withFileTypes: true })) {
    if (e.isFile() && /\.(webp|png|jpe?g|gif|svg)$/i.test(e.name)) {
      return "/content/news/images/" + e.name;
    }
  }
  return null;
}
const contentImage = firstContentImage();
if (!contentImage) {
  console.warn(
    "test-release: no content image found at " +
      join(contentRoot, "content", "news", "images") +
      "; content-image check skipped"
  );
}

function countNewsFiles() {
  const dir = join(contentRoot, "content", "news");
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith(".md")
  ).length;
}

// ---------------------------------------------------------------------------
// random free port
// ---------------------------------------------------------------------------
function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolvePort(port));
    });
  });
}

const PORT = await getFreePort();
const HOST = "127.0.0.1";
const BASE = "http://" + HOST + ":" + PORT;
console.log("test-release: bound to " + BASE);

let child = null;
let childExited = false;
let exitCode = 0;

function cleanup() {
  // terminate ONLY the spawned child (no process groups, no siblings)
  if (child && !childExited) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    // escalate only if still alive shortly after
    const pid = child;
    setTimeout(() => {
      if (!childExited) {
        try {
          pid.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }, 3000);
  }
}

try {
  console.log("test-release: spawning node server.js...");
  child = spawn(process.execPath, ["server.js"], {
    cwd: stageDir,
    env: { ...process.env, HOSTNAME: HOST, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write("[server] " + d));
  child.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  child.on("exit", (code, signal) => {
    childExited = true;
    console.error(
      "test-release: server child exited code=" +
        String(code) +
        " signal=" +
        String(signal)
    );
  });

  // wait for health (poll /__release.json). On the GitHub Actions
  // windows-2022 runner, Windows Defender real-time inspection of every
  // newly-extracted file can slow the first node + Next.js startup to
  // several minutes; bump the deadline accordingly and log progress.
  const HEALTH_URL = BASE + "/__release.json";
  const STARTUP_DEADLINE_MS = 240000; // 4 min
  const deadline = Date.now() + STARTUP_DEADLINE_MS;
  let healthy = false;
  let polls = 0;
  while (Date.now() < deadline) {
    if (childExited) die("server exited before becoming healthy");
    polls++;
    try {
      const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200) {
        healthy = true;
        break;
      }
    } catch {
      // not up yet
    }
    if (polls % 10 === 0) {
      const elapsed = Math.round((Date.now() - (deadline - STARTUP_DEADLINE_MS)) / 1000);
      console.log(`test-release: still waiting for healthy after ${elapsed}s (poll #${polls})`);
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  if (!healthy) die("server did not become healthy within " + String(Math.round(STARTUP_DEADLINE_MS / 1000)) + "s");
  console.log("test-release: server healthy at " + BASE + " after " + polls + " polls");

  // run checks
  const checks = [];
  async function check(name, url, validate) {
    try {
      const r = await fetch(BASE + url, { signal: AbortSignal.timeout(10000) });
      const ok = await validate(r);
      checks.push({ name, ok, detail: ok ? "" : "status=" + r.status });
    } catch (err) {
      checks.push({
        name,
        ok: false,
        detail: String((err && err.message) || err),
      });
    }
  }

  await check("home", "/", async (r) => r.status === 200);
  await check("map", "/map", async (r) => r.status === 200);
  await check("news", "/news", async (r) => r.status === 200);
  await check("release-json", "/__release.json", async (r) => {
    if (r.status !== 200) return false;
    const body = await r.json();
    if (expected) {
      if (body.id !== expected.id) return false;
      if (body.commit !== expected.commit) return false;
    }
    return true;
  });
  if (publicAsset) {
    await check("public-asset(" + publicAsset + ")", publicAsset, async (r) =>
      r.status === 200
    );
  }
  if (contentImage) {
    await check("content-image(" + contentImage + ")", contentImage, async (r) => {
      if (r.status !== 200) return false;
      const ct = r.headers.get("content-type") || "";
      return ct.startsWith("image/");
    });
  }

  // Content-backed rendering, not just content-backed bytes.
  //
  // /news returning 200 proves the route exists, not that it found any
  // articles. When content lives outside the release, the failure mode is
  // silent in exactly that way: misconfigured CONTENT_ROOT yields an empty
  // news page that still answers 200. Count the article links on the rendered
  // list and compare against what the content tree on disk actually holds.
  const expectedArticles = countNewsFiles();
  if (expectedArticles > 0) {
    await check(
      "news-list-renders-content(" + expectedArticles + " article(s))",
      "/news",
      async (r) => {
        if (r.status !== 200) return false;
        const html = await r.text();
        // Article cards link to /news/<slug>. Count distinct hrefs so the
        // header nav (which may link to /news once) does not inflate this.
        const hrefs = new Set();
        for (const m of html.matchAll(/href="\/news\/([^"?#]+)"/g)) {
          hrefs.add(m[1]);
        }
        return hrefs.size >= expectedArticles;
      }
    );
  } else if (externalContent) {
    // Bundled releases may legitimately ship an empty content/ (a fresh
    // project), so this only skips. An EXTERNAL release exists precisely to
    // serve articles, and an empty tree means the operator pointed
    // CONTENT_ROOT at the wrong place or wiped the directory. Fail.
    die(
      "RELEASE_EXTERNAL_CONTENT=1 but no markdown articles found in " +
        join(contentRoot, "content", "news") +
        ". The external content root is empty or wrong."
    );
  } else {
    console.warn(
      "test-release: no markdown articles found in " +
        join(contentRoot, "content", "news") +
        "; news-list-renders-content check skipped"
    );
  }

  // report
  let failed = 0;
  for (const c of checks) {
    const tag = c.ok ? "PASS" : "FAIL";
    if (!c.ok) failed++;
    console.log(
      "test-release: [" + tag + "] " + c.name + (c.ok ? "" : " -- " + c.detail)
    );
  }
  if (failed > 0) die("smoke test failed (" + failed + " checks failed)");
  console.log("test-release: ALL CHECKS PASSED");
} catch (err) {
  exitCode = 1;
  console.error(
    "test-release: " + (err && err.message ? err.message : String(err))
  );
} finally {
  cleanup();
}

process.exit(exitCode);
