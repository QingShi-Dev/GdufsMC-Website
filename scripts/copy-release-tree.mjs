import { copyFileSync, mkdirSync, readdirSync, realpathSync, lstatSync, readlinkSync } from "node:fs";
import { join, relative, isAbsolute, resolve, dirname, sep } from "node:path";

// Inspect a link without asking stat/realpath to follow it first. In particular,
// Windows may reject traversal of a relative directory link created by tracing.
// Reading its target lets us access that target directly instead.
function resolveCopySource(source, log) {
  let current = resolve(source);
  const seen = new Set();
  for (let hops = 0; hops < 128; hops++) {
    const key = process.platform === "win32" ? current.toLowerCase() : current;
    if (seen.has(key)) throw new Error(`Link chain cycle: ${source} -> ${current}`);
    seen.add(key);
    const info = lstatSync(current);
    if (!info.isSymbolicLink()) {
      // Native canonicalization also handles junctions in ancestor components.
      return { real: realpathSync.native(current), info };
    }
    const target = readlinkSync(current);
    const resolved = resolve(dirname(current), target);
    log(`resolve link source=${current} target=${target} resolved=${resolved}`);
    current = resolved;
  }
  throw new Error(`Link chain exceeds 128 hops: ${source}`);
}

// Materialize links as ordinary files/directories without fs.cpSync's recursive
// implementation. An ancestor set detects cycles but allows shared dependencies.
export function copyReleaseTree(source, destination, log = () => {}) {
  const pending = [{ source, destination, ancestors: new Set() }];
  let entries = 0;
  let bytes = 0;
  while (pending.length) {
    const item = pending.pop();
    entries++;
    if (entries > 200000) throw new Error("Release copy exceeded 200000 entries; inspect link expansion");
    // Log BEFORE each filesystem operation: even a native crash leaves its path.
    log(`copy entry=${entries} source=${item.source} destination=${item.destination}`);
    try {
      const { real, info } = resolveCopySource(item.source, log);
      const key = process.platform === "win32" ? real.toLowerCase() : real;
      if (info.isDirectory()) {
        if (item.ancestors.has(key)) throw new Error(`Directory link cycle at ${item.source} -> ${real}`);
        if (item.ancestors.size >= 128) throw new Error(`Release copy depth exceeded at ${item.source}`);
        const destRelative = relative(real, destination);
        if (!destRelative || (destRelative !== ".." && !destRelative.startsWith(".." + sep) && !isAbsolute(destRelative))) {
          throw new Error(`Source directory contains copy destination: ${real}`);
        }
        mkdirSync(item.destination, { recursive: true });
        const ancestors = new Set(item.ancestors).add(key);
        for (const name of readdirSync(real).sort().reverse()) {
          pending.push({ source: join(real, name), destination: join(item.destination, name), ancestors });
        }
      } else if (info.isFile()) {
        bytes += info.size;
        if (bytes > 8 * 1024 ** 3) throw new Error("Release copy exceeded 8 GiB; inspect link expansion");
        copyFileSync(real, item.destination);
      } else {
        throw new Error(`Unsupported filesystem entry: ${real}`);
      }
    } catch (error) {
      throw new Error(`Copy failed: ${item.source} -> ${item.destination}: ${error.message}`, { cause: error });
    }
  }
  log(`copy complete: entries=${entries} bytes=${bytes}`);
  return { entries, bytes };
}
