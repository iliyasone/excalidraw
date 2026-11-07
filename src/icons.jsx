// Иконки интерфейса (контуры 24×24, цвет — currentColor).
const paths = {
  plus: "M12 5v14M5 12h14",
  import: "M8 8V4a1 1 0 0 1 1-1h6l5 5v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2M15 3v5h5M3 13h10M10 10l3 3-3 3",
  back: "M15 18l-6-6 6-6",
  panel: "M4 4h16v16H4zM15 4v16",
  pin: "M9 4h6M10 4v6l-3 4h10l-3-4V4M12 14v6",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
  image: "M4 5h16v14H4zM4 16l4-4 3 3 4-5 5 6M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  renew: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
  boards: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  slides: "M3 4h18M4 4v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V4M12 16v4M8 20h8",
  link: "M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  monitor: "M3 5h18v11H3zM8 20h8M12 16v4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  pencil: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  play: "M7 4l13 8-13 8z",
  pdf: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M12 12v6M9 15l3 3 3-3",
  x: "M6 6l12 12M18 6L6 18",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  check: "M5 12l5 5L20 7",
  empty: "M4 4h16v16H4zM4 15l5-5 4 4 3-3 4 4",
};

export function Icon({ name, size = 18, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}
