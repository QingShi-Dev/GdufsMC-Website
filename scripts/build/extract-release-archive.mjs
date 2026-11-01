import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createTarDecoder } from "modern-tar";
import { unpackTar } from "modern-tar/fs";

function assertEntry(header, destination) {
  if (header.type !== "file" && header.type !== "directory") {
    throw new Error("Release archive contains a link or special entry: " + header.name);
  }
  const name = header.name?.replace(/^(?:\.\/)+/, "");
  if ((name === "" || name === ".") && header.type === "directory") return null;
  if (!name || name.startsWith("/") || name.includes("\\") || /[\x00-\x1f:<>"|?*]/.test(name)) {
    throw new Error("Unsafe release archive entry: " + name);
  }
  const parts = name.replace(/\/$/, "").split("/");
  for (const part of parts) {
    if (!part || part === "." || part === ".." || /[. ]$/.test(part) ||
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)) {
      throw new Error("Unsafe release archive entry: " + name);
    }
  }
  const full = resolve(destination, ...parts);
  const rel = relative(destination, full);
  if (!rel || rel === ".." || rel.startsWith(".." + sep)) {
    throw new Error("Release archive entry escapes destination: " + name);
  }
  return rel.toLowerCase();
}

export async function extractReleaseArchive(archive, destination) {
  const target = resolve(destination);
  if (existsSync(target)) throw new Error("Release destination already exists: " + target);

  const source = createReadStream(archive);
  const gunzip = createGunzip();
  const decoded = Readable.toWeb(source.pipe(gunzip))
    .pipeThrough(createTarDecoder({ strict: true }));
  let count = 0;
  const paths = new Set();
  try {
    for await (const entry of decoded) {
      const path = assertEntry(entry.header, target);
      if (path) {
        if (paths.has(path)) throw new Error("Duplicate release archive entry: " + entry.header.name);
        paths.add(path);
        count++;
      }
      await entry.body.cancel();
    }
  } finally {
    source.destroy();
    gunzip.destroy();
    if (!source.closed) await new Promise((resolve) => source.once("close", resolve));
  }
  if (count === 0) throw new Error("Release archive is empty");

  await mkdir(target);
  try {
    await pipeline(createReadStream(archive), createGunzip(), unpackTar(target));
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node extract.mjs <archive.tar.gz> <destination>");
    await extractReleaseArchive(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error("release-extractor: " + error.message);
    process.exitCode = 1;
  }
}
