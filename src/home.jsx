// Стартовая страница: все доски из data/, создание новой, переименование и архив.
import { useEffect, useState } from "react";
import { title, renameBoard, archiveBoard, restoreBoard, deleteBoard } from "./boards.js";

const when = (ms) => new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const boardUrl = (file, page = "/") => `${page}?file=${encodeURIComponent(file)}`;

export function Home() {
  const [boards, setBoards] = useState(null);
  const [shares, setShares] = useState({}); // доски, открытые по ссылке: {файл: {mode}}
  const [archived, setArchived] = useState(null);
  const [showArchive, setShowArchive] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const refresh = () => {
    fetch("/api/boards").then((r) => r.json()).then(setBoards);
    fetch("/api/shares").then((r) => r.json()).then(setShares);
    fetch("/api/boards?archived=1").then((r) => r.json()).then(setArchived);
  };
  useEffect(refresh, []);

  const create = async (e) => {
    e.preventDefault();
    const r = await fetch("/api/boards", { method: "POST", body: JSON.stringify({ name }) });
    const body = await r.json();
    if (r.ok) location.href = boardUrl(body.file);
    else setError(body.error);
  };

  // Действие над доской; после него перечитываем оба списка.
  const act = (fn, file) => async () => { if (await fn(file)) refresh(); };

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
          <a href={boardUrl(b.file)} style={css.name}>{title(b.file)}</a>
          <span style={css.meta}>{b.slides ? `${b.slides} слайдов · ` : ""}{when(b.updated)}</span>
          {shares[b.file] && <span style={css.shared} title="Доска открыта по ссылке; закрыть доступ — в меню доски">
            по ссылке: {shares[b.file].mode === "edit" ? "правка" : "просмотр"}</span>}
          {b.slides > 0 && <a href={boardUrl(b.file, "/present")} style={css.link}>Показ</a>}
          <button onClick={act(renameBoard, b.file)} style={css.action}>Переименовать</button>
          <button onClick={act(archiveBoard, b.file)} style={css.action}>В архив</button>
        </div>
      ))}
      {archived?.length > 0 && (
        <>
          <button onClick={() => setShowArchive((v) => !v)} style={css.archiveToggle}>
            {showArchive ? "▾" : "▸"} Архив ({archived.length})
          </button>
          {showArchive && archived.map((b) => (
            <div key={b.file} style={css.row}>
              <span style={{ ...css.name, color: "#888" }}>{title(b.file)}</span>
              <span style={css.meta}>{when(b.updated)}</span>
              <button onClick={act(restoreBoard, b.file)} style={css.action}>Вернуть</button>
              <button onClick={act(deleteBoard, b.file)} style={{ ...css.action, color: "#c92a2a" }}>Удалить</button>
            </div>
          ))}
        </>
      )}
    </main>
  );
}

const css = {
  page: { maxWidth: 820, margin: "48px auto", padding: "0 20px", font: "15px system-ui", color: "#1e1e1e" },
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
  link: { color: "#6965db", textDecoration: "none", fontSize: 13 },
  action: { font: "inherit", fontSize: 13, padding: 0, border: 0, background: "none", color: "#6965db", cursor: "pointer" },
  archiveToggle: { font: "inherit", margin: "24px 0 4px", padding: 0, border: 0, background: "none", color: "#555", cursor: "pointer", fontWeight: 500 },
};
