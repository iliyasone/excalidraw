// Usage: node scripts/pdf.mjs <file.excalidraw> [out.pdf]
// Каждый фрейм — страница PDF, вектор, шрифты встроены.
import path from "node:path";
import { openScene, sortedFramesJs } from "./browser.mjs";

const file = process.argv[2] || "parallel.excalidraw";
const out = process.argv[3] || path.join("data", path.basename(file, ".excalidraw") + ".pdf");
const { browser, ctx, page } = await openScene(file);

const slides = await page.evaluate(async (sortFrames) => {
  const api = window.excalidrawAPI;
  const elements = api.getSceneElements();
  const files = api.getFiles();
  const res = [];
  for (const frame of eval(sortFrames)(elements)) {
    const svg = await window.exportToSvg({
      elements, files, exportingFrame: frame, exportPadding: 0,
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
    });
    res.push({ w: frame.width, h: frame.height, svg: svg.outerHTML });
  }
  return res;
}, sortedFramesJs);

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
