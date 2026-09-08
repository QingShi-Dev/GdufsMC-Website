// Analyze all test folders to detect coordinate origins and dimensions
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'test');
const folders = fs.readdirSync(dir)
  .filter((f) => fs.statSync(path.join(dir, f)).isDirectory())
  .sort();

const RE = /^(\d+)_(\d+)_x(-?\d+)_z(-?\d+)\.png$/;

for (const folder of folders) {
  const fp = path.join(dir, folder);
  const files = fs.readdirSync(fp).filter((f) => f.endsWith('.png'));
  if (files.length === 0) continue;

  const cols = [], rows = [], xs = [], zs = [];
  for (const f of files) {
    const m = f.match(RE);
    if (!m) continue;
    cols.push(+m[1]); rows.push(+m[2]); xs.push(+m[3]); zs.push(+m[4]);
  }
  if (cols.length === 0) {
    console.log(folder, '| no matching files');
    continue;
  }

  const cMin = Math.min(...cols), cMax = Math.max(...cols);
  const rMin = Math.min(...rows), rMax = Math.max(...rows);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const zMin = Math.min(...zs), zMax = Math.max(...zs);

  // Detect x/z origin by looking at col=0 / row=0 if they exist
  const col0 = files.find((f) => f.startsWith('0_'));
  let xAtCol0 = '?', zAtRow0 = '?';
  if (col0) {
    const m = col0.match(RE);
    if (m) { xAtCol0 = m[3]; zAtRow0 = m[4]; }
  }
  // Find x when col = cMin (leftmost)
  const leftmostFile = files.find((f) => {
    const m = f.match(RE);
    return m && +m[1] === cMin;
  });
  let xAtLeft = '?';
  if (leftmostFile) {
    const m = leftmostFile.match(RE);
    if (m) xAtLeft = m[3];
  }
  // Find z when row = rMin (topmost)
  const topmostFile = files.find((f) => {
    const m = f.match(RE);
    return m && +m[2] === rMin;
  });
  let zAtTop = '?';
  if (topmostFile) {
    const m = topmostFile.match(RE);
    if (m) zAtTop = m[4];
  }

  console.log(
    `${folder} | files=${files.length.toString().padStart(3)}`,
    `| col ${cMin}-${cMax} (${(cMax - cMin + 1).toString().padStart(2)})`,
    `row ${rMin}-${rMax} (${(rMax - rMin + 1).toString().padStart(2)})`,
    `| x [${xMin}, ${xMax}] z [${zMin}, ${zMax}]`,
    `| leftmost col=${cMin} → x=${xAtLeft}, topmost row=${rMin} → z=${zAtTop}`,
  );
}
