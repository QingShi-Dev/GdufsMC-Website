import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createReleaseArchive } from "../build/create-release-archive.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-archive-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stage = join(root, "stage with spaces");
  mkdirSync(stage);
  writeFileSync(join(stage, "server.js"), "fixture server");
  return { root, stage, output: join(root, "release.tar.gz") };
}

test("failed archive leaves no publishable or temporary file", async (t) => {
  const f = fixture(t);
  await assert.rejects(createReleaseArchive({ ...f, stage: join(f.root, "missing") }));
  assert.equal(existsSync(f.output), false);
  assert.equal(existsSync(f.output + ".partial"), false);
});

test("existing release archive is never overwritten", async (t) => {
  const f = fixture(t);
  writeFileSync(f.output, "keep");
  await assert.rejects(createReleaseArchive(f), /already exists/);
  assert.equal(readFileSync(f.output, "utf8"), "keep");
});

test("release archive round-trips Unicode names with Windows tar", async (t) => {
  const f = fixture(t);
  const filename = "分队 data.yml";
  writeFileSync(join(f.stage, filename), "teams: []\n");
  await createReleaseArchive(f);
  const dest = join(f.root, "extracted");
  mkdirSync(dest);
  const tar = process.platform === "win32" ? join(process.env.SystemRoot || "C:/Windows", "System32", "tar.exe") : "tar";
  const result = spawnSync(tar, ["-xf", "release.tar.gz", "--options=hdrcharset=UTF-8", "-C", "extracted"],
    { cwd: f.root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(readFileSync(join(dest, "server.js"), "utf8"), "fixture server");
  assert.equal(readFileSync(join(dest, filename), "utf8"), "teams: []\n");
});
