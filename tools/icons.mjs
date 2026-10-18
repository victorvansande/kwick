/* Kwick's logo, drawn once here and rendered into every icon and launch screen the app ships.
   A thermometer of dots in a hairline glass: three white dots and two raspberry dots up the tube, a big raspberry
   dot as the bulb, and a fine scale beside the tube (long and short marks, one per dot), all a little left of centre
   so the scale balances it.

   Run: node tools/icons.mjs   (needs the "playwright" package and Chromium, as tests/smoke.mjs does)
   Writes assets/favicon.svg, favicon.png, apple-touch-icon.png, icon-192/512.png, icon-maskable-512.png,
   icon-monochrome-512.png and assets/splash/*.png (each at the size its file name gives). */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const A = f => path.join(root, "assets", f);
const TILE = "#12152e", RASP = "#e80049", SPLASH_BG = "#0b1120";

/* the drawing, in a 100 × 100 box; `mono` draws everything opaque white (for the monochrome icon) */
function mark(mono = false) {
  const R = 17.5, w = 8, cy = 75.6, top = 20, yi = cy - Math.sqrt(R * R - w * w);
  const glass = `M${50 - w} ${yi.toFixed(2)}V${top}A${w} ${w} 0 0 1 ${50 + w} ${top}V${yi.toFixed(2)}A${R} ${R} 0 1 1 ${50 - w} ${yi.toFixed(2)}Z`;
  const white = mono ? ` fill="#fff"` : ` fill="#fff" opacity=".92"`, red = mono ? ` fill="#fff"` : ` fill="${RASP}"`;
  const dots = [0, 1, 2, 3, 4].map(i => `<circle cx="50" cy="${(20 + i * 9.2).toFixed(1)}" r="3.2"${i >= 3 ? red : white}/>`).join("") + `<circle cx="50" cy="${cy}" r="11.5"${red}/>`;
  const ticks = [0, 1, 2, 3, 4].map(i => `<path d="M${50 + w + 3.5} ${(20 + i * 9.2).toFixed(1)}h${i % 2 ? 2.8 : 5}" stroke="#fff" stroke-opacity="${mono ? 1 : .45}" stroke-width="${mono ? 1.6 : 1.1}" stroke-linecap="round"/>`).join("");
  return `<g transform="translate(47.5 50) scale(.86) translate(-50 -53.5)"><path d="${glass}" fill="none" stroke="#fff" stroke-opacity="${mono ? 1 : .34}" stroke-width="${mono ? 1.8 : 1.2}"/>${ticks}${dots}</g>`;
}
const svg = (inner, bg = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${bg}${inner}</svg>`;
const tile = svg(mark(), `<rect width="100" height="100" rx="22.4" fill="${TILE}"/>`);   // rounded, on transparent
const square = svg(mark(), `<rect width="100" height="100" fill="${TILE}"/>`);             // the system rounds it
const mono = svg(mark(true));

const b = await chromium.launch();
const page = await b.newPage();
async function png(file, markup, w, h = w, bg = "transparent") {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:${bg}">${markup}</body></html>`);
  await page.screenshot({ path: file, omitBackground: bg === "transparent", clip: { x: 0, y: 0, width: w, height: h } });
}
const img = (s, size, style = "") => `<img src="data:image/svg+xml;base64,${Buffer.from(s).toString("base64")}" width="${size}" height="${size}" style="display:block;${style}">`;

await fs.writeFile(A("favicon.svg"), tile + "\n");
await png(A("favicon.png"), img(tile, 64), 64);
await png(A("icon-192.png"), img(tile, 192), 192);
await png(A("icon-512.png"), img(tile, 512), 512);
await png(A("apple-touch-icon.png"), img(square, 180), 180);
await png(A("icon-maskable-512.png"), img(square, 512), 512);
await png(A("icon-monochrome-512.png"), img(mono, 512), 512);
// launch screens: the tile at about a quarter of the screen width, in the middle, on the dark ground
for (const f of await fs.readdir(A("splash"))) {
  const m = f.match(/^splash-(\d+)x(\d+)\.png$/); if (!m) continue;
  const W = +m[1], H = +m[2], t = Math.round(W * .2605);
  await png(A(`splash/${f}`), img(tile, t, `position:absolute;left:${(W - t) / 2}px;top:${(H - t) / 2}px`), W, H, SPLASH_BG);
}
await b.close();
console.log("Icons and launch screens written.");
