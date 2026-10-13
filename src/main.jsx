import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu, serializeAsJSON, restore, exportToSvg } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { Presenter } from "./present.jsx";

window.exportToSvg = exportToSvg; // для scripts/pdf.mjs и scripts/shot.mjs

const file = new URLSearchParams(location.search).get("file") || "parallel.excalidraw";
const client = Math.random().toString(36).slice(2); // id вкладки: сервер не шлёт ей её же записи
const url = `/api/scene?file=${encodeURIComponent(file)}&client=${client}`;

function App() {
  const [initial, setInitial] = useState(null);
  const api = useRef(null);
  const lastSaved = useRef("");
  const timer = useRef(null);

  const load = async () => {
    const text = await (await fetch(url)).text();
    lastSaved.current = text;
    return restore(JSON.parse(text), null, null);
  };

  useEffect(() => {
    load().then((d) => setInitial(d));
    // Файл поменяли снаружи (агент) — подтягиваем без перезагрузки страницы.
    const es = new EventSource(`/api/events?file=${encodeURIComponent(file)}&client=${client}`);
    es.onmessage = async () => {
      if (!api.current) return;
      const d = await load();
      api.current.addFiles(Object.values(d.files || {}));
      api.current.updateScene({ elements: d.elements });
    };
    return () => es.close();
  }, []);

  const onChange = (elements, appState, files) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const text = serializeAsJSON(elements, appState, files, "local");
      if (text === lastSaved.current) return;
      lastSaved.current = text;
      await fetch(url, { method: "PUT", body: text });
    }, 600);
  };

  if (!initial) return null;
  return (
    <Excalidraw
      initialData={initial}
      excalidrawAPI={(a) => {
        api.current = window.excalidrawAPI = a;
        setTimeout(() => a.scrollToContent(undefined, { fitToContent: true }), 100);
      }}
      onChange={onChange}
      langCode="ru-RU"
      name={file}
    >
      <MainMenu>
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

createRoot(document.getElementById("root")).render(
  location.pathname === "/present" ? <Presenter file={file} /> : <App />,
);
