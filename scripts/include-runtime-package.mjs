import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { copyReleaseTree } from "./copy-release-tree.mjs";

// Include an exact installed package and its declared production dependencies.
// Resolve from the requiring package, never install or select a new version.
export function includeRuntimePackage(name, fromManifest, targetModules, log = () => {}, ancestors = new Set()) {
  const sourceRequire = createRequire(fromManifest);
  const manifestPath = sourceRequire.resolve(`${name}/package.json`);
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
