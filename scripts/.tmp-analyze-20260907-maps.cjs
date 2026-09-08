// Analyze 20260907 map directory structure
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public', 'images', 'maps', '20260907');
const RE = /^(\d+)_(\d+)_x(-?\d+)_z(-?\d+)\.png$/;

for (const dim of ['overworld', 'nether', 'end']) {
  const dir = path.join(root, dim);
  if (!fs.existsSync(dir)) {
    console.log(`[${dim}] directory not found`);
    continue;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  if (files.length === 0) {
    console.log(`[${dim}] no tiles`);
    continue;
  }
  const cols = [], rows = [], xs = [], zs = [];
  for (const f of files) {
    const m = f.match(RE);
    if (m) {
      cols.push(+m[1]); rows.push(+m[2]); xs.push(+m[3]); zs.push(+m[4]);
    }
  }
  const cMin = Math.min(...cols), cMax = Math.max(...cols);
  const rMin = Math.min(...rows), rMax = Math.max(...rows);
  // 1 tile = 1024 block; 网格尺寸 = (cMax-cMin+1) * 1024
  const vbW = (cMax - cMin + 1) * 1024;
  const vbH = (rMax - rMin + 1) * 1024;
  console.log(
    `[${dim}] tiles=${files.length} | col ${cMin}-${cMax} (${cMax - cMin + 1}) | row ${rMin}-${rMax} (${rMax - rMin + 1})`,
    `| viewBox ${vbW}×${vbH} (ratio ${(vbW / vbH).toFixed(2)})`,
    `| x [${Math.min(...xs)}, ${Math.max(...xs)}] z [${Math.min(...zs)}, ${Math.max(...zs)}]`,
  );
}
