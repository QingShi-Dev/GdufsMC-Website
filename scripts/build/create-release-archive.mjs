import { existsSync, createReadStream, createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

export function archiveCommands(platform = process.platform, env = process.env) {
  if (platform !== "win32") return ["tar"];
  // Never pick an unrelated tar.exe from PATH on Windows.
  return [...new Set([
    join(env.SystemRoot || "C:/Windows", "System32", "tar.exe"),
    join(env.ProgramFiles || "C:/Program Files", "Git", "usr", "bin", "tar.exe"),
  ])];
}

export async function createReleaseArchive({ root, stage, output, log = () => {},
  commands = archiveCommands(), run = spawnSync }) {
  const raw = output + ".uncompressed.tar";
  const pending = output + ".partial";
  // Refuse to overwrite a previous artifact or another invocation's files.
  for (const path of [output, raw, pending]) {
    if (existsSync(path)) throw new Error("Archive destination already exists: " + path);
  }
  try {
    let archived = false;
    for (const command of commands) {
      if (process.platform === "win32" && !existsSync(command)) {
        log("archive executable missing: " + command);
        continue;
      }
      log("archive executable: " + command);
      const version = run(command, ["--version"], { cwd: root, encoding: "utf8" });
      const versionText = (version.stdout || version.stderr || "unknown").trim();
      log("archive version: " + versionText);
      // PAX stores Unicode names in UTF-8 rather than an ambient Windows
      // code page. The runner's BSD tar crashes with hdrcharset=... here.
      const formatArgs = ["--format=pax"];
      // Avoid tar's native gzip subprocess/DLL path. Node compresses the tar
      // stream separately; both BSD tar and GNU tar can extract the result.
      const result = run(command, ["-cf", relative(root, raw), ...formatArgs, "-C", relative(root, stage), "."],
        { cwd: root, encoding: "utf8", windowsHide: true });
      log("archive result: " + JSON.stringify({ status: result.status, signal: result.signal,
        error: result.error?.message, stderr: result.stderr }));
      if (!result.error && result.status === 0 && existsSync(raw)) {
        archived = true;
        break;
      }
      await rm(raw, { force: true });
    }
    if (!archived) throw new Error("All release tar executables failed; see archive diagnostics above");
    await pipeline(createReadStream(raw), createGzip(), createWriteStream(pending, { flags: "wx" }));
    await rename(pending, output);
    log("archive gzip completed using Node.js zlib");
  } finally {
    await rm(raw, { force: true });
    await rm(pending, { force: true });
  }
}
