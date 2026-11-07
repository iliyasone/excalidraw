// Тема всех страниц: "light", "dark" или "system" (как в системе). Выбор хранится в браузере,
// index.html ставит data-theme на <html> ещё до загрузки скриптов, чтобы не мигало белым.
import { useEffect, useState } from "react";

const KEY = "theme";
const media = matchMedia("(prefers-color-scheme: dark)");

export const getChoice = () => {
  try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; }
};
const resolve = (choice) => (choice === "system" ? (media.matches ? "dark" : "light") : choice);

const listeners = new Set();
const apply = () => {
  const theme = resolve(getChoice());
  document.documentElement.dataset.theme = theme;
  for (const l of listeners) l();
};
media.addEventListener("change", apply);
addEventListener("storage", (e) => e.key === KEY && apply()); // выбор в другой вкладке

export function setChoice(choice) {
  try { localStorage.setItem(KEY, choice); } catch {}
  apply();
}

// [выбор, тема на экране]
export function useTheme() {
  const [, render] = useState(0);
  useEffect(() => {
    const l = () => render((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return [getChoice(), resolve(getChoice())];
}
