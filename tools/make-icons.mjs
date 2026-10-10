// Usage: node tools/make-icons.mjs
// Renders the app icons from the app's own pixel art (src/art/pixel.ts): the gold goal frame with
// the sapling, scaled nearest-neighbour over a darkened dirt block. Writes:
//   public/icons/icon-192.png, icon-512.png       full-bleed square ("any")
//   public/icons/icon-maskable-512.png            badge inside the 80% safe circle
//   public/icons/apple-touch-icon.png (180)       iOS rounds the corners itself
//   public/icons/favicon-32.png                   1:1 badge on transparent, for browsers without SVG icons
//   public/favicon.svg                            the badge as crisp-edged rects
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/icons');
fs.mkdirSync(outDir, { recursive: true });

// pixel.ts as a browser module, with icons.json inlined
const src = fs.readFileSync(path.join(root, 'src/art/pixel.ts'), 'utf8');
const icons = fs.readFileSync(path.join(root, 'src/data/icons.json'), 'utf8');
const js = ts.transpileModule(src.replace(/^import iconsJson from '[^']+';$/m, `const iconsJson = ${icons};`), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false },
}).outputText;

// size, badge scale (one art pixel = k screen pixels), full-bleed background, darkening of the dirt
const SPECS = {
  'icon-192.png': { size: 192, k: 6, bg: true },
  'icon-512.png': { size: 512, k: 16, bg: true },
  // the badge's farthest corner is ~15.3 art pixels from its centre: 15.3 * 13 < 0.4 * 512
  'icon-maskable-512.png': { size: 512, k: 13, bg: true },
  'apple-touch-icon.png': { size: 180, k: 5, bg: true },
  'favicon-32.png': { size: 32, k: 1, bg: false },
};

const exe = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
await page.setContent('<!doctype html><title>icons</title>');
await page.addScriptTag({ type: 'module', content: `${js}\nwindow.__px = { frame, icon, texture };` });
await page.waitForFunction(() => !!window.__px);

const result = await page.evaluate(async specs => {
  const { frame, icon, texture } = window.__px;
  const load = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const [fr, ic, dirt] = await Promise.all([load(frame('goal', 'done')), load(icon('sapling')), load(texture('dirt'))]);

  // the 26x26 badge as on the tree: frame, icon inset by 5 art pixels
  const badge = document.createElement('canvas');
  badge.width = badge.height = 26;
  const bg = badge.getContext('2d');
  bg.drawImage(fr, 0, 0);
  bg.drawImage(ic, 5, 5);

  const out = {};
  for (const [name, { size, k, bg: full }] of Object.entries(specs)) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (full) {
      // dirt at the badge's pixel size, centred, then darkened like the app's backdrop
      const tile = 16 * k;
      const off = Math.round((size - tile) / 2) % tile - tile;
      for (let y = off; y < size; y += tile) for (let x = off; x < size; x += tile) g.drawImage(dirt, x, y, tile, tile);
      g.fillStyle = 'rgba(12, 8, 6, .5)';
      g.fillRect(0, 0, size, size);
    }
    const b = 26 * k, at = Math.round((size - b) / 2);
    g.drawImage(badge, at, at, b, b);
    out[name] = c.toDataURL('image/png');
  }

  // favicon.svg: one rect per horizontal run of a colour
  const px = bg.getImageData(0, 0, 26, 26).data;
  const hex = i => '#' + [px[i], px[i + 1], px[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
  const runs = [];
  for (let y = 0; y < 26; y++) {
    let x = 0;
    while (x < 26) {
      const i = (y * 26 + x) * 4;
      if (px[i + 3] < 128) { x++; continue; }
      const col = hex(i);
      let w = 1;
      while (x + w < 26) {
        const j = (y * 26 + x + w) * 4;
        if (px[j + 3] < 128 || hex(j) !== col) break;
        w++;
      }
      runs.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${col}"/>`);
      x += w;
    }
  }
  out.svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26" shape-rendering="crispEdges">${runs.join('')}</svg>\n`;
  return out;
}, SPECS);

for (const name of Object.keys(SPECS)) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, Buffer.from(result[name].split(',')[1], 'base64'));
  console.log('wrote', path.relative(root, file), fs.statSync(file).size, 'bytes');
}
const svgFile = path.join(root, 'public/favicon.svg');
fs.writeFileSync(svgFile, result.svg);
console.log('wrote', path.relative(root, svgFile), fs.statSync(svgFile).size, 'bytes');
await browser.close();
