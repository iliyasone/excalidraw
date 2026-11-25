// Headless-вкладка с открытой сценой: через неё скрипты берут
// window.excalidrawAPI и exportToSvg из той же сборки, что видит человек.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

export const password = () => fs.readFileSync(new URL("../data/password", import.meta.url), "utf8").trim();
export const port = process.env.PORT || 3010;

export async function openScene(file) {
  const browser = await chromium.launch();
  // Пароль — в каждом запросе: без него сервер отдаёт страницу входа, а не запрос Basic auth.
  const auth = "Basic " + Buffer.from("agent:" + password()).toString("base64");
  const ctx = await browser.newContext({ extraHTTPHeaders: { Authorization: auth } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/?file=${encodeURIComponent(path.basename(file))}`);
  await page.waitForFunction(() => window.excalidrawAPI, null, { timeout: 60000 });
  return { browser, ctx, page };
}
