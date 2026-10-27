// Окно «Поделиться ссылкой»: включить доступ к доске по ссылке, выбрать права, сменить или закрыть ссылку.
import { useEffect, useState } from "react";

const api = (file, method = "GET", body) =>
  fetch(`/api/shares?file=${encodeURIComponent(file)}`, { method, body: body && JSON.stringify(body) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))));

export const shareUrl = (token) => `${location.origin}/s/${token}`;

export function ShareDialog({ file, onClose }) {
  const [link, setLink] = useState(); // undefined — грузится, null — доступа по ссылке нет
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { api(file).then(setLink, () => setLink(null)); }, [file]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const run = (method, body) => async () => {
    setBusy(true);
    setCopied(false);
    try { setLink(await api(file, method, body)); } catch (e) { alert(`Не получилось: ${e.message}`); }
    setBusy(false);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl(link.token));
    setCopied(true);
  };

  return (
    <div style={css.backdrop} onClick={onClose}>
      <div style={css.box} onClick={(e) => e.stopPropagation()}>
        <h2 style={css.h2}>Доступ по ссылке</h2>
        {link === undefined ? null : !link ? (
          <>
            <p style={css.text}>Сейчас доску видите только вы. Ссылка откроет её без пароля любому, у кого она есть;
              другие доски и их список по ней не видны.</p>
            <div style={css.buttons}>
              <button disabled={busy} style={css.primary} onClick={run("POST", { mode: "view" })}>Ссылка для просмотра</button>
              <button disabled={busy} style={css.primary} onClick={run("POST", { mode: "edit" })}>Ссылка для правки</button>
            </div>
          </>
        ) : (
          <>
            <p style={css.text}>Любой, у кого есть ссылка, откроет эту доску без пароля. Другие доски и их список ему не видны.</p>
            <div style={css.buttons}>
              <input readOnly value={shareUrl(link.token)} style={css.input} onFocus={(e) => e.target.select()} />
              <button style={css.primary} onClick={copy}>{copied ? "Скопировано" : "Копировать"}</button>
            </div>
            <div style={css.modes}>
              {[["view", "Только просмотр"], ["edit", "Может редактировать"]].map(([m, label]) => (
                <label key={m} style={css.mode}>
                  <input type="radio" checked={link.mode === m} disabled={busy} onChange={run("POST", { mode: m })} /> {label}
                </label>
              ))}
            </div>
            <div style={css.buttons}>
              <button disabled={busy} style={css.secondary} onClick={run("POST", { renew: true })}
                title="Старая ссылка перестанет работать">Новая ссылка</button>
              <button disabled={busy} style={{ ...css.secondary, color: "#c92a2a" }} onClick={run("DELETE")}>Закрыть доступ</button>
            </div>
            <p style={css.hint}>«Новая ссылка» и «Закрыть доступ» отключают старую ссылку сразу, в том числе у тех, у кого доска уже открыта.</p>
          </>
        )}
        <button style={css.close} onClick={onClose} aria-label="Закрыть">×</button>
      </div>
    </div>
  );
}

const css = {
  backdrop: { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.3)", display: "flex", alignItems: "center", justifyContent: "center", font: "14px system-ui", color: "#1e1e1e" },
  box: { position: "relative", width: 520, maxWidth: "calc(100vw - 32px)", background: "#fff", borderRadius: 12, padding: "20px 24px", boxShadow: "0 8px 32px rgba(0,0,0,.2)" },
  h2: { font: "600 18px system-ui", margin: "0 0 12px" },
  text: { margin: "0 0 14px", lineHeight: 1.45 },
  hint: { margin: "12px 0 0", color: "#888", fontSize: 12, lineHeight: 1.4 },
  buttons: { display: "flex", gap: 8, marginTop: 10 },
  input: { flex: 1, minWidth: 0, font: "13px ui-monospace, monospace", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 8 },
  primary: { font: "inherit", padding: "8px 14px", border: 0, borderRadius: 8, background: "#6965db", color: "#fff", cursor: "pointer" },
  secondary: { font: "inherit", padding: "8px 14px", border: "1px solid #ddd", borderRadius: 8, background: "#fff", color: "#1e1e1e", cursor: "pointer" },
  modes: { display: "flex", gap: 20, margin: "14px 0 4px" },
  mode: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" },
  close: { position: "absolute", top: 10, right: 14, border: 0, background: "none", font: "22px system-ui", color: "#888", cursor: "pointer" },
};
