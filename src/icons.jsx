// Minimal monochrome icon set (stroke-based, inherits currentColor) standing in
// for the SF Symbols used in the Swift app.
const P = {
  search: "M11 4a7 7 0 105.2 11.7L21 20M11 4a7 7 0 00-7 7",
  stop: "M6 6h12v12H6z",
  trash: "M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13",
  lock: "M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  folderPlus: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2zM12 11v5M9.5 13.5h5",
  folderQ: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  x: "M6 6l12 12M18 6L6 18",
  chevDown: "M6 9l6 6 6-6",
  chevRight: "M9 6l6 6-6 6",
  chevUp: "M6 15l6-6 6 6",
  merge: "M7 4v6a5 5 0 005 5h5M17 12l3 3-3 3M7 20V10",
  doc: "M7 3h7l4 4v14H7zM14 3v4h4",
  docDoc: "M8 8h9v12H8zM5 5h9v2M5 5v10",
  link: "M9 15l6-6M8 12l-2 2a3 3 0 104 4l2-2M16 12l2-2a3 3 0 10-4-4l-2 2",
  photo: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6",
  sparkles: "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z",
  drive: "M4 13h16v5H4zM6 16h2M4 13l2-7h12l2 7",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4",
  eyeSlash: "M3 3l18 18M10.5 10.6a2 2 0 002.8 2.8M6.5 6.6C4.6 7.9 3 10 3 12c0 0 3 6 9 6 1.6 0 3-.4 4.2-1M9.7 5.2A9 9 0 0112 5c6 0 9 6 9 6a15 15 0 01-2 2.7",
  play: "M5 4h11v5H5zM5 11h14v9H5zM18 6l3 2-3 2",
  check: "M5 12l4 4L19 6",
  reveal: "M3 5h18v14H3zM8 9h8M8 13h5",
  upload: "M12 16V4M8 8l4-4 4 4M5 20h14",
  stack: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  filter: "M4 5h16l-6 8v6l-4-2v-4z",
  branch: "M6 4v10a3 3 0 003 3h6M16 14l3 3-3 3M18 4a2 2 0 11-4 0 2 2 0 014 0zM8 4a2 2 0 11-4 0 2 2 0 014 0z",
};

export function Icon({ name, size = 14, fill = false, style }) {
  const d = P[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={fill ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
    >
      <path d={d} />
    </svg>
  );
}
