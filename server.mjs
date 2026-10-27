// Локальный Excalidraw: отдаёт сборку и держит сцены data/*.excalidraw в памяти.
// Вкладки и агенты присылают изменённые элементы, сервер сливает их по версиям
// (как reconcileElements в Excalidraw), рассылает остальным и пишет на диск.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import zlib from "node:zlib";
import { generateKeyBetween } from "fractional-indexing";

const root = path.dirname(new URL(import.meta.url).pathname);
const dataDir = path.join(root, "data");
const distDir = path.join(root, "dist");
const port = Number(process.env.PORT || 3010);
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex");
// Порт смотрит в интернет — Basic auth (логин любой, пароль в файле).
const password = fs.readFileSync(path.join(dataDir, "password"), "utf8").trim();
const authorized = (req) => {
  const [, b64] = (req.headers.authorization || "").split(" ");
  return Buffer.from(b64 || "", "base64").toString().split(":").slice(1).join(":") === password;
};

// Доступ по ссылке: data/shares.json — {токен: {file, mode: "view" | "edit", created}}.
// У доски не больше одной ссылки; токен — 192 случайных бита, угадать его нельзя.
const sharesFile = path.join(dataDir, "shares.json");
const shares = new Map(fs.existsSync(sharesFile) ? Object.entries(JSON.parse(fs.readFileSync(sharesFile, "utf8"))) : []);
// Сначала диск, потом память: если запись упала, ссылки остаются как были.
const saveShares = (next) => {
  fs.writeFileSync(sharesFile + ".tmp", JSON.stringify(Object.fromEntries(next), null, 2));
  fs.renameSync(sharesFile + ".tmp", sharesFile);
  shares.clear();
  for (const [token, s] of next) shares.set(token, s);
};
const shareOf = (file) => [...shares].find(([, s]) => s.file === file);
// Ссылка действует, пока она есть в shares и доска на месте.
const liveShare = (token) => {
  const s = token && shares.get(token);
  return s && fs.existsSync(path.join(dataDir, s.file)) ? s : null;
};

const randomInt = () => crypto.randomInt(1, 2 ** 31);
const randomId = () => crypto.randomBytes(16).toString("base64url").slice(0, 21);
const byIndex = (a, b) => {
  const x = a.index ?? "￿", y = b.index ?? "￿";
  return x < y ? -1 : x > y ? 1 : 0;
};
// Правило Excalidraw: побеждает большая version, при равной — меньший versionNonce.
const newer = (a, b) => !b || a.version > b.version || (a.version === b.version && a.versionNonce < b.versionNonce);

const ELEMENT_DEFAULTS = {
  angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
  strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null,
  roundness: null, boundElements: null, link: null, locked: false, isDeleted: false,
};

const TEXT_DEFAULTS = {
  fontSize: 20, fontFamily: 5, textAlign: "left", verticalAlign: "top", containerId: null,
  autoResize: true, lineHeight: 1.25,
};
// Примерный размер текста, если его не прислали: ~0.6·fontSize на символ.
const textBox = (e) => {
  const lines = String(e.text).split("\n");
  return {
    width: Math.max(...lines.map((l) => l.length)) * e.fontSize * 0.6,
    height: lines.length * e.fontSize * e.lineHeight,
  };
};

class Scene {
  constructor(file) {
    this.file = file;
    this.clients = new Set(); // {res, client}
    this.load();
    // Файл поправили руками (не через сервер) — перечитываем и перезагружаем вкладки.
    setInterval(() => {
      if (!fs.existsSync(file) || hash(fs.readFileSync(file)) === this.diskHash) return;
      this.load();
      this.broadcast({ type: "reload" });
    }, 1000);
  }

  load() {
    const text = fs.readFileSync(this.file);
    const doc = JSON.parse(text);
    this.doc = doc;
    this.elements = new Map(doc.elements.map((e) => [e.id, e]));
    this.files = doc.files || {};
    this.diskHash = hash(text);
  }

  toJSON() {
    const elements = [...this.elements.values()].sort(byIndex);
    return { ...this.doc, elements, files: this.files };
  }

  merge(elements = [], files = {}) {
    const changed = [];
    for (const e of elements) {
      if (newer(e, this.elements.get(e.id))) {
        this.elements.set(e.id, e);
        changed.push(e);
      }
    }
    const newFiles = {};
    for (const [id, f] of Object.entries(files)) {
      if (!this.files[id]) newFiles[id] = this.files[id] = f;
    }
    if (changed.length || Object.keys(newFiles).length) this.persist();
    return { elements: changed, files: newFiles };
  }

  // Правка агентом: {add: [...], update: [{id, ...patch}], delete: [id]}.
  edit({ add = [], update = [], delete: del = [] }, files = {}) {
    const now = Date.now();
    const bump = (e) => ({ ...e, version: (e.version || 1) + 1, versionNonce: randomInt(), updated: now });
    const out = [];
    for (const patch of update) {
      const cur = this.elements.get(patch.id);
      if (!cur) throw new Error(`нет элемента ${patch.id}`);
      const next = bump({ ...cur, ...patch });
      if (cur.type === "text" && "text" in patch) {
        if (!("originalText" in patch)) next.originalText = patch.text;
        if (!("width" in patch)) Object.assign(next, textBox(next));
      }
      out.push(next);
    }
    for (const id of del) {
      const cur = this.elements.get(id);
      if (cur) out.push(bump({ ...cur, isDeleted: true }));
    }
    let last = [...this.elements.values()].map((e) => e.index).filter(Boolean).sort().at(-1) ?? null;
    for (const a of add) {
      last = generateKeyBetween(last, null);
      let e = {
        ...ELEMENT_DEFAULTS, ...(a.type === "text" ? TEXT_DEFAULTS : {}), ...a,
        id: a.id || randomId(), seed: a.seed || randomInt(),
        version: 1, versionNonce: randomInt(), updated: now, index: a.index || last,
      };
      if (e.type === "text") e = { originalText: e.text, ...textBox(e), ...e };
      out.push(e);
    }
    return this.merge(out, files);
  }

  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const text = JSON.stringify(this.toJSON());
      fs.writeFileSync(this.file + ".tmp", text);
      fs.renameSync(this.file + ".tmp", this.file);
      this.diskHash = hash(text);
    }, 300);
  }

  // Ссылку отозвали или поменяли ей права: вкладки, открытые по ней, перезагружаются.
  dropShare(token) {
    for (const c of this.clients) {
      if (c.share !== token) continue;
      c.res.end(`data: ${JSON.stringify({ type: "share-changed" })}\n\n`);
      this.clients.delete(c);
    }
  }

  broadcast(msg, exceptClient) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const c of this.clients) if (!exceptClient || c.client !== exceptClient) c.res.write(data);
  }
}

const scenes = new Map();
const sceneFor = (f) => {
  if (!scenes.has(f)) scenes.set(f, new Scene(f));
  return scenes.get(f);
};

const fileParam = (u) => path.join(dataDir, path.basename(u.searchParams.get("file") || ""));
const isScene = (f) => f.endsWith(".excalidraw");

const readBody = (req, limit = Infinity) => new Promise((resolve, reject) => {
  // Склеиваем буферы, а не строки: иначе символ UTF-8 на стыке чанков бьётся в «��».
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > limit) return reject(Object.assign(new Error("слишком большой запрос"), { status: 413 }));
    chunks.push(c);
  });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
});

// Ответ со сжатием: brotli или gzip, если браузер умеет; несжимаемое (шрифты, картинки) — как есть.
const compressible = (type = "") => /json|javascript|css|html|svg|text/.test(type);
const send = (req, res, status, headers, body) => {
  const accept = req.headers["accept-encoding"] || "";
  const enc = body.length < 1024 || !compressible(headers["Content-Type"]) ? null
    : accept.includes("br") ? "br" : accept.includes("gzip") ? "gzip" : null;
  if (enc) {
    body = enc === "br"
      ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
      : zlib.gzipSync(body);
    headers = { ...headers, "Content-Encoding": enc, Vary: "Accept-Encoding" };
  }
  res.writeHead(status, { ...headers, "Content-Length": body.length });
  res.end(body);
};

// Файлы сборки сжимаем один раз и держим в памяти (ключ — путь, время изменения, кодировка).
const fileCache = new Map();
const sendFile = (req, res, p, headers = {}) => {
  let stat;
  try { stat = fs.statSync(p); } catch { return res.writeHead(404).end(); }
  const accept = req.headers["accept-encoding"] || "";
  const enc = !compressible(headers["Content-Type"]) ? "" : accept.includes("br") ? "br" : accept.includes("gzip") ? "gzip" : "";
  const key = `${p}|${stat.mtimeMs}|${enc}`;
  let body = fileCache.get(key);
  if (!body) {
    try { body = fs.readFileSync(p); } catch { return res.writeHead(503).end(); } // dist пересобирается
    // Промах кэша: быстрый brotli сейчас, максимальный — в фоне (warmCache).
    if (enc === "br") body = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
    if (enc === "gzip") body = zlib.gzipSync(body, { level: 6 });
    fileCache.set(key, body);
    if (enc === "br") scheduleWarm();
  }
  if (enc) headers = { ...headers, "Content-Encoding": enc, Vary: "Accept-Encoding" };
  res.writeHead(200, { ...headers, "Content-Length": body.length });
  res.end(body);
};

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml" };

// Файл сборки; index.html не кэшируем, иначе после пересборки браузер держит старый бандл;
// файлы из assets/ и fonts/ с хэшем или неизменны — кэш на год.
const distFile = (pathname) => {
  const p = path.join(distDir, path.normalize(pathname));
  return p.startsWith(distDir + path.sep) && fs.existsSync(p) && !fs.statSync(p).isDirectory() ? p : null;
};
const sendDist = (req, res, p, headers = {}) => sendFile(req, res, p, {
  "Content-Type": types[path.extname(p)] || "application/octet-stream",
  "Cache-Control": p.endsWith("index.html") ? "no-cache" : "private, max-age=31536000, immutable",
  ...headers,
});

// Правка от гостя: только элементы и картинки той формы, которую merge, сортировка и /api/file
// переварят; иначе один кривой запрос уронит сервер при сохранении.
const plain = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
// Глубина вложенности без рекурсии: на слишком глубоком JSON.stringify падает с переполнением стека.
const shallow = (root, max = 32) => {
  const stack = [[root, 0]];
  const isObj = (v) => v !== null && typeof v === "object";
  while (stack.length) {
    const [x, d] = stack.pop();
    if (d > max) return false;
    // В стек — только объекты и массивы; числа и строки (их в большом массиве миллионы) пропускаем на месте.
    if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) if (isObj(x[i])) stack.push([x[i], d + 1]); }
    else for (const k in x) if (isObj(x[k])) stack.push([x[k], d + 1]);
  }
  return true;
};
const validGuestBody = (b) => plain(b) && shallow(b)
  && (b.elements === undefined || (Array.isArray(b.elements) && b.elements.every((e) => plain(e)
    && typeof e.id === "string" && Number.isFinite(e.version) && Number.isFinite(e.versionNonce)
    && (e.index == null || typeof e.index === "string"))))
  && (b.files === undefined || (plain(b.files) && Object.values(b.files).every((f) => plain(f) && typeof f.dataURL === "string")));

// Что можно по ссылке: читать доску, её картинки и поток правок; писать — только с правом "edit".
const shareAllows = (u, req, share) => req.method === "GET"
  ? ["/api/shared", "/api/scene", "/api/file", "/api/events"].includes(u.pathname)
  : u.pathname === "/api/scene" && req.method === "POST" && share.mode === "edit";

async function handle(req, res) {
  // Адрес страницы (с токеном) не уходит чужим сайтам по ссылкам с доски.
  res.setHeader("Referrer-Policy", "no-referrer");
  // Иконка открыта: браузер показывает её во вкладке ещё до ввода пароля.
  if (req.url === "/favicon.svg") return sendFile(req, res, path.join(distDir, "favicon.svg"), { "Content-Type": "image/svg+xml" });
  const u = new URL(req.url, "http://x");
  const client = u.searchParams.get("client");

  // Страница по ссылке /s/<токен> открывается без пароля; отозванная — 404.
  const pageToken = /^\/s\/([\w-]+)$/.exec(u.pathname)?.[1];
  if (pageToken) {
    if (!liveShare(pageToken)) {
      return send(req, res, 404, { "Content-Type": "text/html; charset=utf-8" },
        Buffer.from('<!doctype html><meta charset="utf-8"><title>Excalidraw</title><p style="font:16px system-ui;padding:40px;color:#555">Ссылка не действует: доступ к доске закрыли.</p>'));
    }
    return sendDist(req, res, path.join(distDir, "index.html"), { "X-Robots-Tag": "noindex" });
  }

  // API по ссылке (?share=<токен>) видит только свою доску, что бы ни пришло в ?file.
  let f, share = null;
  if (u.searchParams.has("share")) {
    share = liveShare(u.searchParams.get("share"));
    if (!share) return json(res, 403, { error: "ссылка не действует" });
    if (!shareAllows(u, req, share)) return json(res, 403, { error: "по ссылке это недоступно" });
    f = path.join(dataDir, share.file);
  } else if (!authorized(req)) {
    // Без пароля отдаём только сборку (её видит и страница по ссылке): в ней нет данных.
    const p = /^\/(assets|fonts)\//.test(u.pathname) && distFile(u.pathname);
    if (p) return sendDist(req, res, p);
    return res.writeHead(401, { "WWW-Authenticate": 'Basic realm="excalidraw"' }).end();
  } else f = fileParam(u);

  if (u.pathname === "/api/shared") return json(res, 200, { file: share.file, mode: share.mode });

  // Ссылки досок (только с паролем). GET без file — все: {файл: {token, mode, created}}.
  if (u.pathname === "/api/shares") {
    if (!u.searchParams.has("file")) {
      return json(res, 200, Object.fromEntries([...shares].map(([token, s]) => [s.file, { token, ...s }])));
    }
    const file = path.basename(f);
    if (!isScene(f) || !fs.existsSync(f)) return json(res, 404, { error: "нет такой доски" });
    const out = (entry) => json(res, 200, entry ? { token: entry[0], ...entry[1] } : null);
    if (req.method === "GET") return out(shareOf(file));
    if (req.method !== "POST" && req.method !== "DELETE") return json(res, 405, { error: "GET, POST или DELETE" });
    const body = req.method === "POST" ? JSON.parse(await readBody(req)) : {};
    // Дальше без await: два одновременных запроса не создадут доске две ссылки.
    const cur = shareOf(file);
    const mode = body.mode ? (body.mode === "edit" ? "edit" : "view") : cur?.[1].mode ?? "view";
    if (cur && req.method === "POST" && !body.renew && mode === cur[1].mode) return out(cur);
    // Старая запись уходит сразу: ссылка перестаёт работать, открытые по ней вкладки отключаются
    // (при смене прав они перезагружаются и открываются уже с новыми).
    const next = new Map(shares);
    if (cur) next.delete(cur[0]);
    // POST {mode, renew}: создать ссылку или сменить права (токен тот же); renew — новый токен.
    const token = cur && !body.renew ? cur[0] : crypto.randomBytes(24).toString("base64url");
    if (req.method === "POST") next.set(token, { file, mode, created: cur && !body.renew ? cur[1].created : Date.now() });
    saveShares(next);
    if (cur) scenes.get(f)?.dropShare(cur[0]);
    return out(req.method === "POST" ? [token, shares.get(token)] : null);
  }

  if (u.pathname === "/api/boards") {
    if (req.method === "POST") {
      // Новая доска: имя файла = имя доски без символов, недопустимых в пути.
      const { name } = JSON.parse(await readBody(req));
      const base = String(name || "").replace(/[\/\\:*?"<>|]/g, " ").trim();
      if (!base) return json(res, 400, { error: "нужно имя" });
      const file = base + ".excalidraw";
      const p = path.join(dataDir, file);
      if (fs.existsSync(p)) return json(res, 409, { error: "такая доска уже есть", file });
      fs.writeFileSync(p, JSON.stringify({ type: "excalidraw", version: 2, source: "excalidraw-self-hosted", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} }));
      return json(res, 201, { file });
    }
    const boards = fs.readdirSync(dataDir).filter(isScene).map((file) => {
      const p = path.join(dataDir, file);
      const elements = scenes.has(p) ? [...scenes.get(p).elements.values()] : JSON.parse(fs.readFileSync(p, "utf8")).elements;
      const live = elements.filter((e) => !e.isDeleted);
      return { file, slides: live.filter((e) => e.type === "frame").length, elements: live.length, updated: fs.statSync(p).mtimeMs };
    });
    return json(res, 200, boards.sort((a, b) => b.updated - a.updated));
  }

  if (u.pathname === "/api/scene") {
    if (!isScene(f) && !f.endsWith(".deck.json")) return json(res, 404, { error: "нет такой доски" });
    if (!fs.existsSync(f)) return json(res, 404, { error: "нет файла" });
    if (!isScene(f)) {
      // Колоды (*.deck.json) — обычные файлы.
      return send(req, res, 200, { "Content-Type": "application/json; charset=utf-8" }, fs.readFileSync(f));
    }
    const scene = sceneFor(f);
    if (req.method === "GET") {
      const doc = scene.toJSON();
      // ?lite=1 — без содержимого картинок: браузер берёт их из /api/file и кэширует.
      if (u.searchParams.get("lite")) {
        doc.files = Object.fromEntries(Object.entries(doc.files).map(([id, { dataURL, ...meta }]) => [id, meta]));
      }
      return send(req, res, 200, { "Content-Type": "application/json; charset=utf-8" }, Buffer.from(JSON.stringify(doc)));
    }
    // POST/PUT: элементы (целая сцена или только изменённые) — сливаем по версиям.
    const body = JSON.parse(await readBody(req, share ? 50 * 2 ** 20 : Infinity));
    // Пока тело шло, ссылку могли отозвать или лишить права правки.
    if (share && liveShare(u.searchParams.get("share"))?.mode !== "edit") return json(res, 403, { error: "ссылка не действует" });
    if (share && !validGuestBody(body)) return json(res, 400, { error: "неверные элементы" });
    const changed = scene.merge(body.elements, body.files);
    if (changed.elements.length || Object.keys(changed.files).length) scene.broadcast({ type: "elements", ...changed }, client);
    return json(res, 200, { merged: changed.elements.length });
  }

  if (u.pathname === "/api/file") {
    // Картинка доски. Excalidraw не меняет файл под тем же id, поэтому кэш на год.
    const data = isScene(f) && fs.existsSync(f) && sceneFor(f).files[u.searchParams.get("id")];
    const m = data && /^data:([^;]+);base64,(.*)$/s.exec(data.dataURL);
    if (!m) return json(res, 404, { error: "нет файла" });
    // Картинку мог загрузить гость по ссылке: как страница она не исполняется (sandbox, nosniff).
    return send(req, res, 200, {
      "Content-Type": m[1], "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff",
    }, Buffer.from(m[2], "base64"));
  }

  if (u.pathname === "/api/edit" && req.method === "POST") {
    const scene = sceneFor(f);
    try {
      const body = JSON.parse(await readBody(req));
      const changed = scene.edit(body, body.files);
      scene.broadcast({ type: "elements", ...changed });
      return json(res, 200, { ids: changed.elements.map((e) => e.id) });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  if (u.pathname === "/api/pdf") {
    const out = f.replace(/\.excalidraw$/, "") + ".pdf";
    execFile("node", [path.join(root, "scripts/pdf.mjs"), path.basename(f), out], { cwd: root, timeout: 300000 }, (err, _o, stderr) => {
      if (err) return res.writeHead(500).end(stderr || String(err));
      sendFile(req, res, out, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${path.basename(out)}"` });
    });
    return;
  }

  if (u.pathname === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(": ok\n\n");
    if (isScene(f) && fs.existsSync(f)) {
      const scene = sceneFor(f);
      const c = { res, client, share: share && u.searchParams.get("share") };
      scene.clients.add(c);
      req.on("close", () => scene.clients.delete(c));
      return;
    }
    // Не сцена (колода) — следим за файлом.
    let last = fs.existsSync(f) ? hash(fs.readFileSync(f)) : "";
    const tick = setInterval(() => {
      const h = fs.existsSync(f) ? hash(fs.readFileSync(f)) : "";
      if (h === last) return;
      last = h;
      res.write(`data: ${JSON.stringify({ type: "reload" })}\n\n`);
    }, 700);
    req.on("close", () => clearInterval(tick));
    return;
  }

  sendDist(req, res, distFile(u.pathname) || path.join(distDir, "index.html"));
}

// Сжимаем сборку максимальным brotli в фоне: при старте и после каждой пересборки.
const maxBrotli = new Set(); // ключи, уже сжатые на максимум
async function warmCache() {
  const { promisify } = await import("node:util");
  const br = promisify(zlib.brotliCompress);
  for (const name of fs.readdirSync(distDir, { recursive: true })) {
    const p = path.join(distDir, name);
    if (!/\.(js|css|html|svg)$/.test(p)) continue;
    let key;
    try { key = `${p}|${fs.statSync(p).mtimeMs}|br`; } catch { continue; }
    if (maxBrotli.has(key)) continue;
    fileCache.set(key, await br(fs.readFileSync(p), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
    maxBrotli.add(key);
  }
  // Старые версии файлов из кэша убираем.
  for (const key of fileCache.keys()) {
    const [p, mtime] = key.split("|");
    let now;
    try { now = String(fs.statSync(p).mtimeMs); } catch { now = null; }
    if (now !== mtime) { fileCache.delete(key); maxBrotli.delete(key); }
  }
}
let warmTimer;
const scheduleWarm = () => {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => warmCache().catch((e) => console.error("warmCache", e)), 1000);
};
scheduleWarm();
fs.watch(path.dirname(distDir), (_, name) => name === "dist" && scheduleWarm());

// HOSTS — адреса через запятую; по умолчанию все интерфейсы.
for (const host of (process.env.HOSTS || "0.0.0.0").split(",")) {
  http.createServer((req, res) => handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) json(res, e.status || 500, { error: String(e.message || e) });
  })).listen(port, host, () => console.log(`http://${host}:${port}`));
}
