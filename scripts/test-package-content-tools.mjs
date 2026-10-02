import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONTENT_TOOL_DEPENDENCIES, CONTENT_TOOL_FILES, packageContentTools } from "./package-content-tools.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
function temporary(t) {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, "content-tool-test-"));
  t.after(() => {
    const rel = relative(parent, resolve(root));
    assert.ok(!isAbsolute(rel) && !rel.startsWith("..") && !rel.includes(sep) && rel.startsWith("content-tool-test-"));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function write(root, path, text) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
function packageAt(root, path, name, version = "1.0.0", extra = {}) {
  write(root, path + "/package.json", JSON.stringify({ name, version, main: "index.js", ...extra }));
  write(root, path + "/index.js", "module.exports = " + JSON.stringify(version) + ";\n");
}
function fixture(t) {
  const root = temporary(t);
  write(root, "package.json", JSON.stringify({ name: "fake-source", private: true }));
  for (const file of CONTENT_TOOL_FILES) write(root, file, "// fixed trusted tool fixture\n");
  for (const name of CONTENT_TOOL_DEPENDENCIES) packageAt(root, "node_modules/" + name, name);
  return root;
}
function ordinaryFiles(root) {
  let count = 0;
  function walk(path) {
    const stat = lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false, "Bundle must not depend on source links");
    if (stat.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
    else { assert.ok(stat.isFile()); count++; }
  }
  walk(root);
  return count;
}

test("bundle copies exactly the fixed tools and installed dependency closure", async (t) => {
  const source = fixture(t);
  packageAt(source, "node_modules/gray-matter", "gray-matter", "4.0.0", {
    dependencies: { "js-yaml": "^3", shared: "*" }, devDependencies: { "must-not-install": "*" }, optionalDependencies: { "absent-optional": "*" },
  });
  packageAt(source, "node_modules/js-yaml", "js-yaml", "5.0.0", { dependencies: { leaf: "^2" } });
  packageAt(source, "node_modules/leaf", "leaf", "2.0.0");
  packageAt(source, "node_modules/shared", "shared", "1.0.0", { exports: { ".": "./index.js" } });
  packageAt(source, "node_modules/gray-matter/node_modules/js-yaml", "js-yaml", "3.0.0", { dependencies: { leaf: "^1" } });
  packageAt(source, "node_modules/gray-matter/node_modules/js-yaml/node_modules/leaf", "leaf", "1.0.0");
  write(source, "content/news/candidate.md", "Candidate data must not enter the tool bundle");
  write(source, ".env", "NEVER_COPY=secret");
  const target = join(temporary(t), "bundle");
  const result = await packageContentTools({ sourceRoot: source, destination: target });
  for (const file of CONTENT_TOOL_FILES) assert.ok(existsSync(join(target, file)));
  assert.equal(existsSync(join(target, "content")), false);
  assert.equal(existsSync(join(target, ".env")), false);
  assert.equal(existsSync(join(target, "node_modules", "must-not-install")), false);
  assert.equal(existsSync(join(target, "node_modules", "absent-optional")), false);
  const top = createRequire(join(target, "package.json"));
  const gray = createRequire(join(target, "node_modules", "gray-matter", "package.json"));
  assert.equal(top("js-yaml"), "5.0.0");
  assert.equal(gray("js-yaml"), "3.0.0");
  const nested = createRequire(gray.resolve("js-yaml/package.json"));
  assert.equal(nested("leaf"), "1.0.0");
  assert.equal(top("leaf"), "2.0.0");
  assert.equal(result.fileCount + 1, ordinaryFiles(target)); // tools-manifest excludes itself.
  assert.equal(result.files.length, result.fileCount);
});

test("missing fixed scripts fail before creating a bundle", async (t) => {
  const source = temporary(t), target = join(temporary(t), "bundle");
  await assert.rejects(() => packageContentTools({ sourceRoot: source, destination: target }));
  assert.equal(existsSync(target), false);
});

test("missing required runtime dependency fails before creating a bundle", async (t) => {
  const source = fixture(t), target = join(temporary(t), "bundle");
  packageAt(source, "node_modules/gray-matter", "gray-matter", "4.0.0", { dependencies: { missing: "*" } });
  await assert.rejects(() => packageContentTools({ sourceRoot: source, destination: target }), (error) => error.code === "MISSING_DEPENDENCY");
  assert.equal(existsSync(target), false);
});

test("an existing bundle is never overwritten", async (t) => {
  const source = fixture(t), target = temporary(t);
  write(target, "keep.txt", "original");
  await assert.rejects(() => packageContentTools({ sourceRoot: source, destination: target }), (error) => error.code === "DESTINATION_EXISTS");
  assert.equal(readFileSync(join(target, "keep.txt"), "utf8"), "original");
});

test("real installed dependency closure runs the bundled validator outside the repository", async (t) => {
  const target = join(temporary(t), "bundle");
  const result = await packageContentTools({ sourceRoot: repoRoot, destination: target });
  const snapshot = temporary(t);
  write(snapshot, "content/news/one.md", '---\ntitle: 独立工具包验证\ndate: "2026-10-01"\ncategory: 公告\ncover: /content/news/images/cover.png\n---\n![参考图][photo]\n\n[photo]: /content/news/images/cover.png\n');
  write(snapshot, "content/leaderboard/index.yml", "entries: []\n");
  write(snapshot, "content/news/images/cover.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
  const stdout = execFileSync(process.execPath, [join(target, "scripts", "verify-content-root.mjs"), snapshot, "--json"], {
    cwd: target, encoding: "utf8", windowsHide: true, timeout: 30000,
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
  });
  const report = JSON.parse(stdout);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.markdownFiles, 1);
  assert.equal(report.summary.imageRefs, 2);
  // Importing the guarded worker verifies its full static import closure
  // without invoking any queue, network, PM2 or production action.
  execFileSync(process.execPath, ["--input-type=module", "--eval",
    "await import(" + JSON.stringify(pathToFileURL(join(target, "scripts", "content-sync.mjs")).href) + ");"], {
    cwd: target, encoding: "utf8", windowsHide: true, timeout: 30000,
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
  });
  assert.ok(result.packages.some((item) => item.name === "js-yaml" && item.version.startsWith("3.")));
  assert.ok(result.packages.some((item) => item.name === "js-yaml" && !item.version.startsWith("3.")));
  assert.equal(result.fileCount + 1, ordinaryFiles(target));
  assert.ok(result.totalBytes < 32 * 1024 * 1024, "A small content tool bundle should not include the application runtime");
});
