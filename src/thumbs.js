// Превью досок для списка: рисует их тот же Excalidraw, что и редактор (грузится только когда
// превью нет или оно старее доски), и отдаёт серверу — следующий раз список берёт готовые PNG.
// У доски со слайдами превью — первый слайд, иначе вся доска; огромная доска не мельчит
// дальше 0,35 от настоящего размера — тогда видно её левый верхний угол, где обычно заголовок.
// Рисуем два: для светлой и тёмной темы (тёмное — как холст Excalidraw в тёмной теме).
import { orderedFrames } from "./deck.js";

const W = 720, H = 450; // 16:10, вдвое больше карточки — чётко на экранах с плотными пикселями

let lib;
const excalidraw = () => (lib ||= import("@excalidraw/excalidraw"));
const fetchFull = async (file) => (await fetch(`/api/scene?file=${encodeURIComponent(file)}`)).json();

export async function makeThumb(file) {
  const { exportToCanvas } = await excalidraw();
  const scene = await fetchFull(file);
  const elements = scene.elements.filter((e) => !e.isDeleted);
  if (!elements.length) return null;
  const background = scene.appState?.viewBackgroundColor || "#ffffff";
  let version = null;
  for (const dark of [true, false]) { // светлое последним: по его времени список видит, что превью свежие
    const full = await exportToCanvas({
      elements,
      files: scene.files || {},
      exportingFrame: orderedFrames(elements)[0],
      appState: { exportBackground: true, viewBackgroundColor: background, exportWithDarkMode: dark },
      exportPadding: 24,
      getDimensions: (w, h) => {
        const scale = Math.min(Math.max(Math.min(W / w, H / h), 0.35), 3);
        return { width: Math.round(w * scale), height: Math.round(h * scale), scale };
      },
    });
    // Кадр 16:10: доска по центру, а если больше кадра — от левого верхнего угла.
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const ctx = out.getContext("2d");
    const edge = full.getContext("2d").getImageData(0, 0, 1, 1).data; // цвет холста (в тёмной теме — тёмный)
    ctx.fillStyle = `rgb(${edge[0]},${edge[1]},${edge[2]})`;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(full, Math.max(0, Math.round((W - full.width) / 2)), Math.max(0, Math.round((H - full.height) / 2)));
    const blob = await new Promise((r) => out.toBlob(r, "image/png"));
    const r = await fetch(`/api/thumb?file=${encodeURIComponent(file)}${dark ? "&theme=dark" : ""}`, { method: "POST", body: blob });
    version = r.ok ? (await r.json()).thumb : null;
  }
  return version;
}

// «Скачать PNG» из списка: вся доска в 2x, как «Экспорт изображения» в редакторе.
export async function downloadPng(file) {
  const { exportToBlob } = await excalidraw();
  const scene = await fetchFull(file);
  const blob = await exportToBlob({
    elements: scene.elements.filter((e) => !e.isDeleted),
    files: scene.files || {},
    appState: { exportBackground: true, viewBackgroundColor: scene.appState?.viewBackgroundColor || "#ffffff" },
    exportPadding: 24,
    getDimensions: (w, h) => {
      const scale = Math.min(2, 8000 / Math.max(w, h)); // не больше 8000 px по стороне: слишком большой холст браузер не нарисует
      return { width: Math.round(w * scale), height: Math.round(h * scale), scale };
    },
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.replace(/\.excalidraw$/, "") + ".png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
