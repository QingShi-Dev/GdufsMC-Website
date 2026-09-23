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

function firstContentImage() {
  const imgDir = join(stageDir, "content", "news", "images");
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
  console.warn("test-release: no content image found; content-image check skipped");
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

  // wait for health (poll /__release.json)
  const HEALTH_URL = BASE + "/__release.json";
  const deadline = Date.now() + 45000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (childExited) die("server exited before becoming healthy");
    try {
      const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200) {
        healthy = true;
        break;
      }
    } catch {
      // not up yet
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  if (!healthy) die("server did not become healthy within timeout");
  console.log("test-release: server healthy at " + BASE);

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
