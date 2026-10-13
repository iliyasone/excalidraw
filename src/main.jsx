// Роутер: список досок грузится сразу, редактор и показ (с самим Excalidraw) — только когда нужны.
import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import { Home } from "./home.jsx";

const Editor = lazy(() => import("./editor.jsx").then((m) => ({ default: m.Editor })));
const Presenter = lazy(() => import("./present.jsx").then((m) => ({ default: m.Presenter })));

const file = new URLSearchParams(location.search).get("file");

createRoot(document.getElementById("root")).render(
  !file ? <Home /> : (
    <Suspense fallback={null}>
      {location.pathname === "/present" ? <Presenter file={file} /> : <Editor />}
    </Suspense>
  ),
);
