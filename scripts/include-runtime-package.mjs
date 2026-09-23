import { createRequire } from "node:module";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { copyReleaseTree } from "./copy-release-tree.mjs";

export function resolveRuntimeManifest(name, fromManifest) {
  const req = createRequire(fromManifest);
  try { return req.resolve(`${name}/package.json`); }
  catch (error) {
    if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    let dir = dirname(req.resolve(name));
    while (true) {
      const candidate = join(dir, "package.json");
      if (existsSync(candidate) && JSON.parse(readFileSync(candidate, "utf8")).name === name) return candidate;
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`Cannot locate manifest for ${name}`);
      dir = parent;
    }
  }
}

// Include an exact installed package and its declared production dependencies.
// Resolve from the requiring package, never install or select a new version.
export function includeRuntimePackage(name, fromManifest, targetModules, log = () => {}, ancestors = new Set()) {
  const manifestPath = resolveRuntimeManifest(name, fromManifest);
  if (ancestors.has(manifestPath)) throw new Error(`Runtime dependency cycle: ${manifestPath}`);
  if (ancestors.size >= 32) throw new Error("Runtime dependency depth exceeds 32");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const destination = join(targetModules, ...name.split("/"));
  mkdirSync(dirname(destination), { recursive: true });
  log(`include runtime package ${name}@${manifest.version} from ${manifestPath}`);
  copyReleaseTree(dirname(manifestPath), destination, log);
  const nextAncestors = new Set(ancestors).add(manifestPath);
  for (const dependency of Object.keys(manifest.dependencies || {})) {
    includeRuntimePackage(dependency, manifestPath, join(destination, "node_modules"), log, nextAncestors);
  }
  return destination;
}
