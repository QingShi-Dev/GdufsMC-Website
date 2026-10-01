// Run real HTTP tests against an existing standalone/release directory.
// Fixture generation uses workspace sharp; requests execute the target server's sharp.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import sharp from "sharp";
import { verifySharp } from "./sharp-runtime.mjs";
const stage = resolve(process.argv[2] || ".next/standalone");
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise(r => socket.close(r));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), ADMIN_IMAGE_ORIGIN: "https://gdufscraft.top" };
delete env.NODE_PATH;
const child = spawn(process.execPath, ["server.js"], { cwd: stage, env, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
child.stdout.on("data", d => { logs += d; });
child.stderr.on("data", d => { logs += d; });
const exited = once(child, "exit");
const results = [];
async function check(name, test) {
  try { await test(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, pass: false, error: e.message }); console.error(`FAIL ${name}: ${e.message}`); }
}
async function upload(buf, origin = "https://gdufscraft.top") {
  const body = new FormData();
  body.set("file", new File([buf], "fixture.png"));
  return fetch(base + "/api/admin/image-convert", { method: "POST", headers: { origin }, body, signal: AbortSignal.timeout(45000) });
}
async function image(buf, width, height, quality, alpha) {
  const r = await upload(buf);
  assert.equal(r.status, 200, await (r.status === 200 ? Promise.resolve("") : r.text()));
  assert.equal(r.headers.get("content-type"), "image/webp");
  assert.ok(r.headers.get("cache-control")?.split(",").map(v => v.trim()).includes("no-store"));
  assert.equal(r.headers.get("x-image-quality"), String(quality));
  const output = Buffer.from(await r.arrayBuffer());
  const m = await sharp(output).metadata();
  assert.equal(m.format, "webp"); assert.equal(m.width, width); assert.equal(m.height, height);
  if (alpha !== undefined) assert.equal(m.hasAlpha, alpha);
  assert.equal(Number(r.headers.get("x-image-bytes")), output.length);
  return { r, output };
}
try {
  await check("Sharp native preflight", () => verifySharp(stage));
  if (results.some(r => !r.pass)) throw new Error("Sharp preflight failed; see exact resolution diagnostics above");
  let ready = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Server exited: " + logs);
    try { await fetch(base + "/api/admin/image-convert", { signal: AbortSignal.timeout(1000) }); ready = true; break; } catch { /* wait for our child */ }
    await new Promise(r => setTimeout(r, 300));
  }
  if (!ready) throw new Error("Startup timeout: " + logs);
  const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 10, g: 60, b: 120, alpha: 0.5 } } }).png().toBuffer();
  const small = await png(800, 600);
  await check("small PNG: no enlargement, transparency, q90", () => image(small, 800, 600, 90, true));
  await check("landscape auto resize", async () => image(await png(2560, 1440), 1920, 1080, 90));
  await check("portrait auto resize", async () => image(await png(1080, 1920), 608, 1080, 90));
  await check("JPEG EXIF orientation", async () => {
    const jpeg = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "blue" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    await image(jpeg, 720, 1080, 90);
  });
  await check("q85 fallback and >300KiB accepted", async () => {
    const noisy = await sharp(randomBytes(1920 * 1080 * 3), { raw: { width: 1920, height: 1080, channels: 3 } }).png().toBuffer();
    const { r, output } = await image(noisy, 1920, 1080, 85);
    assert.ok(output.length > 307200); assert.equal(r.headers.get("x-image-over-300-kib"), "true");
  });
  await check("foreign Origin rejected", async () => assert.equal((await upload(small, "https://invalid.example")).status, 403));
  await check("corrupt image rejected", async () => assert.equal((await upload(Buffer.from("bad"))).status, 422));
  await check("GIF rejected by conversion endpoint", async () => assert.equal((await upload(await sharp(small).gif().toBuffer())).status, 415));
  await check("WebP not recompressed", async () => assert.equal((await upload(await sharp(small).webp().toBuffer())).status, 415));
  await check("empty multipart rejected", async () => {
    const r = await fetch(base + "/api/admin/image-convert", { method: "POST", headers: { origin: "https://gdufscraft.top" }, body: new FormData() }); assert.equal(r.status, 400);
  });
  await check("GET disallowed", async () => assert.equal((await fetch(base + "/api/admin/image-convert")).status, 405));
} catch (e) { results.push({ name: "startup/tests", pass: false, error: e.message }); }
finally {
  if (child.exitCode === null) child.kill();
  await exited;
  const report = { stage, node: process.version, testedAt: new Date().toISOString(), results, logs, note: "Loopback HTTP test against the stage directory recorded above. Caddy authentication is not tested. In CI, stage is the extracted release archive." };
  if (process.argv[3]) writeFileSync(resolve(process.argv[3]), JSON.stringify(report, null, 2));
}
if (!results.length || results.some(r => !r.pass)) process.exitCode = 1;
