import {readFileSync,readdirSync} from "node:fs";
import {resolve,join,relative} from "node:path";
import {createHash} from "node:crypto";
const root=resolve(process.argv[2]||"public/admin/vendor/sveltia-0.227.0");
const manifest=JSON.parse(readFileSync(join(root,"manifest.json"),"utf8"));
if(manifest.version!=="0.227.0"||manifest.commit!=="38d382dfc6b2c7ec471f6724f42c889df91396ae")throw Error("CMS provenance mismatch");
for(const p of ["dist/sveltia-cms.js","dist/chunks/react-dom.js","locales/en-US.json","LICENSE.txt"])if(!manifest.files[p])throw Error(`Required CMS file missing: ${p}`);
for(const [p,hash] of Object.entries(manifest.files)){
 if(p.startsWith("/")||p.includes("..")||p.includes("\\")||p.includes(":"))throw Error("Invalid manifest path");
 if(createHash("sha256").update(readFileSync(join(root,p))).digest("hex")!==hash)throw Error(`CMS hash mismatch: ${p}`);
}
function scan(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())scan(p);else{const name=relative(root,p).replaceAll("\\","/");if(name!=="manifest.json"&&!manifest.files[name])throw Error(`Unlisted CMS file: ${name}`);}}}
scan(root);
if(!readFileSync(join(root,"dist/sveltia-cms.js"),"utf8").includes("/api/admin/image-convert"))throw Error("Missing API patch");
console.log(`CMS verified: ${Object.keys(manifest.files).length} files`);
