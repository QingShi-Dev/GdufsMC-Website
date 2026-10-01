import { test } from "node:test";
import assert from "node:assert/strict";
import { createImageConverter } from "./cms-image-converter.mjs";
const png = () => new File([new Uint8Array([137,80,78,71,13,10,26,10])], "测试.png", { type: "image/png" });
const response = (size = 12) => { const b = new Uint8Array(size); b.set(new TextEncoder().encode("RIFF0000WEBP")); return new Response(b, { headers: { "content-type": "image/webp" } }); };
test("JPEG/PNG use same-origin API and replace filename", async () => {
  const convert = createImageConverter({ fetchImpl: async (url, options) => {
    assert.equal(url, "/api/admin/image-convert"); assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error"); assert.equal(options.body.get("file").name, "测试.png");
    return response();
  }});
  const result = await convert(png()); assert.equal(result.name, "测试.webp"); assert.equal(result.type, "image/webp");
});
test("GIF/SVG/WebP remain unchanged", async () => {
  const convert = createImageConverter({ fetchImpl: () => { throw Error("must not call"); } });
  for (const ext of ["gif", "svg", "webp"]) { const f = new File(["data"], `a.${ext}`); assert.equal(await convert(f), f); }
});
test("actual PNG signature is converted even with misleading extension", async () => {
  let calls = 0; const convert = createImageConverter({ fetchImpl: async () => { calls++; return response(); } });
  await convert(new File([png()], "hidden.gif")); assert.equal(calls, 1);
});
test("batch is sequential and queue recovers after rejection", async () => {
  let active = 0, max = 0, calls = 0;
  const convert = createImageConverter({ fetchImpl: async () => {
    active++; max = Math.max(max, active); const call = calls++;
    await new Promise(r => setTimeout(r, 5)); active--;
    return call === 0 ? new Response("busy", { status: 429 }) : response();
  }});
  const results = await Promise.allSettled([convert(png()), convert(png()), convert(png())]);
  assert.equal(max, 1); assert.deepEqual(results.map(r => r.status), ["rejected", "fulfilled", "fulfilled"]);
});
test("errors never fall back to the original", async () => {
  for (const status of [401,403,413,415,422,429,500]) {
    await assert.rejects(createImageConverter({fetchImpl: async () => new Response("error", {status})})(png()), /原图未提交/);
  }
});
test("HTML and false WebP responses are rejected", async () => {
  await assert.rejects(createImageConverter({ fetchImpl: async () => new Response("login") })(png()));
  await assert.rejects(createImageConverter({ fetchImpl: async () => new Response("not webp", {headers: {"content-type":"image/webp"}}) })(png()));
});
test("q85 outputs over 300 KiB are allowed", async () => {
  const output = await createImageConverter({ fetchImpl: async () => response(400 * 1024) })(png());
  assert.equal(output.size, 400 * 1024);
});
test("timeout rejects, rather than uploading original", async () => {
  const convert = createImageConverter({timeout: 5, fetchImpl: (_, {signal}) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Error("timeout"))))});
  await assert.rejects(convert(png()), /timeout/);
});
