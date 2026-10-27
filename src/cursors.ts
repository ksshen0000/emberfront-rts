// Context cursors drawn as inline SVG so the hover hint matches the right-click order.
const OUTLINE = "#17120d";
function cursor(body: string, x: number, y: number, fallback: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
}
const handle = (x1: number, y1: number, x2: number, y2: number) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${OUTLINE}" stroke-width="5"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#a0703f" stroke-width="2.5"/>`;

export const CURSORS = {
  attack: cursor(
    `<polygon points="3,3 9,4 22,17 17,22 4,9" fill="#e9e4d8" stroke="${OUTLINE}" stroke-width="1.5"/>` +
      `<line x1="14" y1="25" x2="25" y2="14" stroke="${OUTLINE}" stroke-width="5"/><line x1="14" y1="25" x2="25" y2="14" stroke="#d2453a" stroke-width="2.5"/>` +
      handle(21, 21, 27, 27) +
      `<circle cx="28" cy="28" r="2.2" fill="#d2453a" stroke="${OUTLINE}" stroke-width="1.2"/>`,
    3,
    3,
    "crosshair",
  ),
  mine: cursor(
    handle(10, 10, 28, 28) +
      `<path d="M2 17 Q5 5 17 2" fill="none" stroke="${OUTLINE}" stroke-width="5.5"/><path d="M2 17 Q5 5 17 2" fill="none" stroke="#e2bd5e" stroke-width="3"/>`,
    4,
    4,
    "pointer",
  ),
  chop: cursor(
    handle(6, 6, 28, 28) +
      `<path d="M8 8 L15 1 Q22 2 23 9 L14 14 Z" fill="#cfd5d2" stroke="${OUTLINE}" stroke-width="1.5"/>` +
      `<path d="M15.5 2.5 Q21 3 21.5 8.5" fill="none" stroke="#7fbf6a" stroke-width="1.5"/>`,
    18,
    4,
    "pointer",
  ),
  build: cursor(
    handle(11, 11, 28, 28) +
      `<polygon points="12.5,1.2 16.8,5.5 5.5,16.8 1.2,12.5" fill="#9aa3a6" stroke="${OUTLINE}" stroke-width="1.5"/>`,
    4,
    4,
    "pointer",
  ),
  rally: cursor(
    `<line x1="5" y1="30" x2="5" y2="3" stroke="${OUTLINE}" stroke-width="4"/><line x1="5" y1="30" x2="5" y2="3" stroke="#e9e4d8" stroke-width="2"/>` +
      `<polygon points="6,4 25,9 6,15" fill="#8bc4c0" stroke="${OUTLINE}" stroke-width="1.5"/>`,
    5,
    30,
    "pointer",
  ),
  assault: cursor(
    `<circle cx="16" cy="16" r="9" fill="none" stroke="${OUTLINE}" stroke-width="4"/><circle cx="16" cy="16" r="9" fill="none" stroke="#d2453a" stroke-width="2"/>` +
      `<path d="M16 2v8M16 22v8M2 16h8M22 16h8" stroke="${OUTLINE}" stroke-width="4"/><path d="M16 2v8M16 22v8M2 16h8M22 16h8" stroke="#d2453a" stroke-width="2"/>` +
      `<circle cx="16" cy="16" r="1.5" fill="#d2453a"/>`,
    16,
    16,
    "crosshair",
  ),
  // Neutral cursors, also drawn by the software cursor while the mouse is confined.
  arrow: cursor(
    `<path d="M3 2 L3 24 L9 18.5 L13 27 L17 25.2 L13 16.8 L21 16.8 Z" fill="#e9e4d8" stroke="${OUTLINE}" stroke-width="1.6"/>`,
    3,
    2,
    "default",
  ),
  place: cursor(
    `<path d="M16 3v9M16 20v9M3 16h9M20 16h9" stroke="${OUTLINE}" stroke-width="4"/><path d="M16 3v9M16 20v9M3 16h9M20 16h9" stroke="#e9e4d8" stroke-width="2"/>`,
    16,
    16,
    "crosshair",
  ),
};
/** Image and hotspot of a CSS cursor built above, for the software cursor. */
export function cursorImage(css: string): {
  url: string;
  x: number;
  y: number;
} {
  const m = /^url\("([^"]+)"\) (\d+) (\d+)/.exec(css || CURSORS.arrow);
  return m ? { url: m[1], x: +m[2], y: +m[3] } : cursorImage(CURSORS.arrow);
}
