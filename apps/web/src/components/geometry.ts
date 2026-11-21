import type { Point } from '../api/types';

/** Pointer position inside an element -> normalised [x, y] (0..1, 4 decimals). */
export function toNorm(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Point {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const r = (v: number) => Math.round(v * 10_000) / 10_000;
  return [r(clamp((clientX - rect.left) / rect.width)), r(clamp((clientY - rect.top) / rect.height))];
}

/** Distance between normalised points, in pixels of an element of size w x h. */
export function pxDist(a: Point, b: Point, w: number, h: number) {
  return Math.hypot((a[0] - b[0]) * w, (a[1] - b[1]) * h);
}

/** SVG points attribute for a polygon in a 0..1000 x 0..1000 viewBox. */
export const svgPoints = (pts: Point[]) => pts.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ');

/** Lowercase-dash key from a label: "Gate area" -> "gate-area". */
export function slugify(label: string) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'zone'
  );
}
