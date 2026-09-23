import { copyFileSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";

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
      const real = realpathSync(item.source);
      const key = process.platform === "win32" ? real.toLowerCase() : real;
      const info = statSync(real);
      if (info.isDirectory()) {
        if (item.ancestors.has(key)) throw new Error(`Directory link cycle at ${item.source} -> ${real}`);
        if (item.ancestors.size >= 128) throw new Error(`Release copy depth exceeded at ${item.source}`);
        const destRelative = relative(real, destination);
        if (!destRelative || (!destRelative.startsWith("..") && !isAbsolute(destRelative))) {
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
