// Локальный Excalidraw: отдаёт сборку, читает/пишет data/*.excalidraw
// и шлёт в браузер событие, когда файл поменяли снаружи.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

const root = path.dirname(new URL(import.meta.url).pathname);
const dataDir = path.join(root, "data");
const distDir = path.join(root, "dist");
const port = Number(process.env.PORT || 3010);
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex");
// Порт смотрит в интернет — Basic auth (логин любой, пароль в файле).
const password = fs.readFileSync("/root/.config/excalidraw-local/password", "utf8").trim();
const authorized = (req) => {
  const [, b64] = (req.headers.authorization || "").split(" ");
  return Buffer.from(b64 || "", "base64").toString().split(":").slice(1).join(":") === password;
};
const ownWrites = new Map(); // file -> hash последней записи из браузера

const sceneFile = (u) => {
  const name = path.basename(u.searchParams.get("file") || "parallel.excalidraw");
  return path.join(dataDir, name);
};

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml" };

http.createServer((req, res) => {
  if (!authorized(req)) {
    return res.writeHead(401, { "WWW-Authenticate": 'Basic realm="excalidraw"' }).end();
  }
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/scene") {
    const f = sceneFile(u);
    if (req.method === "PUT") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        ownWrites.set(f, hash(body));
        fs.writeFileSync(f + ".tmp", body);
        fs.renameSync(f + ".tmp", f);
        res.end("ok");
      });
      return;
    }
    res.setHeader("Content-Type", "application/json");
    return fs.createReadStream(f).on("error", () => res.writeHead(404).end()).pipe(res);
  }
  if (u.pathname === "/api/pdf") {
    const f = sceneFile(u);
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
    const f = sceneFile(u);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    let last = fs.existsSync(f) ? hash(fs.readFileSync(f)) : "";
    const tick = setInterval(() => {
      if (!fs.existsSync(f)) return;
      const h = hash(fs.readFileSync(f));
      if (h === last) return;
      last = h;
      if (h !== ownWrites.get(f)) res.write("data: changed\n\n");
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
}).listen(port, () => console.log(`http://localhost:${port}`));
