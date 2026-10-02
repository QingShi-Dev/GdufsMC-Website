// Build a trusted, offline runnable tool bundle from installed dependencies.
// No package manager, lifecycle script, network request, or candidate code runs.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const CONTENT_TOOL_FILES = Object.freeze([
  "scripts/content-source.mjs", "scripts/content-snapshot.mjs", "scripts/content-sync.mjs",
  "scripts/verify-content-root.mjs", "lib/slugify-core.mjs",
  "deploy/content-operations.ps1", "deploy/setup-content-sync.ps1", "deploy/process-content-queue.ps1",
  "deploy/activate-content.ps1", "deploy/invoke-content-purge.ps1",
]);
export const CONTENT_TOOL_DEPENDENCIES = Object.freeze([
  "gray-matter", "js-yaml", "pinyin-pro", "unified", "remark-parse", "remark-gfm",
]);
const repository = fileURLToPath(new URL("../", import.meta.url));
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const packageName = (name) => typeof name === "string" && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name) && !name.split("/").some((part) => part === "." || part === "..");

function resolvePackage(name, fromManifest) {
  if (!packageName(name)) fail("INVALID_DEPENDENCY", "Unsupported package name");
  const req = createRequire(fromManifest);
  try { return realpathSync(req.resolve(name + "/package.json")); }
  catch (error) {
    if (!["ERR_PACKAGE_PATH_NOT_EXPORTED", "MODULE_NOT_FOUND"].includes(error.code)) throw error;
    // Package exports can hide package.json. Resolve through Node's own search
    // paths from the requiring package, including pnpm's isolated layout.
    for (const root of req.resolve.paths(name) || []) {
      const manifest = join(root, ...name.split("/"), "package.json");
      if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === name) return realpathSync(manifest);
    }
    fail("MISSING_DEPENDENCY", "Installed runtime dependency is missing: " + name);
  }
}

async function assertAncestors(path) {
  for (let cursor = path; ; cursor = dirname(cursor)) {
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("UNSAFE_DESTINATION", "Bundle ancestors must be ordinary directories");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (dirname(cursor) === cursor) break;
  }
}

export async function packageContentTools({ destination = join(repository, "outputs", "content-sync-tools"), sourceRoot = repository } = {}) {
  // Containment is judged between two spellings of the same directory, so
  // both must be canonicalised first. A GitHub windows-2022 runner reports
  // its temp directory as C:\Users\RUNNER~1\AppData\Local\Temp; realpath()
  // expands that to C:\Users\runneradmin\..., and comparing the expanded
  // child against the un-expanded root makes path.relative() walk out five
  // levels and report a file that is genuinely inside as an escape.
  const source = await realpath(sourceRoot);
  // Same reason: the destination is usually a sibling of the source, and on a
  // runner both arrive spelled with the short temp name while the checks
  // below compare them against realpath'd values.
  const target = await realpath(resolve(destination)).catch(async () => {
    // The destination does not exist yet, which is the normal case. Its
    // deepest existing ancestor is what has to match.
    let cursor = resolve(destination);
    const tail = [];
    for (;;) {
      const parent = dirname(cursor);
      if (parent === cursor) return resolve(destination);
      tail.unshift(basename(cursor));
      try {
        await realpath(parent);
        return join(await realpath(parent), ...tail);
      } catch {
        cursor = parent;
      }
    }
  });
  const rel = relative(source, target);
  if (!rel || (!isAbsolute(rel) && (rel === "node_modules" || rel.startsWith("node_modules" + sep)))) {
    fail("UNSAFE_DESTINATION", "Bundle destination must not replace the source or installed dependencies");
  }
  await assertAncestors(target);
  try { await lstat(target); fail("DESTINATION_EXISTS", "Refusing to overwrite an existing content tool bundle"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }

  const fixed = [];
  for (const path of CONTENT_TOOL_FILES) {
    const from = join(source, ...path.split("/"));
    const stat = await lstat(from);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("UNSAFE_TOOL", "Fixed content tools must be ordinary files: " + path);
    const canonical = await realpath(from);
    const relativeSource = relative(source, canonical);
    if (isAbsolute(relativeSource) || relativeSource === ".." || relativeSource.startsWith(".." + sep)) {
      // Name both sides. A containment check that rejects a file which is
      // genuinely inside the tree is usually the two roots being spelled
      // differently (short vs long name, casing, symlinked temp), and the
      // message above gives no way to tell that from a real escape.
      fail("UNSAFE_TOOL",
        "Fixed script resolves outside sourceRoot: " + path +
        "\n  sourceRoot : " + source +
        "\n  resolved   : " + canonical +
        "\n  relative   : " + relativeSource);
    }
    fixed.push({ path, from });
  }

  const nodes = new Map();
  const globals = new Map();
  const queue = [];
  function locate(name, requester) {
    const file = resolvePackage(name, requester);
    let node = nodes.get(file);
    if (!node) {
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      if (manifest.name !== name || typeof manifest.version !== "string") fail("INVALID_DEPENDENCY", "Installed package manifest does not match its name");
      node = { name, file, root: dirname(file), version: manifest.version, manifest, dependencies: new Map() };
      nodes.set(file, node);
      queue.push(node);
      if (nodes.size > 1000) fail("DEPENDENCY_LIMIT", "Runtime dependency graph exceeds 1000 packages");
    }
    return node;
  }
  const projectManifest = join(source, "package.json");
  for (const name of CONTENT_TOOL_DEPENDENCIES) globals.set(name, locate(name, projectManifest));
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    const dependencies = { ...node.manifest.dependencies, ...node.manifest.optionalDependencies, ...node.manifest.peerDependencies };
    for (const name of Object.keys(dependencies).sort()) {
      let dependency;
      try { dependency = locate(name, node.file); }
      catch (error) {
        const optional = Object.hasOwn(node.manifest.optionalDependencies || {}, name) || node.manifest.peerDependenciesMeta?.[name]?.optional;
        if (optional && error.code === "MISSING_DEPENDENCY") continue;
        throw error;
      }
      node.dependencies.set(name, dependency);
      if (!globals.has(name)) globals.set(name, dependency);
    }
  }

  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  const copiedFiles = [];
  let fileCount = 0, bytes = 0, placements = 0;
  async function copy(from, to, ignoreModules = false) {
    const stat = await lstat(from);
    if (stat.isSymbolicLink()) fail("PACKAGE_LINK", "A runtime package contains an unexpected internal link");
    if (stat.isDirectory()) {
      await mkdir(to, { recursive: true });
      for (const name of (await readdir(from)).sort()) {
        if (ignoreModules && name === "node_modules") continue;
        await copy(join(from, name), join(to, name), ignoreModules);
      }
      return;
    }
    if (!stat.isFile()) fail("PACKAGE_FILE", "A runtime package contains an unsupported file");
    fileCount++;
    bytes += stat.size;
    if (fileCount > 100000 || bytes > 512 * 1024 * 1024) fail("BUNDLE_LIMIT", "Tool bundle exceeds file or byte budget");
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to, 1); // COPYFILE_EXCL
    copiedFiles.push({ path: relative(target, to).split(sep).join("/"), size: stat.size,
      sha256: createHash("sha256").update(await readFile(to)).digest("hex") });
  }
  for (const item of fixed) await copy(item.from, join(target, ...item.path.split("/")));

  async function place(node, targetPackage, visible, depth = 0) {
    if (depth > 32 || ++placements > 2000) fail("DEPENDENCY_LIMIT", "Runtime dependency placement exceeds policy");
    await copy(node.root, targetPackage, true);
    // Hoist shared exact packages; materialize version conflicts locally.
    // The inherited map models Node's requester-relative lookup, so a nested
    // dependency cannot accidentally bind an incompatible ancestor version.
    const overrides = new Map();
    for (const [name, dependency] of node.dependencies) {
      if (visible.get(name)?.file !== dependency.file) overrides.set(name, dependency);
    }
    const nextVisible = new Map([...visible, ...overrides]);
    for (const [name, dependency] of overrides) {
      await place(dependency, join(targetPackage, "node_modules", ...name.split("/")), nextVisible, depth + 1);
    }
  }
  for (const [name, node] of globals) await place(node, join(target, "node_modules", ...name.split("/")), globals);
  const packageJson = JSON.stringify({ name: "gdufsmc-content-sync-tools", private: true, type: "module" }, null, 2) + "\n";
  await writeFile(join(target, "package.json"), packageJson, { flag: "wx" });
  const packageBytes = Buffer.byteLength(packageJson);
  copiedFiles.push({ path: "package.json", size: packageBytes, sha256: createHash("sha256").update(packageJson).digest("hex") });
  fileCount++;
  bytes += packageBytes;
  const manifest = { version: 1, files: copiedFiles.sort((a, b) => a.path.localeCompare(b.path, "en")),
    packages: [...nodes.values()].map((node) => ({ name: node.name, version: node.version })).sort((a, b) => (a.name + "@" + a.version).localeCompare(b.name + "@" + b.version, "en")),
    fileCount, totalBytes: bytes };
  await writeFile(join(target, "tools-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return { destination: target, ...manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) {
    console.error("Usage: node scripts/package-content-tools.mjs [destination]");
    process.exitCode = 2;
  } else {
    packageContentTools({ ...(process.argv[2] ? { destination: process.argv[2] } : {}) })
      .then((result) => console.log(JSON.stringify({ destination: result.destination, packages: result.packages.length, files: result.fileCount, bytes: result.totalBytes })))
      .catch((error) => { console.error("package-content-tools: " + error.message); process.exitCode = 1; });
  }
}
