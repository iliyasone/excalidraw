// Режим показа для Google Meet: стрелки листают основную колоду (data/<name>.deck.json),
// G открывает сетку всех слайдов, включая запасные; Esc возвращает туда, где был.
import { useEffect, useRef, useState } from "react";
import { restore, exportToSvg } from "@excalidraw/excalidraw";

const byPosition = (a, b) => Math.round(a.y / 100) - Math.round(b.y / 100) || a.x - b.x;

async function renderSlides(scene) {
  const { elements, files } = restore(scene, null, null);
  const live = elements.filter((e) => !e.isDeleted);
  const frames = live.filter((e) => e.type === "frame").sort(byPosition);
  const slides = [];
  for (const frame of frames) {
    const svg = await exportToSvg({
      elements: live, files, exportingFrame: frame, exportPadding: 0,
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
    });
    // Отдельный blob на слайд: у SVG разных фреймов совпадают id клипов.
    const src = URL.createObjectURL(new Blob([svg.outerHTML], { type: "image/svg+xml" }));
    slides.push({ id: frame.id, name: frame.name, src });
  }
  return slides;
}

const fetchJson = async (name) => {
  const r = await fetch(`/api/scene?file=${encodeURIComponent(name)}`);
  return r.ok ? r.json() : null;
};

export function Presenter({ file }) {
  const deckFile = file.replace(/\.excalidraw$/, "") + ".deck.json";
  const [slides, setSlides] = useState(null);
  const [deckIds, setDeckIds] = useState(null);
  const [pos, setPos] = useState(0);
  const [detour, setDetour] = useState(null); // запасной слайд поверх основной колоды
  const [grid, setGrid] = useState(false);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    const loadScene = async () => setSlides(await renderSlides(await fetchJson(file)));
    const loadDeck = async () => setDeckIds((await fetchJson(deckFile))?.slides ?? []);
    loadScene();
    loadDeck();
    const watch = (name, fn) => {
      const es = new EventSource(`/api/events?file=${encodeURIComponent(name)}`);
      es.onmessage = fn;
      return es;
    };
    const streams = [watch(file, loadScene), watch(deckFile, loadDeck)];
    return () => streams.forEach((es) => es.close());
  }, []);

  const byId = new Map((slides || []).map((s) => [s.id, s]));
  const main = deckIds?.length ? deckIds.map((id) => byId.get(id)).filter(Boolean) : slides || [];
  const mainIds = new Set(main.map((s) => s.id));
  const spare = (slides || []).filter((s) => !mainIds.has(s.id));
  const current = detour ? byId.get(detour) : main[Math.min(pos, main.length - 1)];

  const state = useRef();
  state.current = { main, grid, detour };
  useEffect(() => {
    const onKey = (e) => {
      const { main, grid, detour } = state.current;
      const go = (d) => {
        if (detour) return setDetour(null); // из запаса стрелка возвращает в колоду
        setPos((p) => Math.max(0, Math.min(main.length - 1, p + d)));
      };
      if (e.key === "g" || e.key === "п" || e.key === "Tab") { e.preventDefault(); setGrid((g) => !g); }
      else if (e.key === "Escape") { grid ? setGrid(false) : setDetour(null); }
      else if (grid) return;
      else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); go(1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === "Home") { setDetour(null); setPos(0); }
      else if (e.key === "End") { setDetour(null); setPos(main.length - 1); }
      else if (e.key === "f" || e.key === "а") {
        document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // Курсор прячется через 2 с без движения, чтобы не висел на слайде в Meet.
  useEffect(() => {
    let t;
    const move = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 2000); };
    addEventListener("mousemove", move);
    move();
    return () => removeEventListener("mousemove", move);
  }, []);

  if (!slides || !deckIds) return <div style={css.loading}>Готовлю слайды…</div>;

  const pick = (s) => {
    const i = main.findIndex((m) => m.id === s.id);
    if (i >= 0) { setDetour(null); setPos(i); } else setDetour(s.id);
    setGrid(false);
  };
  const thumb = (s, label) => (
    <button key={s.id} style={{ ...css.thumb, ...(s === current ? css.thumbCurrent : null) }} onClick={() => pick(s)}>
      <img src={s.src} style={css.thumbImg} />
      <span style={css.thumbLabel}>{label}</span>
    </button>
  );

  return (
    <div style={{ ...css.stage, cursor: idle && !grid ? "none" : "default" }}>
      {current && <img src={current.src} style={css.slide} onClick={() => !grid && setPos((p) => Math.min(main.length - 1, p + 1))} />}
      {grid && (
        <div style={css.grid}>
          <div style={css.hint}>← → листать · G сетка · Esc назад · F полный экран</div>
          <h2 style={css.h2}>Презентация · {main.length}</h2>
          <div style={css.row}>{main.map((s, i) => thumb(s, `${i + 1}. ${s.name || ""}`))}</div>
          {spare.length > 0 && <h2 style={css.h2}>Запас · {spare.length}</h2>}
          <div style={css.row}>{spare.map((s) => thumb(s, s.name || ""))}</div>
        </div>
      )}
    </div>
  );
}

const css = {
  loading: { font: "16px system-ui", color: "#888", padding: 40 },
  stage: { position: "fixed", inset: 0, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" },
  slide: { maxWidth: "100vw", maxHeight: "100vh", width: "100%", height: "100%", objectFit: "contain" },
  grid: { position: "fixed", inset: 0, background: "#f5f5f7", overflow: "auto", padding: "24px 32px", font: "14px system-ui" },
  hint: { color: "#888", marginBottom: 8 },
  h2: { font: "600 18px system-ui", margin: "20px 0 12px" },
  row: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 },
  thumb: { border: "2px solid transparent", borderRadius: 8, background: "#fff", padding: 0, cursor: "pointer", textAlign: "left", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.15)" },
  thumbCurrent: { borderColor: "#1971c2" },
  thumbImg: { width: "100%", aspectRatio: "854 / 480", display: "block", borderBottom: "1px solid #eee" },
  thumbLabel: { display: "block", padding: "6px 8px", color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
};
