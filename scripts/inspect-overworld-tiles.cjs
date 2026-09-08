// Inspect overworld tiles to understand the layout
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'images', 'maps', '20260907', 'overworld');
const RE = /^(\d+)_(\d+)_x(-?\d+)_z(-?\d+)\.png$/;

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
const tiles = [];
for (const f of files) {
  const m = f.match(RE);
  if (m) tiles.push({ col: +m[1], row: +m[2], x: +m[3], z: +m[4], name: f });
}
tiles.sort((a, b) => a.row - b.row || a.col - b.col);

const cMin = Math.min(...tiles.map(t => t.col));
const cMax = Math.max(...tiles.map(t => t.col));
const rMin = Math.min(...tiles.map(t => t.row));
const rMax = Math.max(...tiles.map(t => t.row));

// Build a grid map
const grid = new Map();
for (const t of tiles) grid.set(`${t.col},${t.row}`, t);

console.log(`Overworld: col ${cMin}-${cMax} (${cMax - cMin + 1}), row ${rMin}-${rMax} (${rMax - rMin + 1})`);
console.log(`Total tiles: ${tiles.length}, grid cells: ${(cMax - cMin + 1) * (rMax - rMin + 1)}, missing: ${(cMax - cMin + 1) * (rMax - rMin + 1) - tiles.length}`);
console.log();

// Print grid as ASCII (col on x, row on y, with row 12 at top, row 1 at bottom to match screen orientation)
console.log('Grid (col horizontal, row vertical; R=has data, .=empty):');
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
console.log();

// Find bottom-right 8-cell region
console.log('=== Bottom-right area (last 2 rows, last 4 cols) ===');
for (let r = rMin; r <= rMax; r++) {
  for (let c = cMin; c <= cMax; c++) {
    if (r > rMax - 2 && c > cMax - 4) {
      const t = grid.get(`${c},${r}`);
      const x = -5632 + (c - 1) * 1024; // using col1=x-5632 mapping
      const z = -3072 + (r - 1) * 1024; // using row1=z-3072 mapping (old convention)
      console.log(`  (c=${c}, r=${r}) x=${x} z=${z} ${t ? '✓ ' + t.name : '✗ empty'}`);
    }
  }
}
