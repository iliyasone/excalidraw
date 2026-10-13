// Локальный Excalidraw: отдаёт сборку и держит сцены data/*.excalidraw в памяти.
// Вкладки и агенты присылают изменённые элементы, сервер сливает их по версиям
// (как reconcileElements в Excalidraw), рассылает остальным и пишет на диск.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
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

const readBody = (req) => new Promise((resolve, reject) => {
  // Склеиваем буферы, а не строки: иначе символ UTF-8 на стыке чанков бьётся в «��».
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
});

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml" };

async function handle(req, res) {
  // Иконка открыта: браузер показывает её во вкладке ещё до ввода пароля.
  if (req.url === "/favicon.svg") {
    res.setHeader("Content-Type", "image/svg+xml");
    return fs.createReadStream(path.join(distDir, "favicon.svg")).pipe(res);
  }
  if (!authorized(req)) {
    return res.writeHead(401, { "WWW-Authenticate": 'Basic realm="excalidraw"' }).end();
  }
  const u = new URL(req.url, "http://x");
  const f = fileParam(u);
  const client = u.searchParams.get("client");

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
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return fs.createReadStream(f).pipe(res);
    }
    const scene = sceneFor(f);
    if (req.method === "GET") return json(res, 200, scene.toJSON());
    // POST/PUT: элементы (целая сцена или только изменённые) — сливаем по версиям.
    const body = JSON.parse(await readBody(req));
    const changed = scene.merge(body.elements, body.files);
    if (changed.elements.length || Object.keys(changed.files).length) scene.broadcast({ type: "elements", ...changed }, client);
    return json(res, 200, { merged: changed.elements.length });
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
      res.writeHead(200, { "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${path.basename(out)}"` });
      fs.createReadStream(out).pipe(res);
    });
    return;
  }

  if (u.pathname === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(": ok\n\n");
    if (isScene(f) && fs.existsSync(f)) {
      const scene = sceneFor(f);
      const c = { res, client };
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

  let p = path.join(distDir, path.normalize(u.pathname));
  if (!p.startsWith(distDir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(distDir, "index.html");
  res.setHeader("Content-Type", types[path.extname(p)] || "application/octet-stream");
  // index.html не кэшируем, иначе после пересборки браузер держит старый бандл.
  if (p.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(p).pipe(res);
}

// HOSTS — адреса через запятую; по умолчанию все интерфейсы.
for (const host of (process.env.HOSTS || "0.0.0.0").split(",")) {
  http.createServer((req, res) => handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: String(e.message || e) });
  })).listen(port, host, () => console.log(`http://${host}:${port}`));
}
