import { pxDist, slugify, svgPoints, toNorm } from './geometry';

describe('geometry', () => {
  const rect = { left: 100, top: 50, width: 640, height: 360 };
  it('normalises and clamps pointer positions', () => {
    expect(toNorm(420, 230, rect)).toEqual([0.5, 0.5]);
    expect(toNorm(0, 1000, rect)).toEqual([0, 1]);
    expect(toNorm(100 + 640 / 3, 50, rect)).toEqual([0.3333, 0]);
  });
  it('measures in pixels and renders SVG points', () => {
    expect(pxDist([0, 0], [0.5, 0], 640, 360)).toBe(320);
    expect(svgPoints([[0.1, 0.2], [0.5, 0.5]])).toBe('100,200 500,500');
  });
  it('slugifies labels into keys', () => {
    expect(slugify('Gate area')).toBe('gate-area');
    expect(slugify('  Operator / Press 3 ')).toBe('operator-press-3');
    expect(slugify('!!!')).toBe('zone');
  });
});
