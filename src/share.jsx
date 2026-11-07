// Окна в стиле списка досок: общая рамка Dialog и «Доступ по ссылке» (включить, выбрать права,
// сменить или закрыть ссылку). ShareDialog открывается и из списка досок, и из меню редактора.
import { useEffect, useRef, useState } from "react";
import "./ui.css";
import { Icon } from "./icons.jsx";

const api = (file, method = "GET", body) =>
  fetch(`/api/shares?file=${encodeURIComponent(file)}`, { method, body: body && JSON.stringify(body) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))));

export const shareUrl = (token) => `${location.origin}/s/${token}`;

export function Dialog({ onClose, label, wide, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="ui backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
        <button className="btn btn-ghost icon-btn close" onClick={onClose} aria-label="Закрыть"><Icon name="x" /></button>
      </div>
    </div>
  );
}

// Окно «Новая доска»; пустое имя можно — сервер назовёт доску «Без названия <дата>».
export function NameDialog({ title: heading, action, initial, onSubmit, onClose }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await onSubmit(name.trim()); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Dialog onClose={onClose} label={heading}>
      <form onSubmit={submit}>
        <h2>{heading}</h2>
        <label className="field" htmlFor="board-name" style={{ marginTop: 16 }}>Название</label>
        <input id="board-name" className="input" autoFocus value={name} placeholder="Без названия"
          onFocus={(e) => e.target.select()} onChange={(e) => { setName(e.target.value); setError(""); }} />
        {error && <div className="error">{error[0].toUpperCase() + error.slice(1)}</div>}
        <div className="buttons">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" disabled={busy}>{action}</button>
        </div>
      </form>
    </Dialog>
  );
}

// Имя доски, которое правят прямо на месте (карточка, шапка редактора): Enter или уход из поля —
// сохранить, Esc — отменить. onDone(новый файл или null).
export function InlineName({ file, onDone, onError, className = "" }) {
  const initial = file.replace(/\.excalidraw$/, "");
  const [name, setName] = useState(initial);
  const done = useRef(false);
  const save = async () => {
    if (done.current) return;
    done.current = true;
    if (!name.trim() || name.trim() === initial) return onDone(null);
    const r = await fetch(`/api/boards?file=${encodeURIComponent(file)}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) onError?.(out.error ? out.error[0].toUpperCase() + out.error.slice(1) : "Не получилось переименовать");
    onDone(r.ok ? out.file : null);
  };
  return (
    <input className={`inline-name ${className}`} autoFocus value={name} aria-label="Название доски"
      onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.target.blur();
        if (e.key === "Escape") { done.current = true; onDone(null); }
        e.stopPropagation();
      }} />
  );
}

export function ShareDialog({ file, onClose }) {
  const [link, setLink] = useState(); // undefined — грузится, null — доступа по ссылке нет
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [renewing, setRenewing] = useState(false); // спрашиваем, точно ли менять ссылку

  useEffect(() => { api(file).then(setLink, () => setLink(null)); }, [file]);

  const run = (method, body) => async () => {
    setBusy(true);
    setCopied(false);
    setRenewing(false);
    try { setLink(await api(file, method, body)); } catch (e) { alert(`Не получилось: ${e.message}`); }
    setBusy(false);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl(link.token));
    setCopied(true);
  };

  return (
    <Dialog onClose={onClose} label="Поделиться" wide>
      <h2>Поделиться</h2>
      <p style={{ marginBottom: 4 }}>«{file.replace(/\.excalidraw$/, "")}»</p>
      {link !== undefined && (
        <>
          <div className="share-row">
            <div>
              <b>Открыть по ссылке</b>
              <small>{link ? "Любой, у кого есть ссылка, откроет эту доску без пароля" : "Сейчас доску видите только вы"}</small>
            </div>
            <button className="toggle" role="switch" aria-checked={!!link} aria-label="Открыть по ссылке" disabled={busy}
              onClick={link ? run("DELETE") : run("POST", { mode: "view" })} />
          </div>
          {link && (
            <>
              <div className="link-box">
                <span className="link-text" title={shareUrl(link.token)}>{shareUrl(link.token)}</span>
                <button className="btn btn-ghost icon-btn" onClick={copy} title={copied ? "Скопировано" : "Копировать ссылку"} aria-label="Копировать ссылку">
                  <Icon name={copied ? "check" : "copy"} size={17} />
                </button>
              </div>
              {copied && <div className="copied" role="status"><Icon name="check" size={15} />Ссылка скопирована</div>}
              {renewing && (
                <div className="renew">
                  <span>Выпустить новую ссылку? Старая перестанет работать.</span>
                  <button className="btn btn-ghost" onClick={() => setRenewing(false)}>Отмена</button>
                  <button className="btn btn-danger" disabled={busy} onClick={run("POST", { renew: true })}>Выпустить</button>
                </div>
              )}
              <div className="share-row mode-row" style={{ borderTop: 0, paddingTop: 0 }}>
                <b>По ссылке можно</b>
                <div className="seg" role="group" aria-label="Права по ссылке">
                  {[["view", "eye", "Смотреть"], ["edit", "pencil", "Редактировать"]].map(([m, icon, label]) => (
                    <button key={m} aria-pressed={link.mode === m} disabled={busy} onClick={run("POST", { mode: m })}>
                      <Icon name={icon} size={15} />{label}
                    </button>
                  ))}
                </div>
              </div>
              {!renewing && (
                <div className="share-row renew-row">
                  <div>
                    <b>Выпустить новую ссылку</b>
                    <small>Старая перестанет работать сразу, даже в открытых вкладках</small>
                  </div>
                  <button className="btn btn-secondary" onClick={() => setRenewing(true)} disabled={busy}><Icon name="renew" size={16} />Выпустить</button>
                </div>
              )}
              <div className="hint">Другие доски и их список по ссылке не видны.</div>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
