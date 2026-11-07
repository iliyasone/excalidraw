// Стартовая страница: доски с превью, поиск и разделы, закреплённые сверху, новая доска,
// импорт (кнопкой или перетаскиванием файла), меню доски.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./ui.css";
import { Icon } from "./icons.jsx";
import { useTheme, setChoice } from "./theme.js";
import { makeThumb, downloadPng } from "./thumbs.js";
import { Dialog, NameDialog, ShareDialog, InlineName } from "./share.jsx";

export const boardUrl = (file, page = "/") => `${page}?file=${encodeURIComponent(file)}`;
export const title = (file) => file.replace(/\.excalidraw$/, "");
export const thumbUrl = (b, dark) => `/api/thumb?file=${encodeURIComponent(b.file)}&v=${Math.round(b.thumb)}${dark ? "&theme=dark" : ""}`;

const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto", style: "short" });
export function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "только что";
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 7 * 86400) return rtf.format(-Math.round(s / 86400), "day");
  const d = new Date(ms);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
export const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
};

const SECTIONS = [
  { id: "all", label: "Все доски", icon: "boards", test: () => true },
  { id: "pinned", label: "Закреплённые", icon: "pin", hint: "закрепить можно в меню доски", test: (b) => b.pinned },
  { id: "slides", label: "Со слайдами", icon: "slides", hint: "их можно показать или сохранить в PDF", test: (b) => b.slides > 0 },
  { id: "shared", label: "По ссылке", icon: "link", hint: "открываются по секретной ссылке без пароля", test: (b, s) => !!s[b.file] },
];
const SORTS = [["updated", "Сначала недавние"], ["oldest", "Сначала давние"], ["name", "По названию"]];
const THEMES = [["light", "sun", "Светлая"], ["dark", "moon", "Тёмная"], ["system", "monitor", "Как в системе"]];

const api = async (url, method, body) => {
  const r = await fetch(url, { method, body: body && JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || r.statusText);
  return out;
};

export function Home() {
  const [boards, setBoards] = useState(null);
  const [shares, setShares] = useState({}); // доски, открытые по ссылке: {файл: {mode}}
  const [section, setSection] = useState(() => new URLSearchParams(location.search).get("view") || "all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(() => { try { return localStorage.getItem("sort") || "updated"; } catch { return "updated"; } });
  // {type: "create" | "delete" | "share", board}; /?new=1 (из панели досок редактора) — сразу «Новая доска»
  const [dialog, setDialog] = useState(() => (new URLSearchParams(location.search).has("new") ? { type: "create" } : null));
  const [view, setView] = useState(false); // телефон: окно «Вид» (порядок и тема)
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState("");
  const [themeChoice, theme] = useTheme();
  const importRef = useRef();

  const load = () => Promise.all([
    fetch("/api/boards").then((r) => r.json()).then(setBoards),
    fetch("/api/shares").then((r) => r.json()).then(setShares),
  ]);
  useEffect(() => { load(); }, []);

  // Ctrl+K или / — к поиску.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName))) {
        e.preventDefault();
        [...document.querySelectorAll(".search input")].find((i) => i.offsetParent)?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // Превью, которых нет или которые старее доски, рисуем по одной в фоне.
  const [thumbs, setThumbs] = useState({}); // файл -> версия превью (-1 — нарисовать не вышло)
  const pending = useRef(new Set());
  useEffect(() => {
    if (!boards) return;
    const stale = boards.filter((b) => b.elements > 0 && b.thumb < b.updated && !pending.current.has(b.file));
    stale.forEach((b) => pending.current.add(b.file));
    (async () => {
      for (const b of stale) {
        const v = await makeThumb(b.file).catch(() => null);
        pending.current.delete(b.file);
        setThumbs((t) => ({ ...t, [b.file]: v || -1 }));
      }
    })();
  }, [boards]);

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(""), 2500);
  };
  const pick = (id) => {
    setSection(id);
    history.replaceState(null, "", id === "all" ? "/" : `/?view=${id}`);
  };
  const changeSort = (v) => {
    setSort(v);
    try { localStorage.setItem("sort", v); } catch {}
  };

  const current = SECTIONS.find((s) => s.id === section) || SECTIONS[0];
  const matches = (b) => title(b.file).toLowerCase().includes(query.trim().toLowerCase());
  const shown = useMemo(() => {
    if (!boards) return null;
    let list = boards.filter((b) => current.test(b, shares) && matches(b));
    if (sort === "name") list = [...list].sort((a, b) => title(a.file).localeCompare(title(b.file), "ru"));
    if (sort === "oldest") list = [...list].reverse();
    return [...list.filter((b) => b.pinned), ...list.filter((b) => !b.pinned)]; // закреплённые — первыми
  }, [boards, shares, current, query, sort]);

  const importFiles = async (files) => {
    let last;
    for (const f of files) {
      try {
        const scene = JSON.parse(await f.text());
        last = (await api("/api/boards", "POST", { name: f.name.replace(/\.(excalidraw|json)$/i, ""), scene })).file;
      } catch (e) {
        flash(`${f.name}: ${e instanceof SyntaxError ? "это не файл Excalidraw" : e.message}`);
      }
    }
    if (files.length === 1 && last) location.href = boardUrl(last);
    else { load(); if (last) flash(`Импортировано: ${files.length}`); }
  };

  const act = async (type, b) => {
    try {
      if (type === "duplicate") {
        await api("/api/boards", "POST", { name: `${title(b.file)} — копия`, from: b.file });
        flash("Копия создана");
      } else if (type === "pin") {
        await api(`/api/boards?file=${encodeURIComponent(b.file)}`, "PATCH", { pinned: !b.pinned });
        flash(b.pinned ? "Доска откреплена" : "Доска закреплена наверху");
      } else if (type === "png") {
        flash("Готовлю PNG…");
        await downloadPng(b.file);
        return;
      } else return setDialog({ type, board: b });
      await load();
    } catch (e) { flash(e.message); }
  };

  const search = (
    <label className="search">
      <Icon name="search" size={16} />
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск досок" aria-label="Поиск досок" />
      {query ? <button className="clear" onClick={() => setQuery("")} aria-label="Очистить"><Icon name="x" size={14} /></button> : <kbd>Ctrl K</kbd>}
    </label>
  );
  const nav = SECTIONS.map((s) => {
    const n = boards && !query.trim() ? boards.filter((b) => s.test(b, shares)).length : ""; // во время поиска счётчиков нет
    return (
      <button key={s.id} className="nav-item" aria-current={section === s.id} onClick={() => pick(s.id)}>
        <Icon name={s.icon} size={17} /> {s.label}<span className="count">{n}</span>
      </button>
    );
  });

  // Файл .excalidraw, брошенный на страницу, — импорт.
  const drop = {
    onDragOver: (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setDragging(true); } },
    onDragLeave: (e) => e.currentTarget === e.target && setDragging(false),
    onDrop: (e) => { e.preventDefault(); setDragging(false); importFiles([...e.dataTransfer.files]); },
  };

  return (
    <div className="ui app" {...drop}>
      <aside className="side">
        <a className="brand" href="/"><img src="/favicon.svg" alt="" /><span>Excalidraw</span></a>
        {search}
        {nav}
        <div className="side-bottom">
          <div className="nav-title">Тема</div>
          <ThemeSwitch choice={themeChoice} />
        </div>
      </aside>

      <header className="topbar">
        <a className="brand" href="/" aria-label="Excalidraw"><img src="/favicon.svg" alt="" /></a>
        {search}
        <button className="btn btn-ghost icon-btn" onClick={() => setView(true)} aria-label="Порядок и тема" title="Порядок и тема">
          <Icon name="sliders" size={19} />
        </button>
      </header>

      <main className="content">
        <div className="tabs">{nav}</div>
        <div className="head">
          <div>
            <h1>{current.label}</h1>
            <p>{shown ? plural(shown.length, "доска", "доски", "досок") : " "}{current.hint && ` · ${current.hint}`}</p>
          </div>
          <select className="sort" value={sort} onChange={(e) => changeSort(e.target.value)} aria-label="Порядок досок">
            {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>

        <div className="actions" hidden={!!query.trim()}>
          <button className="action" onClick={() => setDialog({ type: "create" })}>
            <span className="badge"><Icon name="plus" size={20} /></span>
            <span><b>Новая доска</b><small>Пустой холст</small></span>
          </button>
          <button className="action" onClick={() => importRef.current.click()} title="Файл можно и просто перетащить на страницу">
            <span className="badge"><Icon name="import" size={19} /></span>
            <span><b>Импорт</b><small>Файлы .excalidraw</small></span>
          </button>
          <input ref={importRef} type="file" accept=".excalidraw,.json,application/json" multiple hidden
            onChange={(e) => { importFiles([...e.target.files]); e.target.value = ""; }} />
        </div>

        {shown && !shown.length ? (
          <div className="empty">
            <b>{query ? "Ничего не нашлось" : "Здесь пока пусто"}</b>
            {query ? `Нет досок, в названии которых есть «${query.trim()}».`
              : section === "shared" ? "Открыть доску по ссылке можно в её меню: «Поделиться…»."
              : section === "pinned" ? "Закрепите доску в её меню, и она будет всегда наверху." : "Создайте первую доску."}
            {query && (
              <div className="empty-actions">
                <button className="btn btn-primary" onClick={() => setDialog({ type: "create", name: query.trim() })}>
                  <Icon name="plus" size={16} />Создать доску «{query.trim().length > 30 ? query.trim().slice(0, 29) + "…" : query.trim()}»
                </button>
                <button className="btn btn-ghost" onClick={() => setQuery("")}>Сбросить поиск</button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid">
            {(shown || Array.from({ length: 8 }, (_, i) => ({ skeleton: i }))).map((b) => b.skeleton !== undefined ? (
              <div key={b.skeleton} className="card"><div className="thumb"><div className="placeholder loading" /></div>
                <div className="card-info"><div className="card-text"><div className="card-name">&nbsp;</div></div></div></div>
            ) : (
              <Card key={b.file} board={{ ...b, thumb: Math.max(thumbs[b.file] || 0, b.thumb) || thumbs[b.file] || 0 }}
                share={shares[b.file]} dark={theme === "dark"} onAction={(type) => act(type, b)}
                onRenamed={() => load()} onError={flash} />
            ))}
          </div>
        )}
      </main>

      {view && (
        <div className="sheet">
          <div className="sheet-backdrop" onPointerDown={() => setView(false)} />
          <div className="menu" role="menu">
            <span className="sheet-title"><i />Порядок</span>
            {SORTS.map(([id, label]) => (
              <button key={id} role="menuitemradio" aria-checked={sort === id} onClick={() => { changeSort(id); setView(false); }}>
                {label}{sort === id && <Icon name="check" size={17} className="tick" />}
              </button>
            ))}
            <hr />
            <div className="sheet-row">Тема <ThemeSwitch choice={themeChoice} /></div>
          </div>
        </div>
      )}
      {dialog?.type === "create" && <NameDialog title="Новая доска" action="Создать" initial={dialog.name || ""}
        onClose={() => setDialog(null)}
        onSubmit={async (name) => { location.href = boardUrl((await api("/api/boards", "POST", { name })).file); }} />}
      {dialog?.type === "delete" && <DeleteDialog board={dialog.board} onClose={() => setDialog(null)}
        onDone={() => { setDialog(null); load(); flash("Доска удалена"); }} />}
      {dialog?.type === "share" && <ShareDialog file={dialog.board.file} onClose={() => { setDialog(null); load(); }} />}
      {dragging && <div className="drop-hint"><div><Icon name="import" size={28} />Отпустите файл .excalidraw, чтобы импортировать</div></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

export function ThemeSwitch({ choice }) {
  return (
    <div className="theme-switch" role="group" aria-label="Тема">
      {THEMES.map(([id, icon, label]) => (
        <button key={id} aria-pressed={choice === id} onClick={() => setChoice(id)} title={`Тема: ${label.toLowerCase()}`} aria-label={`Тема: ${label.toLowerCase()}`}>
          <Icon name={icon} size={16} />
        </button>
      ))}
    </div>
  );
}

function Card({ board: b, share, dark, onAction, onRenamed, onError }) {
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false); // false, "down" или "up" — куда открыть, чтобы влезло
  const ref = useRef();
  const menuRef = useRef();
  const toggle = () => setMenu(menu ? false : "down");
  // Открываем вниз; не влезло в окно, а сверху места хватает — вверх.
  useLayoutEffect(() => {
    if (menu !== "down" || matchMedia("(max-width: 760px)").matches) return;
    const r = menuRef.current.getBoundingClientRect();
    if (r.bottom > innerHeight - 8 && r.height + 60 < r.top) setMenu("up");
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => (e.type === "keydown" ? e.key === "Escape"
      : !ref.current.contains(e.target) || e.target.classList.contains("sheet-backdrop")) && setMenu(false);
    addEventListener("pointerdown", close);
    addEventListener("keydown", close);
    return () => { removeEventListener("pointerdown", close); removeEventListener("keydown", close); };
  }, [menu]);

  const item = (icon, label, run, cls) => (
    <button className={cls} onClick={() => { setMenu(false); run(); }}><Icon name={icon} size={17} />{label}</button>
  );
  const name = title(b.file);
  return (
    <div className="card" ref={ref}>
      <a href={boardUrl(b.file)} title={name}>
        <div className="thumb">
          {b.thumb > 0
            ? <img src={thumbUrl(b, dark)} alt="" loading="lazy" />
            : b.elements && b.thumb !== -1
              ? <div className="placeholder loading" />
              : <div className="placeholder"><div><Icon name="empty" size={26} />{b.elements ? "Нет превью" : "Пустая доска"}</div></div>}
          <span className="chips">
            {b.slides > 0 && <span className="chip slides-chip"><Icon name="slides" size={13} />{plural(b.slides, "слайд", "слайда", "слайдов")}</span>}
            {share && <span className="chip share-chip" title={share.mode === "edit" ? "Открыта по ссылке, по ней можно править" : "Открыта по ссылке, по ней можно смотреть"}>
              <Icon name="link" size={13} />{share.mode === "edit" ? "По ссылке · правка" : "По ссылке · просмотр"}</span>}
          </span>
        </div>
      </a>
      <div className="card-info">
        <div className="card-text">
          {renaming
            ? <InlineName file={b.file} onDone={(file) => { setRenaming(false); if (file) onRenamed(); }} onError={onError} />
            : <div className="card-name" onDoubleClick={() => setRenaming(true)}>{b.pinned && <Icon name="pin" size={14} className="pinned" aria-label="Закреплена" />}{name}</div>}
          <div className="card-meta" title={`Изменена ${new Date(b.updated).toLocaleString("ru-RU")}`}>{ago(b.updated)}</div>
        </div>
        <button className="more" aria-label={`Действия с доской ${name}`} aria-haspopup="menu" aria-expanded={!!menu} onClick={toggle}>
          <Icon name="more" size={20} strokeWidth="3" />
        </button>
        {menu && <div className="sheet-backdrop" />}
        {menu && (
          <div className={`menu ${menu}`} role="menu" ref={menuRef}>
            <span className="sheet-title"><i />{name}</span>
            {item("pencil", "Переименовать", () => setRenaming(true))}
            {item("link", "Поделиться…", () => onAction("share"))}
            {item("pin", b.pinned ? "Открепить" : "Закрепить наверху", () => onAction("pin"))}
            {b.slides > 0 && item("play", "Показать слайды", () => open(boardUrl(b.file, "/present")))}
            {item("image", "Скачать PNG", () => onAction("png"))}
            {b.slides > 0 && item("pdf", "Скачать слайды в PDF", () => open(`/api/pdf?file=${encodeURIComponent(b.file)}`))}
            {item("copy", "Создать копию", () => onAction("duplicate"))}
            <hr />
            {item("trash", "Удалить…", () => onAction("delete"), "danger")}
          </div>
        )}
      </div>
    </div>
  );
}

export function DeleteDialog({ board, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    await api(`/api/boards?file=${encodeURIComponent(board.file)}`, "DELETE").catch(() => {});
    onDone();
  };
  return (
    <Dialog onClose={onClose} label="Удалить доску">
      <h2>Удалить «{title(board.file)}»?</h2>
      <p>Доска пропадёт из списка, ссылка на неё перестанет работать. Файл останется на сервере в папке удалённых, вернуть его можно вручную.</p>
      <div className="buttons">
        <button className="btn btn-secondary" onClick={onClose} autoFocus>Отмена</button>
        <button className="btn btn-danger" disabled={busy} onClick={remove}>Удалить</button>
      </div>
    </Dialog>
  );
}
