// Порядок слайдов и колоды; общий для браузера (показ) и node-скриптов (PDF, скриншоты).

// Фреймы по рядам: новый ряд, когда фрейм ниже начала текущего больше чем на полвысоты.
export function frameRows(elements) {
  const frames = elements.filter((e) => e.type === "frame" && !e.isDeleted).sort((a, b) => a.y - b.y);
  const rows = [];
  for (const f of frames) {
    const row = rows.at(-1);
    if (row && f.y - row[0].y < row[0].height / 2) row.push(f);
    else rows.push([f]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}

export const orderedFrames = (elements) => frameRows(elements).flat();

// Колода: {"row": 1, "dropLast": 3} — первый ряд как он есть на доске, без последних трёх;
// или {"slides": [frameId, …]} — явный список. Без колоды — все фреймы.
export function deckFrames(elements, deck) {
  if (!deck) return orderedFrames(elements);
  if (deck.row) {
    const row = frameRows(elements)[deck.row - 1] || [];
    return row.slice(0, row.length - (deck.dropLast || 0));
  }
  const byId = new Map(orderedFrames(elements).map((f) => [f.id, f]));
  return deck.slides.map((id) => byId.get(id)).filter(Boolean);
}
