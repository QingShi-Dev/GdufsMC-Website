// Convert PNGs in public/images/tutorial to WebP (q=95, same resolution)
// Replaces same-named .webp files in the same folder.
// Usage: node scripts/png-to-webp-q95.cjs
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const TUTORIAL_DIR = path.join(__dirname, '..', 'public', 'images', 'tutorial');

(async () => {
  if (!fs.existsSync(TUTORIAL_DIR)) {
    console.error('Folder not found:', TUTORIAL_DIR);
    process.exit(1);
  }

  const pngs = fs
    .readdirSync(TUTORIAL_DIR)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort();

  if (pngs.length === 0) {
    console.log('No PNG files found in', TUTORIAL_DIR);
    return;
  }

  console.log(`Found ${pngs.length} PNG file(s) in ${TUTORIAL_DIR}`);

  const results = [];
  for (const pngName of pngs) {
    const pngPath = path.join(TUTORIAL_DIR, pngName);
    const baseName = path.basename(pngName, path.extname(pngName));
    const webpName = `${baseName}.webp`;
    const webpPath = path.join(TUTORIAL_DIR, webpName);

    try {
      const inputMeta = await sharp(pngPath).metadata();
      const pngSize = fs.statSync(pngPath).size;

      const buf = await sharp(pngPath).webp({ quality: 95 }).toBuffer();
      fs.writeFileSync(webpPath, buf);

      const outMeta = await sharp(buf).metadata();
      const webpSize = fs.statSync(webpPath).size;

      results.push({
        png: pngName,
        webp: webpName,
        pngSize,
        webpSize,
        pngRes: `${inputMeta.width}x${inputMeta.height}`,
        webpRes: `${outMeta.width}x${outMeta.height}`,
        sameRes:
          inputMeta.width === outMeta.width &&
          inputMeta.height === outMeta.height,
      });

      console.log(
        `  ${pngName} (${inputMeta.width}x${inputMeta.height}, ${pngSize} B) -> ${webpName} (${outMeta.width}x${outMeta.height}, ${webpSize} B)`,
      );
    } catch (err) {
      console.error(`  Failed: ${pngName} -> ${webpName}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log('\nSummary:');
  console.table(
    results.map((r) => ({
      png: r.png,
      webp: r.webp,
      pngRes: r.pngRes,
      webpRes: r.webpRes,
      sameRes: r.sameRes,
      pngKB: (r.pngSize / 1024).toFixed(1),
      webpKB: (r.webpSize / 1024).toFixed(1),
      ratio: (r.webpSize / r.pngSize).toFixed(2),
    })),
  );
})();
