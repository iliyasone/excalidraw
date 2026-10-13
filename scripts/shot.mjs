// Usage: node scripts/shot.mjs <file.excalidraw> <slide> [out.png]
// slide — номер (с 1, в порядке PDF) или имя фрейма. PNG в 2x.
import fs from "node:fs";
import path from "node:path";
import { openScene } from "./browser.mjs";
import { orderedFrames } from "../src/deck.js";

const [file, slide, outArg] = process.argv.slice(2);
const out = outArg || path.join("/tmp", `slide-${slide}.png`);
const scene = JSON.parse(fs.readFileSync(path.join("data", path.basename(file)), "utf8"));
const frames = orderedFrames(scene.elements);
const frame = /^\d+$/.test(slide) ? frames[Number(slide) - 1] : frames.find((f) => f.name === slide);
if (!frame) throw new Error(`нет слайда ${slide}; всего ${frames.length}`);
const { browser, page } = await openScene(file);

const dataUrl = await page.evaluate(async (id) => {
  const api = window.excalidrawAPI;
  const elements = api.getSceneElements();
  const frame = elements.find((e) => e.id === id);
  const svg = await window.exportToSvg({
    elements, files: api.getFiles(), exportingFrame: frame, exportPadding: 0,
    appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
  });
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg.outerHTML)));
}, frame.id);

const shot = await browser.newPage({ deviceScaleFactor: 2 });
await shot.setContent(`<body style="margin:0"><img src="${dataUrl}"></body>`);
await shot.evaluate(() => document.images[0].decode());
await shot.locator("img").screenshot({ path: out });
await browser.close();
console.log(out);
