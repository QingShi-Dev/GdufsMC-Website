import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Usage: node scripts/patch-cms.mjs <isolated-sveltia-source>");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const target = join(root, "src/lib/services/assets/process.js");
let source = readFileSync(target, "utf8");
if (JSON.parse(readFileSync(join(root, "package.json"))).version !== "0.227.0") throw new Error("Wrong CMS version");
if (sha256(readFileSync(join(root, "pnpm-lock.yaml"))) !== "0eafd2a8a2d214d84b42f682370d8dd42ac3cf8bfedfebc787e5754c4ca97b25") throw new Error("Upstream lockfile changed");
const marker = "// GDUFSMC_IMAGE_API_V1";
if (!source.includes(marker)) {
  if (sha256(source) !== "69adebf79ac59b3890b85de65f94b3f3927a9bb92e835754cc41621d5e159d80") throw new Error("Upstream process.js changed; review patch before upgrading");
  const start = source.indexOf("  if (transformations) {", source.indexOf("const preTransformFile = file;"));
  const end = source.indexOf("\n  return {", start);
  if (start < 0 || end < 0) throw new Error("Patch anchor missing");
  // Deliberately replace browser transformations; server owns JPEG/PNG rules.
  source = source.slice(0, start) + "  try {\n    file = await convertImage(file);\n  } catch (error) {\n    console.error('Image conversion blocked', error);\n    return { file, originalFile: undefined, oversized: false, invalid: true };\n  }\n" + source.slice(end);
  // Never offer the upstream UI's revert-to-original action for server conversions.
  source = source.replace("const preTransformFile = file;", "// Server conversion is mandatory for JPEG/PNG.");
  source = source.replace("originalFile: file !== preTransformFile ? preTransformFile : undefined,", "originalFile: undefined,");
  source = `${marker}\nimport { convertImage } from './gdufsmc-image-converter.mjs';\n` + source;
  source = source.replace("canConvertHEIC, transformFile", "canConvertHEIC");
  writeFileSync(target, source);
}
copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "cms-image-converter.mjs"), join(dirname(target), "gdufsmc-image-converter.mjs"));
console.log("Patched Sveltia 0.227.0 (38d382dfc6b2c7ec471f6724f42c889df91396ae). Production admin unchanged.");
