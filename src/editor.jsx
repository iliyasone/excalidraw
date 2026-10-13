import { useEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu, restore, exportToSvg, reconcileElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { fetchScene, fetchFiles } from "./scene.js";

window.exportToSvg = exportToSvg; // для scripts/pdf.mjs и scripts/shot.mjs

const file = new URLSearchParams(location.search).get("file");
const client = Math.random().toString(36).slice(2); // id вкладки: сервер не шлёт ей её же записи
const url = `/api/scene?file=${encodeURIComponent(file)}&client=${client}`;

export function Editor() {
  const [initial, setInitial] = useState(null);
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
    const es = new EventSource(`/api/events?file=${encodeURIComponent(file)}&client=${client}`);
    es.onmessage = async (ev) => {
      const a = api.current;
      if (!a) return;
      const msg = JSON.parse(ev.data);
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
    return () => es.close();
  }, []);

  // Шлём только элементы, чья версия отличается от известной серверу.
  const onChange = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const a = api.current;
      const elements = a.getSceneElementsIncludingDeleted().filter((e) => synced.current.get(e.id) !== e.version);
      const files = Object.fromEntries(Object.entries(a.getFiles()).filter(([id]) => !sentFiles.current.has(id)));
      if (!elements.length && !Object.keys(files).length) return;
      remember(elements, files);
      await fetch(url, { method: "POST", body: JSON.stringify({ elements, files }) });
    }, 250);
  };

  if (!initial) return null;
  return (
    <Excalidraw
      initialData={initial}
      excalidrawAPI={(a) => {
        api.current = window.excalidrawAPI = a;
        if (pendingFiles.current.length) a.addFiles(pendingFiles.current.splice(0));
        setTimeout(() => a.scrollToContent(undefined, { fitToContent: true }), 100);
      }}
      onChange={onChange}
      langCode="ru-RU"
      name={file}
    >
      <MainMenu>
        <MainMenu.Item onSelect={() => (location.href = "/")}>Все доски</MainMenu.Item>
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
    </Excalidraw>
  );
}
