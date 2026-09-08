// Verify the overworld grid after relayout
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'images', 'maps', '20260907', 'overworld');
const RE = /^(\d+)_(\d+)_x(-?\d+)_z(-?\d+)\.png$/;

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png') && !f.startsWith('__tmp_'));
const tiles = [];
for (const f of files) {
  const m = f.match(RE);
  if (m) tiles.push({ col: +m[1], row: +m[2], x: +m[3], z: +m[4] });
}

const cMin = Math.min(...tiles.map(t => t.col));
const cMax = Math.max(...tiles.map(t => t.col));
const rMin = Math.min(...tiles.map(t => t.row));
const rMax = Math.max(...tiles.map(t => t.row));

console.log(`Overworld: col ${cMin}-${cMax} (${cMax - cMin + 1}), row ${rMin}-${rMax} (${rMax - rMin + 1})`);
console.log(`Total tiles: ${tiles.length}, grid cells: ${(cMax - cMin + 1) * (rMax - rMin + 1)}, missing: ${(cMax - cMin + 1) * (rMax - rMin + 1) - tiles.length}`);
console.log();

const grid = new Map();
for (const t of tiles) grid.set(`${t.col},${t.row}`, t);

console.log('Grid (col horizontal, row vertical; row 6 at top, row 12 at bottom):');
let header = '     ';
for (let c = cMin; c <= cMax; c++) header += 'c' + String(c).padStart(2, ' ') + ' ';
console.log(header);
for (let r = rMax; r >= rMin; r--) {
  let line = 'r' + String(r).padStart(2, ' ') + ' ';
  for (let c = cMin; c <= cMax; c++) {
    const t = grid.get(`${c},${r}`);
    line += t ? ' R  ' : ' .  ';
  }
  console.log(line);
}
