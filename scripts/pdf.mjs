// Usage: node scripts/pdf.mjs <file.excalidraw> [out.pdf] [--deck=<name>]
// Каждый фрейм — страница PDF, вектор, шрифты встроены.
// Если есть data/<name>.deck.json (или data/<name>.<deck>.deck.json) — только слайды колоды, в её порядке.
import fs from "node:fs";
import path from "node:path";
import { openScene } from "./browser.mjs";
import { deckFrames } from "../src/deck.js";

const deckName = process.argv.find((a) => a.startsWith("--deck="))?.slice(7);
const [file, outArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const base = path.basename(file, ".excalidraw") + (deckName ? `.${deckName}` : "");
const out = outArg || path.join("data", base + ".pdf");
const deckPath = path.join("data", base + ".deck.json");
const deck = fs.existsSync(deckPath) ? JSON.parse(fs.readFileSync(deckPath, "utf8")) : null;
const scene = JSON.parse(fs.readFileSync(path.join("data", path.basename(file)), "utf8"));
const frameIds = deckFrames(scene.elements, deck).map((f) => f.id);
const { browser, ctx, page } = await openScene(file);

const slides = await page.evaluate(async (frameIds) => {
  const api = window.excalidrawAPI;
  const elements = api.getSceneElements();
  const files = api.getFiles();
  const res = [];
  for (const id of frameIds) {
    const frame = elements.find((e) => e.id === id);
    const svg = await window.exportToSvg({
      elements, files, exportingFrame: frame, exportPadding: 0,
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
    });
    res.push({ w: frame.width, h: frame.height, svg: svg.outerHTML });
  }
  return res;
}, frameIds);

const { w, h } = slides[0];
const html = `<!doctype html><html><head><style>
  @page { size: ${w}px ${h}px; margin: 0 }
  html, body { margin: 0 }
  .s { width: ${w}px; height: ${h}px; break-after: page; overflow: hidden }
  .s img { width: 100%; height: 100%; display: block }
</style></head><body>${slides
  // Каждый слайд — отдельный <img>: у SVG разных фреймов совпадают id клипов.
  .map((s) => `<div class="s"><img src="data:image/svg+xml;base64,${Buffer.from(s.svg).toString("base64")}"></div>`)
  .join("")}</body></html>`;
const pdfPage = await ctx.newPage();
await pdfPage.setContent(html, { waitUntil: "load" });
await pdfPage.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
await pdfPage.pdf({ path: out, width: `${w}px`, height: `${h}px`, printBackground: true });
await browser.close();
console.log(`${slides.length} slides → ${out}`);
