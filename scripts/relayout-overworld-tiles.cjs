// Relayout overworld tiles: move 6-tile block + 2 single tiles into the
// bottom-right reserved 8-cell area (cols 12-13, rows 9-12).
// 6-tile block goes to the bottom 3 rows (10-12), 2 singles go to top row (9).
// After: 13 cols × 6 rows = 78 cells, fully filled (no gaps).
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'images', 'maps', '20260907', 'overworld');

// 坐标公式: x = 1024*col - 6144,  z = 1024*row - 10240
function newName(col, row) {
  const x = 1024 * col - 6144;
  const z = 1024 * row - 10240;
  return `${col}_${row}_x${x}_z${z}.png`;
}

// 6-tile block: (c=20-21, r=3-5) → (c=12-13, r=10-12)
// 保序: (col 20→12, col 21→13), (row 3→10, 4→11, 5→12)
const block6 = [
  { from: '20_3_x14336_z-7168.png', toCol: 12, toRow: 10 },
  { from: '21_3_x15360_z-7168.png', toCol: 13, toRow: 10 },
  { from: '20_4_x14336_z-6144.png', toCol: 12, toRow: 11 },
  { from: '21_4_x15360_z-6144.png', toCol: 13, toRow: 11 },
  { from: '20_5_x14336_z-5120.png', toCol: 12, toRow: 12 },
  { from: '21_5_x15360_z-5120.png', toCol: 13, toRow: 12 },
];

// 2 single tiles → row 9 (top of the reserved area)
// 左→左: (c=5, r=4) → (c=12, r=9)  (原 c=5 在网格左侧, 保持左)
// 右→右: (c=37, r=1) → (c=13, r=9) (原 c=37 在网格右侧, 保持右)
const singles = [
  { from: '5_4_x-1024_z-6144.png', toCol: 12, toRow: 9 },
  { from: '37_1_x31744_z-9216.png', toCol: 13, toRow: 9 },
];

const moves = [
  ...block6.map((m) => ({ from: m.from, to: newName(m.toCol, m.toRow), label: '6-block' })),
  ...singles.map((m) => ({ from: m.from, to: newName(m.toCol, m.toRow), label: 'single' })),
];

// 1. Dry-run check: 所有源文件存在, 目标文件不存在
console.log('=== Pre-flight check ===');
let ok = true;
for (const m of moves) {
  const src = path.join(dir, m.from);
  const dst = path.join(dir, m.to);
  if (!fs.existsSync(src)) {
    console.log(`  ✗ MISSING: ${m.from}`);
    ok = false;
  }
  if (fs.existsSync(dst)) {
    console.log(`  ✗ TARGET EXISTS (would overwrite): ${m.to}`);
    ok = false;
  }
}
if (!ok) {
  console.log('\nAborted. Fix issues above.');
  process.exit(1);
}
console.log('  ✓ all 8 source files exist, no target collisions');

// 2. 用临时名二阶段 rename, 避免半路失败留下脏状态
//    先全部 src → tmp, 再全部 tmp → dst
const tmpNames = moves.map((m) => `__tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${m.from}`);
console.log('\n=== Phase 1: src → tmp ===');
for (let i = 0; i < moves.length; i++) {
  const src = path.join(dir, moves[i].from);
  const tmp = path.join(dir, tmpNames[i]);
  fs.renameSync(src, tmp);
  console.log(`  ${moves[i].from}  →  ${tmpNames[i]}`);
}

console.log('\n=== Phase 2: tmp → dst ===');
for (let i = 0; i < moves.length; i++) {
  const tmp = path.join(dir, tmpNames[i]);
  const dst = path.join(dir, moves[i].to);
  fs.renameSync(tmp, dst);
  console.log(`  ${tmpNames[i]}  →  ${moves[i].to}  [${moves[i].label}]`);
}

console.log('\n=== Done. 8 files moved. ===');
