import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, isAbsolute, sep } from "node:path";
import { includeRuntimePackage, resolveRuntimeManifest } from "./include-runtime-package.mjs";

function inside(root, path) {
  const rel = relative(realpathSync(root), realpathSync(path));
  if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) throw new Error(`Sharp resolved outside release: ${path}`);
}
function applicationSharp(stage) {
  const route = realpathSync(join(stage, ".next/server/app/api/admin/image-convert/route.js"));
  const entry = createRequire(route).resolve("sharp");
  const manifest = resolveRuntimeManifest("sharp", route);
  inside(stage, entry);
  inside(stage, manifest);
  return { entry, manifest, data: JSON.parse(readFileSync(manifest, "utf8")) };
}
function platformPackages(manifest) {
  if (process.platform !== "win32") throw new Error("Sharp supplementation supports Windows only");
  const optional = manifest.optionalDependencies || {};
  const binding = `@img/sharp-win32-${process.arch}`;
  if (!optional[binding]) throw new Error(`sharp@${manifest.version} does not declare ${binding}`);
  return [binding, `@img/sharp-libvips-win32-${process.arch}`].filter(n => optional[n]);
}
function inventory(root) {
  const files = new Map();
  function visit(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) visit(p);
      else if (e.isFile()) {
        const b = readFileSync(p);
        files.set(relative(root, p), { bytes: b.length, hash: createHash("sha256").update(b).digest("hex") });
      } else throw new Error(`Unexpected native package link: ${p}`);
    }
  }
  visit(root);
  return files;
}
export function supplementSharp(stage, workspace, log = console.log) {
  const targets = [applicationSharp(stage)];
  // Turbopack can externalize ESM imports under a hashed package alias.
  // A synthetic require('sharp') alone does not model this actual route import.
  const aliases = join(stage, ".next/node_modules");
  try {
    for (const e of readdirSync(aliases, { withFileTypes: true })) {
      if (!e.name.startsWith("sharp-")) continue;
      const manifest = join(aliases, e.name, "package.json");
      const data = JSON.parse(readFileSync(manifest, "utf8"));
      if (data.name === "sharp") {
        inside(stage, manifest);
        targets.push({ manifest, data, entry: manifest });
      }
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const target of targets) {
  const source = resolveRuntimeManifest("sharp", join(workspace, "package.json"));
  const sourceData = JSON.parse(readFileSync(source, "utf8"));
  if (sourceData.version !== target.data.version) throw new Error(`Sharp version mismatch: stage=${target.data.version}, workspace=${sourceData.version}`);
  log(`application Sharp: ${target.entry}, version=${target.data.version}`);
  // Dereferencing pnpm also loses sibling JS dependencies, not just @img.
  for (const name of Object.keys(sourceData.dependencies || {})) {
    includeRuntimePackage(name, source, join(dirname(target.manifest), "node_modules"), log);
  }
  for (const name of platformPackages(target.data)) {
    const sourceManifest = resolveRuntimeManifest(name, source);
    const native = JSON.parse(readFileSync(sourceManifest, "utf8"));
    if (native.version !== target.data.optionalDependencies[name]) throw new Error(`Wrong native version for ${name}: ${native.version}`);
    const destination = includeRuntimePackage(name, source, join(dirname(target.manifest), "node_modules"), log);
    const expected = inventory(realpathSync(dirname(sourceManifest)));
    const actual = inventory(destination);
    if (expected.size !== actual.size) throw new Error(`Native file count mismatch: ${name}`);
    for (const [path, info] of expected) {
      if (actual.get(path)?.hash !== info.hash) throw new Error(`Native SHA256 mismatch: ${name}/${path}`);
    }
    log(`verified ${name}@${native.version}: ${actual.size} files, ${[...actual.values()].reduce((n, f) => n + f.bytes, 0)} bytes; all hashes match source`);
  }
  }
}
// Dereferencing pnpm's symlinks leaves each Sharp copy holding a private
// @img tree. Only the two entry points the running app actually loads need
// one: the hoisted node_modules/sharp, and the Turbopack alias under
// .next/node_modules. Copies under .pnpm/ are reachable only through a
// .pnpm symlink, and nothing in the server bundle resolves Sharp that way --
// the route either hits the alias or the hoisted directory.
//
// Each private copy costs ~19 MB of native DLL. Left in place they push the
// tarball from ~20 MB to ~59 MB, so they are removed after supplementation.
// The 0.34.5 copy belongs to Next.js' own image optimizer: it is already
// unusable in this release (its @img was empty before this step), and this
// project never calls next/image, so dropping it changes no reachable path.
export function pruneRedundantSharp(stage, log = console.log) {
  const keep = new Set();
  for (const target of [join(stage, "node_modules", "sharp")]) {
    keep.add(realpathSync(target) + sep);
  }
  const aliases = join(stage, ".next", "node_modules");
  try {
    for (const e of readdirSync(aliases, { withFileTypes: true })) {
      if (!e.name.startsWith("sharp-")) continue;
      if (JSON.parse(readFileSync(join(aliases, e.name, "package.json"), "utf8")).name === "sharp") {
        keep.add(realpathSync(join(aliases, e.name)) + sep);
      }
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }

  const pnpm = join(stage, "node_modules", ".pnpm");
  let removed = 0;
  let freed = 0;
  let entries;
  try { entries = readdirSync(pnpm, { withFileTypes: true }); } catch { entries = []; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const img = join(pnpm, e.name, "node_modules", "@img");
    if (!existsDirectory(img)) continue;
    // Keep it only if the @img lives inside a Sharp tree we still serve.
    let owned = false;
    for (const k of keep) if (realpathSync(join(pnpm, e.name)).startsWith(k)) owned = true;
    if (owned) continue;
    let bytes = 0;
    const walk = (d) => {
      for (const x of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, x.name);
        if (x.isDirectory()) walk(p);
        else if (x.isFile()) bytes += statSync(p).size;
      }
    };
    walk(img);
    rmSync(img, { recursive: true, force: true });
    removed++;
    freed += bytes;
    log(`pruned redundant .pnpm Sharp binding: ${relative(stage, img)} (${(bytes / 1048576).toFixed(1)} MiB)`);
  }
  if (removed) log(`pruned ${removed} redundant Sharp binding tree(s), freed ${(freed / 1048576).toFixed(1)} MiB`);
  return { removed, freed };
}

function existsDirectory(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// Guard against a repeat of the 15x regression. The native binding is ~19 MiB
// per copy and ships uncompressed inside the tarball, so a stray extra copy is
// immediately visible in the artifact. Two copies is the known-good ceiling:
// the hoisted node_modules/sharp and the Turbopack alias. If more survive, the
// prune stopped matching and packaging should fail loudly rather than ship a
// 59 MB artifact that looks fine.
const MAX_SHARP_BINDING_COPIES = 2;
const MAX_SHARP_BINDING_BYTES = 45 * 1024 * 1024;

export function assertSharpRuntimeBounded(stage, log = console.log) {
  const nm = join(stage, "node_modules");
  const copies = [];
  const walk = (d, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(d, e.name);
      if (e.name === "@img") {
        let bytes = 0;
        const size = (dir) => {
          for (const x of readdirSync(dir, { withFileTypes: true })) {
            const q = join(dir, x.name);
            if (x.isDirectory()) size(q);
            else if (x.isFile()) bytes += statSync(q).size;
          }
        };
        size(p);
        if (bytes > 1024 * 1024) copies.push({ path: p, bytes });
        continue;
      }
      walk(p, depth + 1);
    }
  };
  walk(nm, 0);
  const total = copies.reduce((n, c) => n + c.bytes, 0);
  for (const c of copies) {
    log(`sharp binding in release: ${relative(stage, c.path)} (${(c.bytes / 1048576).toFixed(1)} MiB)`);
  }
  log(`sharp binding total: ${copies.length} tree(s), ${(total / 1048576).toFixed(1)} MiB`);
  if (copies.length > MAX_SHARP_BINDING_COPIES) {
    throw new Error(
      `Sharp binding leaked into ${copies.length} locations (limit ${MAX_SHARP_BINDING_COPIES}): ` +
      copies.map((c) => relative(stage, c.path)).join(", ")
    );
  }
  if (total > MAX_SHARP_BINDING_BYTES) {
    throw new Error(
      `Sharp binding total ${(total / 1048576).toFixed(1)} MiB exceeds the ` +
      `${(MAX_SHARP_BINDING_BYTES / 1048576).toFixed(0)} MiB ceiling; packaging would ship a bloated artifact`
    );
  }
}

export async function verifySharp(stage, log = console.log) {
  const root = realpathSync(stage);
  const { entry, manifest, data } = applicationSharp(root);
  log(`Sharp application preflight: ${entry}, version=${data.version}`);
  for (const name of platformPackages(data)) {
    const p = resolveRuntimeManifest(name, manifest);
    inside(root, p);
    if (JSON.parse(readFileSync(p, "utf8")).version !== data.optionalDependencies[name]) throw new Error(`Native version mismatch: ${p}`);
    log(`Sharp platform dependency: ${p}`);
  }
  const env = { ...process.env };
  delete env.NODE_PATH;
  const probe = spawnSync(process.execPath, ["-e", "const s=require(process.argv[1]);s({create:{width:2,height:2,channels:3,background:'red'}}).webp().toBuffer().then(b=>console.log(JSON.stringify({sharp:s.versions.sharp,vips:s.versions.vips,bytes:b.length}))).catch(e=>{console.error(e);process.exit(1)})", entry], { cwd: root, env, encoding: "utf8", timeout: 30000 });
  const diagnostics = JSON.stringify({ status: probe.status, signal: probe.signal, error: probe.error?.message, stdout: probe.stdout, stderr: probe.stderr });
  log(`Sharp probe result: ${diagnostics}`);
  if (probe.status !== 0) throw new Error(`Sharp native probe failed: ${diagnostics}`);
}
