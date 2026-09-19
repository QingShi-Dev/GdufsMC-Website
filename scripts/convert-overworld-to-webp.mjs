// scripts/convert-overworld-to-webp.mjs
// 把 public/images/maps/20260907/overworld/*.png 全部转成 WebP lossless
// 输出: 同目录 .webp 文件. 原 PNG 保留 (作为 backup, deploy 不删).
//
// 用法: node scripts/convert-overworld-to-webp.mjs [--delete-png]

import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
const DELETE_PNG = args.has('--delete-png')

const dir = 'public/images/maps/20260907/overworld'
const entries = await fs.readdir(dir)
const pngs = entries.filter((f) => f.endsWith('.png')).sort()

if (pngs.length === 0) {
  console.log('No PNG files found.')
  process.exit(0)
}

console.log(`Converting ${pngs.length} PNG → WebP lossless in ${dir}`)
console.log(`Source PNG will be ${DELETE_PNG ? 'DELETED' : 'KEPT'}\n`)

let totalOrig = 0
let totalWebp = 0
const failures = []

for (const name of pngs) {
  const src = path.join(dir, name)
  const base = name.replace(/\.png$/i, '')
  const dst = path.join(dir, `${base}.webp`)

  try {
    await sharp(src).webp({ lossless: true, effort: 6 }).toFile(dst)
    const origSize = (await fs.stat(src)).size
    const webpSize = (await fs.stat(dst)).size
    totalOrig += origSize
    totalWebp += webpSize

    if (DELETE_PNG) {
      await fs.unlink(src)
    }
  } catch (e) {
    failures.push({ name, error: String(e) })
  }
}

console.log(`\nDone: ${pngs.length - failures.length}/${pngs.length}`)
console.log(`Total: ${(totalOrig / 1024 / 1024).toFixed(1)} MB → ${(totalWebp / 1024 / 1024).toFixed(1)} MB`)
console.log(`Saved: ${((totalOrig - totalWebp) / 1024 / 1024).toFixed(1)} MB (${(((totalWebp - totalOrig) / totalOrig) * 100).toFixed(0)}%)`)

if (failures.length) {
  console.log(`\nFailures (${failures.length}):`)
  for (const f of failures) console.log(`  ${f.name}: ${f.error}`)
}