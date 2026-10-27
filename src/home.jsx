// Стартовая страница: все доски из data/ и создание новой.
import { useEffect, useState } from "react";

const when = (ms) => new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const boardUrl = (file, page = "/") => `${page}?file=${encodeURIComponent(file)}`;

export function Home() {
  const [boards, setBoards] = useState(null);
  const [shares, setShares] = useState({}); // доски, открытые по ссылке: {файл: {mode}}
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/boards").then((r) => r.json()).then(setBoards);
    fetch("/api/shares").then((r) => r.json()).then(setShares);
  }, []);

  const create = async (e) => {
    e.preventDefault();
    const r = await fetch("/api/boards", { method: "POST", body: JSON.stringify({ name }) });
    const body = await r.json();
    if (r.ok) location.href = boardUrl(body.file);
    else setError(body.error);
  };

  return (
    <main style={css.page}>
      <h1 style={css.h1}><img src="/favicon.svg" style={css.logo} /> Excalidraw</h1>
      <form onSubmit={create} style={css.form}>
        <input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="Новая доска" style={css.input} />
        <button style={css.button} disabled={!name.trim()}>Создать</button>
        {error && <span style={css.error}>{error}</span>}
      </form>
      {boards?.map((b) => (
        <div key={b.file} style={css.row}>
          <a href={boardUrl(b.file)} style={css.name}>{b.file.replace(/\.excalidraw$/, "")}</a>
          <span style={css.meta}>{b.slides ? `${b.slides} слайдов · ` : ""}{when(b.updated)}</span>
          {shares[b.file] && <span style={css.shared} title="Доска открыта по ссылке; закрыть доступ — в меню доски">
            по ссылке: {shares[b.file].mode === "edit" ? "правка" : "просмотр"}</span>}
          {b.slides > 0 && <a href={boardUrl(b.file, "/present")} style={css.link}>Показ</a>}
        </div>
      ))}
    </main>
  );
}

const css = {
  page: { maxWidth: 720, margin: "48px auto", padding: "0 20px", font: "15px system-ui", color: "#1e1e1e" },
  h1: { display: "flex", alignItems: "center", gap: 12, font: "600 28px system-ui", margin: "0 0 24px" },
  logo: { width: 36, height: 36 },
  form: { display: "flex", gap: 8, alignItems: "center", marginBottom: 24 },
  input: { flex: 1, font: "inherit", padding: "9px 12px", border: "1px solid #ccc", borderRadius: 8 },
  button: { font: "inherit", padding: "9px 16px", border: 0, borderRadius: 8, background: "#6965db", color: "#fff", cursor: "pointer" },
  error: { color: "#c92a2a" },
  row: { display: "flex", alignItems: "baseline", gap: 12, padding: "12px 0", borderBottom: "1px solid #eee" },
  name: { flex: 1, color: "#1e1e1e", textDecoration: "none", fontWeight: 500 },
  meta: { color: "#888", fontSize: 13 },
  shared: { color: "#2f9e44", fontSize: 13 },
  link: { color: "#6965db", textDecoration: "none" },
};
