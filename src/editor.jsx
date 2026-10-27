import { useEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu, restore, exportToSvg, reconcileElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { fetchScene, fetchFiles } from "./scene.js";
import { share, boardQuery } from "./access.js";
import { ShareDialog } from "./share.jsx";

window.exportToSvg = exportToSvg; // для scripts/pdf.mjs и scripts/shot.mjs

const client = Math.random().toString(36).slice(2); // id вкладки: сервер не шлёт ей её же записи

const gone = <p style={{ font: "16px system-ui", padding: 40, color: "#555" }}>Ссылка не действует: доступ к доске закрыли.</p>;

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
  const onChange = () => {
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
      langCode="ru-RU"
      name={file}
    >
      {share ? (
        // По ссылке — ни списка досок, ни показа, ни PDF: только эта доска.
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
        </MainMenu>
      ) : (
        <MainMenu>
          <MainMenu.Item onSelect={() => (location.href = "/")}>Все доски</MainMenu.Item>
          <MainMenu.Item onSelect={() => setSharing(true)}>Поделиться ссылкой…</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Item onSelect={() => open(`/present?file=${encodeURIComponent(file)}`)}>
            Показ
          </MainMenu.Item>
          <MainMenu.Item onSelect={() => open(`/api/pdf?file=${encodeURIComponent(file)}`)}>
            Слайды в PDF
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      )}
    </Excalidraw>
    {sharing && <ShareDialog file={file} onClose={() => setSharing(false)} />}
  </>);
}
