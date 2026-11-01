import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { archiveCommands, createReleaseArchive } from "../build/create-release-archive.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-archive-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stage = join(root, "stage with spaces");
  mkdirSync(stage);
  writeFileSync(join(stage, "server.js"), "fixture server");
  return { root, stage, output: join(root, "release.tar.gz") };
}

test("Windows archive commands are explicit, ordered and independent of PATH", () => {
  const commands = archiveCommands("win32", { SystemRoot: "C:/Windows", ProgramFiles: "C:/Program Files" });
  assert.equal(commands.length, 2);
  assert.match(commands[0].replaceAll("\\", "/"), /Windows\/System32\/tar.exe$/);
  assert.match(commands[1].replaceAll("\\", "/"), /Git\/usr\/bin\/tar.exe$/);
  assert.deepEqual(archiveCommands("linux", {}), ["tar"]);
});

test("crashed native tar is retried, while gzip is handled by Node", async (t) => {
  const f = fixture(t), calls = [], logs = [];
  const command = process.execPath; // Existing absolute executable for the injected runner.
  let attempts = 0;
  await createReleaseArchive({ ...f, commands: [command, command], log: (s) => logs.push(s),
    run: (_command, args, options) => {
      calls.push(args);
      if (args[0] === "--version") return { status: 0, stdout: "fixture tar" };
      assert.equal(options.cwd, f.root);
      assert.equal(args[0], "-cf");
      assert.ok(args.includes("--format=pax"));
      assert.equal(args.includes("--options=hdrcharset=UTF-8"), false);
      writeFileSync(join(f.root, args[1]), ++attempts === 1 ? "partial tar" : "complete tar");
      return { status: attempts === 1 ? 3221225477 : 0, stderr: "" };
    } });
  assert.equal(attempts, 2);
  assert.equal(gunzipSync(readFileSync(f.output)).toString(), "complete tar");
  assert.ok(logs.some((s) => s.includes("3221225477")));
  assert.equal(calls.some((args) => args.includes("-czf")), false);
  assert.equal(existsSync(f.output + ".partial"), false);
  assert.equal(existsSync(f.output + ".uncompressed.tar"), false);
});

test("all tar failures leave no publishable or temporary archive", async (t) => {
  const f = fixture(t);
  await assert.rejects(createReleaseArchive({ ...f, commands: [process.execPath],
    run: () => ({ status: null, error: new Error("spawn failed") }) }), /All release tar executables failed/);
  for (const path of [f.output, f.output + ".partial", f.output + ".uncompressed.tar"]) assert.equal(existsSync(path), false);
});

test("existing release archive is never overwritten", async (t) => {
  const f = fixture(t);
  writeFileSync(f.output, "keep");
  await assert.rejects(createReleaseArchive(f), /already exists/);
  assert.equal(readFileSync(f.output, "utf8"), "keep");
});

test("BSD tar uses PAX without the crashing header charset option", async (t) => {
  const f = fixture(t);
  await createReleaseArchive({ ...f, commands: [process.execPath],
    run: (_command, args) => {
      if (args[0] === "--version") return { status: 0, stdout: "bsdtar 3.7.9 - libarchive" };
      assert.ok(args.includes("--format=pax"));
      assert.equal(args.includes("--options=hdrcharset=UTF-8"), false);
      writeFileSync(join(f.root, args[1]), "fixture tar");
      return { status: 0, stderr: "" };
    } });
});

test("real tar and Node gzip round-trip filenames and payloads", async (t) => {
  const commands = archiveCommands().filter((c) => process.platform !== "win32" || existsSync(c));
  assert.ok(commands.length, "A real tar executable is required for integration testing");
  const f = fixture(t), logs = [];
  const filename = "分队 data.yml";
  writeFileSync(join(f.stage, filename), "teams: []\n");
  try {
    await createReleaseArchive({ ...f, commands, log: (s) => logs.push(s) });
  } catch (error) {
    assert.fail(error.message + "\n" + logs.join("\n"));
  }
  const archive = gunzipSync(readFileSync(f.output));
  // Check bytes independently of extraction, which may use a different tar.
  assert.ok(archive.includes(Buffer.from("path=./" + filename + "\n", "utf8")),
    "Archive must contain the original UTF-8 PAX path; " + logs.join("\n"));
  const dest = join(f.root, "extracted");
  mkdirSync(dest);
  const result = spawnSync(commands[0], ["-xf", "release.tar.gz", "-C", "extracted"],
    { cwd: f.root, encoding: "utf8" });
  assert.equal(result.status, 0,
    (result.stderr || result.error?.message || "archive extraction failed") + "\n" + logs.join("\n"));
  assert.equal(readFileSync(join(dest, "server.js"), "utf8"), "fixture server");
  assert.equal(readFileSync(join(dest, filename), "utf8"), "teams: []\n");
});
