export const KEY_POSITION_MAP: Record<string, { x: number; y: number }> = {
  "1": { x: 0, y: 0 },
  "2": { x: 1, y: 0 },
  "3": { x: 2, y: 0 },
  "4": { x: 3, y: 0 },
  "5": { x: 4, y: 0 },
  "6": { x: 5, y: 0 },
  "7": { x: 6, y: 0 },
  "8": { x: 7, y: 0 },
  "9": { x: 8, y: 0 },
  "0": { x: 9, y: 0 },
  "-": { x: 10, y: 0 },
  "=": { x: 11, y: 0 },
  q: { x: 0.5, y: 1 },
  w: { x: 1.5, y: 1 },
  e: { x: 2.5, y: 1 },
  r: { x: 3.5, y: 1 },
  t: { x: 4.5, y: 1 },
  y: { x: 5.5, y: 1 },
  u: { x: 6.5, y: 1 },
  i: { x: 7.5, y: 1 },
  o: { x: 8.5, y: 1 },
  p: { x: 9.5, y: 1 },
  "[": { x: 10.5, y: 1 },
  "]": { x: 11.5, y: 1 },
  a: { x: 0.9, y: 2 },
  s: { x: 1.9, y: 2 },
  d: { x: 2.9, y: 2 },
  f: { x: 3.9, y: 2 },
  g: { x: 4.9, y: 2 },
  h: { x: 5.9, y: 2 },
  j: { x: 6.9, y: 2 },
  k: { x: 7.9, y: 2 },
  l: { x: 8.9, y: 2 },
  ";": { x: 9.9, y: 2 },
  "'": { x: 10.9, y: 2 },
  z: { x: 1.3, y: 3 },
  x: { x: 2.3, y: 3 },
  c: { x: 3.3, y: 3 },
  v: { x: 4.3, y: 3 },
  b: { x: 5.3, y: 3 },
  n: { x: 6.3, y: 3 },
  m: { x: 7.3, y: 3 },
  ",": { x: 8.3, y: 3 },
  ".": { x: 9.3, y: 3 },
  "/": { x: 10.3, y: 3 },
} as const;

/** Bounds in layout units (each key is 1×1; positions may be fractional). */
export const KEYBOARD_BOUNDS = (() => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { x, y } of Object.values(KEY_POSITION_MAP)) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + 1);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + 1);
  }
  return { minX, maxX, minY, maxY };
})();

export const KEYBOARD_WIDTH_UNITS = KEYBOARD_BOUNDS.maxX - KEYBOARD_BOUNDS.minX;
export const KEYBOARD_HEIGHT_UNITS = KEYBOARD_BOUNDS.maxY - KEYBOARD_BOUNDS.minY;
