import { useEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu, Sidebar, restore, exportToSvg, reconcileElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { fetchScene, fetchFiles } from "./scene.js";
import { share, boardQuery } from "./access.js";
import { ShareDialog, InlineName } from "./share.jsx";
import { useTheme, setChoice } from "./theme.js";
import { ThemeSwitch, DeleteDialog, boardUrl, title, thumbUrl, ago, plural } from "./home.jsx";
import { Icon } from "./icons.jsx";

window.exportToSvg = exportToSvg; // для scripts/pdf.mjs и scripts/shot.mjs

const client = Math.random().toString(36).slice(2); // id вкладки: сервер не шлёт ей её же записи

const gone = <p style={{ font: "16px system-ui", padding: 40, color: "#888" }}>Ссылка не действует: доступ к доске закрыли.</p>;

// Доска по ссылке /s/<токен>: имя доски и права (просмотр или правка) знает только сервер.
export function Shared() {
  const [info, setInfo] = useState(); // undefined — грузится, null — ссылку отозвали
  useEffect(() => {
    fetch(`/api/shared?${boardQuery()}`).then((r) => (r.ok ? r.json() : null)).then(setInfo, () => setInfo(null));
  }, []);
  if (info === undefined) return null;
  return info ? <Editor file={info.file} mode={info.mode} /> : gone;
}

// mode: "edit" или "view" (тогда правки не отправляются, а сервер их и не примет).
export function Editor({ file, mode = "edit" }) {
  const url = `/api/scene?${boardQuery(file)}&client=${client}`;
  const [initial, setInitial] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [slides, setSlides] = useState(0);
  useEffect(() => {
    if (share) return;
    fetch(`/api/boards?file=${encodeURIComponent(file)}`).then((r) => r.json()).then(([b]) => {
      setPinned(!!b?.pinned);
      setSlides(b?.slides || 0);
    });
  }, []);
  const pin = async () => {
    const r = await fetch(`/api/boards?file=${encodeURIComponent(file)}`, { method: "PATCH", body: JSON.stringify({ pinned: !pinned }) });
    if (r.ok) setPinned(!pinned);
  };
  const duplicate = async () => {
    const r = await fetch("/api/boards", { method: "POST", body: JSON.stringify({ name: `${title(file)} — копия`, from: file }) });
    if (r.ok) open(boardUrl((await r.json()).file));
  };
  const [themeChoice, theme] = useTheme();
  const seenTheme = useRef(theme);
  const api = useRef(null);
  const synced = useRef(new Map()); // id -> version, которую сервер уже знает
  const sentFiles = useRef(new Set());
  const timer = useRef(null);

  const remember = (elements, files) => {
    for (const e of elements) synced.current.set(e.id, e.version);
    for (const id of Object.keys(files || {})) sentFiles.current.add(id);
  };

  const pendingFiles = useRef([]); // картинки, пришедшие раньше, чем готов редактор

  const load = async () => {
    const scene = await fetchScene(file, client);
    synced.current.clear();
    remember(scene.elements, scene.files);
    fetchFiles(file, scene, (f) => (api.current ? api.current.addFiles([f]) : pendingFiles.current.push(f)));
    return restore({ ...scene, files: {} }, null, null);
  };

  useEffect(() => {
    load().then((d) => setInitial(d));
    const es = new EventSource(`/api/events?${boardQuery(file)}&client=${client}`);
    es.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      // Ссылку отозвали или сменили ей права: перезагрузка откроет доску с новыми или покажет, что доступа нет.
      if (msg.type === "share-changed") return location.reload();
      // Доску переименовали или удалили из списка досок.
      if (msg.type === "renamed" && !share) return location.replace(`/?file=${encodeURIComponent(msg.file)}`);
      if (msg.type === "deleted" || msg.type === "renamed") return location.replace(share ? location.href : "/");
      const a = api.current;
      if (!a) return;
      if (msg.type === "reload") {
        const d = await load();
        a.updateScene({ elements: d.elements, captureUpdate: CaptureUpdateAction.NEVER });
        return;
      }
      // Чужие правки (другая вкладка, агент) — сливаем по версиям, свои незаконченные не теряем.
      remember(msg.elements, msg.files);
      if (Object.keys(msg.files || {}).length) a.addFiles(Object.values(msg.files));
      const elements = reconcileElements(a.getSceneElementsIncludingDeleted(), msg.elements, a.getAppState());
      a.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    };
    // Поток закрылся насовсем (сервер ответил 403 — ссылку отозвали): перезагрузка покажет это.
    es.onerror = () => share && es.readyState === EventSource.CLOSED && location.reload();
    // Пока поток не был подключён (при открытии или после обрыва), права ссылки могли смениться.
    es.onopen = async () => {
      if (!share) return;
      const r = await fetch(`/api/shared?${boardQuery(file)}`);
      if (!r.ok || (await r.json()).mode !== mode) location.reload();
    };
    return () => es.close();
  }, []);

  // Шлём только элементы, чья версия отличается от известной серверу.
  const onChange = (_elements, appState) => {
    // Тему переключили в меню Excalidraw — запоминаем для всех страниц.
    if (appState.theme !== seenTheme.current) {
      seenTheme.current = appState.theme;
      if (appState.theme !== theme) setChoice(appState.theme);
    }
    if (mode !== "edit") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const a = api.current;
      const elements = a.getSceneElementsIncludingDeleted().filter((e) => synced.current.get(e.id) !== e.version);
      const files = Object.fromEntries(Object.entries(a.getFiles()).filter(([id]) => !sentFiles.current.has(id)));
      if (!elements.length && !Object.keys(files).length) return;
      remember(elements, files);
      const r = await fetch(url, { method: "POST", body: JSON.stringify({ elements, files }) });
      if (share && r.status === 403) location.reload();
    }, 250);
  };

  if (!initial) return null;
  return (<>
    <Excalidraw
      initialData={initial}
      excalidrawAPI={(a) => {
        api.current = window.excalidrawAPI = a;
        if (pendingFiles.current.length) a.addFiles(pendingFiles.current.splice(0));
        setTimeout(() => a.scrollToContent(undefined, { fitToContent: true }), 100);
      }}
      onChange={onChange}
      viewModeEnabled={mode === "view" || undefined}
      renderTopRightUI={(isMobile) => share ? null : (
        <span className="ui top-right">
          <Sidebar.Trigger name="boards" icon={<Icon name="panel" size={16} />} title="Список досок сбоку" />
          <button className={`btn btn-primary share-btn${isMobile ? " icon-btn" : ""}`} onClick={() => setSharing(true)} title="Поделиться доской по ссылке" aria-label="Поделиться">
            <Icon name="link" size={17} />{!isMobile && "Поделиться"}
          </button>
        </span>
      )}
      langCode="ru-RU"
      name={file.replace(/\.excalidraw$/, "")}
      theme={theme}
      UIOptions={{ canvasActions: { toggleTheme: true } }}
    >
      {share ? (
        // По ссылке — ни списка досок, ни показа, ни PDF: только эта доска.
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.ItemCustom><div className="ui menu-theme">Тема<ThemeSwitch choice={themeChoice} /></div></MainMenu.ItemCustom>
        </MainMenu>
      ) : (
        <MainMenu>
          <MainMenu.Item icon={<Icon name="boards" size={16} />} onSelect={() => (location.href = "/")}>Все доски</MainMenu.Item>
          <MainMenu.Item icon={<Icon name="pencil" size={16} />} onSelect={() => setRenaming(true)}>Переименовать</MainMenu.Item>
          <MainMenu.Item icon={<Icon name="link" size={16} />} onSelect={() => setSharing(true)}>Поделиться…</MainMenu.Item>
          <MainMenu.Item icon={<Icon name="pin" size={16} />} onSelect={pin}>{pinned ? "Открепить" : "Закрепить наверху"}</MainMenu.Item>
          {slides > 0 && (
            <MainMenu.Item icon={<Icon name="play" size={16} />} onSelect={() => open(`/present?file=${encodeURIComponent(file)}`)}>
              Показать слайды
            </MainMenu.Item>
          )}
          <MainMenu.DefaultItems.SaveAsImage />
          {slides > 0 && (
            <MainMenu.Item icon={<Icon name="pdf" size={16} />} onSelect={() => open(`/api/pdf?file=${encodeURIComponent(file)}`)}>
              Скачать слайды в PDF
            </MainMenu.Item>
          )}
          <MainMenu.Item icon={<Icon name="copy" size={16} />} onSelect={duplicate}>Создать копию</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.Item icon={<Icon name="trash" size={16} />} onSelect={() => setDeleting(true)} className="danger-item">Удалить…</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.Help />
          <MainMenu.Separator />
          <MainMenu.ItemCustom><div className="ui menu-theme">Тема<ThemeSwitch choice={themeChoice} /></div></MainMenu.ItemCustom>
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      )}
      {!share && <BoardsSidebar file={file} dark={theme === "dark"} />}
    </Excalidraw>
    <div className="ui editor-bar">
      {!share && <a className="btn btn-ghost" href="/" title="На страницу всех досок"><Icon name="back" size={16} />Все доски</a>}
      {!share && <span className="divider" />}
      {share ? <span className="name">{file.replace(/\.excalidraw$/, "")}</span> : (
        renaming
          ? <InlineName file={file} className="name" onDone={(f) => (f ? location.replace(boardUrl(f)) : setRenaming(false))} onError={alert} />
          : <button className="btn btn-ghost name" onClick={() => setRenaming(true)} title="Переименовать">
              <span>{file.replace(/\.excalidraw$/, "")}</span><Icon name="pencil" size={14} className="edit-icon" />
            </button>
      )}
    </div>
    {sharing && <ShareDialog file={file} onClose={() => setSharing(false)} />}
    {deleting && <DeleteDialog board={{ file }} onClose={() => setDeleting(false)} onDone={() => location.replace("/")} />}
  </>);
}

// Боковая панель «Доски»: перейти на другую доску, не выходя на страницу всех досок.
// Порядок как на странице всех досок: закреплённые сверху, дальше — недавние.
function BoardsSidebar({ file, dark }) {
  const [boards, setBoards] = useState(null);
  const [query, setQuery] = useState("");
  const [docked, setDocked] = useState(false);
  const q = query.trim().toLowerCase();
  const list = (boards || []).filter((b) => title(b.file).toLowerCase().includes(q));
  return (
    <Sidebar name="boards" docked={docked} onDock={setDocked}
      onStateChange={(s) => s?.name === "boards" && fetch("/api/boards").then((r) => r.json()).then(setBoards)}>
      <Sidebar.Header><span className="ui boards-title">Доски</span></Sidebar.Header>
      <div className="ui boards-list">
        <label className="search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск досок" aria-label="Поиск досок" />
        </label>
        <a className="boards-item new" href="/?new=1"><span className="mini"><Icon name="plus" size={18} /></span><span className="text"><b>Новая доска</b></span></a>
        {[...list.filter((b) => b.pinned), ...list.filter((b) => !b.pinned)].map((b) => (
          <a key={b.file} href={boardUrl(b.file)} aria-current={b.file === file} className="boards-item">
            <span className="mini">{b.thumb > 0 && <img src={thumbUrl(b, dark)} alt="" loading="lazy" />}</span>
            <span className="text">
              <b>{b.pinned && <Icon name="pin" size={13} className="pinned" />}{title(b.file)}</b>
              <small>{ago(b.updated)}{b.slides > 0 && ` · ${plural(b.slides, "слайд", "слайда", "слайдов")}`}</small>
            </span>
          </a>
        ))}
        {boards && !list.length && <p className="boards-empty">Ничего не нашлось</p>}
      </div>
    </Sidebar>
  );
}
