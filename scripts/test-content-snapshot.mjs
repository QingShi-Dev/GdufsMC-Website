import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createContentManifest, validateContent, verifyContentManifest, writeContentSidecar } from "./content-snapshot.mjs";

const A = "a".repeat(40), B = "b".repeat(40);
const hasCode = (code) => (error) => error.code === code;
function temporary(t) {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, "content-snapshot-test-"));
  t.after(() => {
    const rel = relative(parent, resolve(root));
    assert.ok(!isAbsolute(rel) && !rel.startsWith("..") && !rel.includes(sep) && rel.startsWith("content-snapshot-test-"));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function write(root, path, contents) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
  return file;
}
function fixture(t) {
  const root = temporary(t);
  write(root, "content/news/example.md", '---\ntitle: Example\ndate: "2026-10-01"\ncategory: 公告\ncover: /content/news/images/cover.png\n---\nVisible article body\n');
  write(root, "content/leaderboard/index.yml", "entries: []\n");
  write(root, "content/news/images/cover.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
  return root;
}

test("manifest round trip includes every ordinary file and checks commit", async (t) => {
  const root = fixture(t);
  const manifest = await createContentManifest(join(root, "content"), A);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.files.length, 3);
  assert.ok(manifest.files.every((entry) => !entry.path.startsWith("content/") && /^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.deepEqual(await verifyContentManifest(join(root, "content"), manifest, A), manifest);
  await assert.rejects(() => verifyContentManifest(join(root, "content"), manifest, B), hasCode("INVALID_MANIFEST"));
});

test("same-size byte changes cannot satisfy a previous manifest", async (t) => {
  const root = fixture(t);
  const manifest = await createContentManifest(join(root, "content"), A);
  const file = join(root, "content", "news", "example.md");
  const bytes = readFileSync(file);
  bytes[bytes.length - 2] ^= 1;
  writeFileSync(file, bytes);
  await assert.rejects(() => verifyContentManifest(join(root, "content"), manifest, A), hasCode("MANIFEST_MISMATCH"));
});

test("extra and missing files both fail exact manifest verification", async (t) => {
  const root = fixture(t);
  const manifest = await createContentManifest(join(root, "content"), A);
  const extra = write(root, "content/news/extra.md", "extra file");
  await assert.rejects(() => verifyContentManifest(join(root, "content"), manifest, A), hasCode("MANIFEST_MISMATCH"));
  unlinkSync(extra);
  unlinkSync(join(root, "content", "news", "example.md"));
  await assert.rejects(() => verifyContentManifest(join(root, "content"), manifest, A), hasCode("MANIFEST_MISMATCH"));
});

test("manifest schema, digests, duplicate paths and unsafe paths fail closed", async (t) => {
  const root = fixture(t);
  const good = await createContentManifest(join(root, "content"), A);
  for (const change of [
    { version: 2 }, { unexpected: true }, { files: [{ ...good.files[0], sha256: "bad" }] },
    { files: [good.files[0], good.files[0]] }, { files: [{ ...good.files[0], size: -1 }] },
    { files: [{ ...good.files[0], path: "../outside.md" }] },
  ]) {
    await assert.rejects(() => verifyContentManifest(join(root, "content"), { ...good, ...change }, A));
  }
});

test("manifest scanning rejects unsupported paths, empty files and oversized text", async (t) => {
  const root = fixture(t);
  const script = write(root, "content/news/script.js", "unexpected");
  await assert.rejects(() => createContentManifest(join(root, "content"), A), hasCode("UNSUPPORTED_FILE"));
  unlinkSync(script);
  const article = join(root, "content", "news", "example.md");
  truncateSync(article, 0);
  await assert.rejects(() => createContentManifest(join(root, "content"), A), hasCode("FILE_LIMIT"));
  truncateSync(article, 1024 * 1024 + 1);
  await assert.rejects(() => createContentManifest(join(root, "content"), A), hasCode("FILE_LIMIT"));
});

test("junctions cannot import files from outside a snapshot", async (t) => {
  const root = fixture(t), outside = temporary(t);
  write(outside, "outside.png", "outside");
  try { symlinkSync(outside, join(root, "content", "news", "images", "linked"), "junction"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("Junction creation unavailable: " + error.code);
    throw error;
  }
  await assert.rejects(() => createContentManifest(join(root, "content"), A), hasCode("UNSAFE_MODE"));
});

test("validator subprocess returns structured content diagnostics", async (t) => {
  const root = fixture(t);
  const report = await validateContent(root);
  assert.equal(report.summary.markdownFiles, 1);
  assert.equal(report.summary.errors, 0);
  unlinkSync(join(root, "content", "news", "images", "cover.png"));
  await assert.rejects(() => validateContent(root), (error) => error.code === "CONTENT_VALIDATION_FAILED" && error.report.summary.errors > 0);
});

test("sidecar copies content and writes its manifest outside the validated tree", async (t) => {
  const source = fixture(t), target = join(temporary(t), "sidecar");
  const manifest = await writeContentSidecar(target, source, A);
  assert.deepEqual(JSON.parse(readFileSync(join(target, "manifest.json"), "utf8")), manifest);
  assert.deepEqual(readFileSync(join(target, "content", "news", "example.md")), readFileSync(join(source, "content", "news", "example.md")));
  await verifyContentManifest(join(target, "content"), manifest, A);
  assert.equal((await validateContent(target)).summary.errors, 0);
  await assert.rejects(() => writeContentSidecar(target, source, A), hasCode("DESTINATION_EXISTS"));
});

test("invalid source cannot produce a published manifest", async (t) => {
  const source = fixture(t), target = join(temporary(t), "sidecar");
  unlinkSync(join(source, "content", "news", "example.md"));
  await assert.rejects(() => writeContentSidecar(target, source, A), hasCode("CONTENT_VALIDATION_FAILED"));
  assert.equal(existsSync(join(target, "manifest.json")), false);
});
