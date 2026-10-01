import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createImageConverter } from "./cms-image-converter.mjs";
if (!process.argv[2]) throw Error("Pass patched CMS source directory");
const source = readFileSync(resolve(process.argv[2], "src/lib/services/assets/process.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replaceAll("export const ", "const ");
const context = vm.createContext({
  File, console, Uint8Array, hasCachedThumbnail: async () => false,
  RASTER_IMAGE_TYPES: ["image/png"], sniffRasterImageFormat: async () => "png",
  getGitHash: async () => "hash", isValidImage: async () => true,
  canConvertHEIC: () => false, formatFileName: (n) => n,
  convertImage: createImageConverter({fetchImpl: async () => new Response("RIFF0000WEBP", {headers:{"content-type":"image/webp"}})}),
});
vm.runInContext(source + "\nglobalThis.processFile = processFile; globalThis.partition = partitionProcessedFiles;", context);
const file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "original.png", {type:"image/png"});
const result = await context.processFile(file);
assert.equal(result.file.name, "original.webp");
assert.equal(result.originalFile, undefined, "UI must not offer reverting to original");
assert.equal(context.partition([result]).validFiles.length, 1);
context.convertImage = async () => { throw Error("simulated 401"); };
const blocked = await context.processFile(file);
assert.equal(blocked.invalid, true);
assert.equal(context.partition([blocked]).validFiles.length, 0);
console.log("PASS: actual patched processFile returns WebP, disables original fallback, and excludes API failures from validFiles (imports stubbed; not browser E2E).");
