import { existsSync, createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { packTar } from "modern-tar/fs";

export async function createReleaseArchive({ stage, output, log = () => {} }) {
  const pending = output + ".partial";
  for (const path of [output, pending]) {
    if (existsSync(path)) throw new Error("Archive destination already exists: " + path);
  }
  try {
    await pipeline(packTar(stage, {
      map: (header) => ({ ...header, pax: { ...header.pax, path: header.name } }),
    }), createGzip(), createWriteStream(pending, { flags: "wx" }));
    await rename(pending, output);
    log("archive completed using modern-tar and Node.js zlib");
  } finally {
    await rm(pending, { force: true });
  }
}
