// Verify the auto-detect origin logic against real data
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'test');
const folders = fs.readdirSync(dir)
  .filter((f) => fs.statSync(path.join(dir, f)).isDirectory())
  .sort();

const RE = /^(\d+)_(\d+)_x(-?\d+)_z(-?\d+)\.png$/;

function detectOrigin(tiles, pickBy, valueOf) {
  if (tiles.length === 0) return { step: 1024, origin: 0, hasZero: false };
  const diffs = [];
  const byIndex = new Map();
  for (const t of tiles) byIndex.set(pickBy(t), t);
  const idxs = [...byIndex.keys()].sort((a, b) => a - b);
  for (let i = 1; i < idxs.length; i++) {
    const a = idxs[i - 1], b = idxs[i];
    if (a === undefined || b === undefined) continue;
    const ta = byIndex.get(a), tb = byIndex.get(b);
    if (!ta || !tb) continue;
    diffs.push(valueOf(tb) - valueOf(ta));
  }
  const freq = new Map();
  for (const d of diffs) {
    const k = Math.abs(d);
    if (k > 0 && k < 100000) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const step = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1024;
  const zeroTile = byIndex.get(0);
  if (zeroTile) return { step, origin: valueOf(zeroTile), hasZero: true };
  const minIdx = idxs[0];
  if (minIdx === undefined) return { step: 1024, origin: 0, hasZero: false };
  const minTile = byIndex.get(minIdx);
  if (!minTile) return { step: 1024, origin: 0, hasZero: false };
  return { step, origin: valueOf(minTile) - minIdx * step, hasZero: false };
}

for (const folder of folders) {
  const fp = path.join(dir, folder);
  const files = fs.readdirSync(fp).filter((f) => f.endsWith('.png'));
  const tiles = [];
  for (const f of files) {
    const m = f.match(RE);
    if (m) tiles.push({ col: +m[1], row: +m[2], x: +m[3], z: +m[4] });
  }
  if (tiles.length === 0) continue;
  const xAxis = detectOrigin(tiles, (t) => t.col, (t) => t.x);
  const zAxis = detectOrigin(tiles, (t) => t.row, (t) => t.z);
  // Sanity check: 已知 ground truth
  console.log(
    `${folder} | tiles=${tiles.length}`,
    `| x: step=${xAxis.step} origin=${xAxis.origin}${xAxis.hasZero ? '' : ' (外推)'}`,
    `| z: step=${zAxis.step} origin=${zAxis.origin}${zAxis.hasZero ? '' : ' (外推)'}`,
  );
}
