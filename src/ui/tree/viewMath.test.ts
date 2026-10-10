import { describe, expect, it } from 'vitest';
import { geometry, GX, GY, PAD } from '../../domain/layout';
import { cellAt, cellBox, edgeSpeed } from './arrange';
import { tipPosition } from './Tooltip';
import {
  centerView,
  clampK,
  clampView,
  fitView,
  homeView,
  labelsHidden,
  nearEdge,
  snapK,
  stepK,
  visibleBox,
  wheelPan,
  wheelZoom,
  zoomAround,
  type VisBox,
} from './viewMath';

const box: VisBox = { w: 800, h: 600, t: 0 };
const bounds = { x0: -4, x1: 500, y0: 6, y1: 300 };

describe('clampView', () => {
  it('keeps the middle of the visible box over the bounds', () => {
    // the middle (400, 300) may not go left of x0 or above y0...
    expect(clampView({ x: 1000, y: 1000, k: 1 }, box, bounds)).toEqual({ x: 404, y: 294, k: 1 });
    // ...nor right of x1 or below y1
    expect(clampView({ x: -1000, y: -1000, k: 1 }, box, bounds)).toEqual({ x: -100, y: 0, k: 1 });
    // inside: unchanged
    expect(clampView({ x: 100, y: 100, k: 1 }, box, bounds)).toEqual({ x: 100, y: 100, k: 1 });
  });

  it('scales the bounds with the zoom and uses the visible part only', () => {
    expect(clampView({ x: -1000, y: 0, k: 2 }, box, bounds).x).toBe(400 - 500 * 2);
    // with a banner on top (t = 100) the middle is at y = 350
    expect(clampView({ x: 0, y: 1000, k: 1 }, { w: 800, h: 600, t: 100 }, bounds).y).toBe(350 - 6);
  });
});

describe('zoom levels', () => {
  it('clamps to 0.3..2', () => {
    expect(clampK(0.1)).toBe(0.3);
    expect(clampK(5)).toBe(2);
    expect(clampK(1.2)).toBe(1.2);
  });

  it('snaps down to a level', () => {
    expect(snapK(1.9)).toBe(1.5);
    expect(snapK(1)).toBe(1);
    expect(snapK(0.9999999)).toBe(1);
    expect(snapK(0.74)).toBe(0.5);
    expect(snapK(3)).toBe(2);
    // below the smallest level: as is, but never under 0.3
    expect(snapK(0.44)).toBe(0.44);
    expect(snapK(0.1)).toBe(0.3);
  });

  it('steps through the levels', () => {
    expect(stepK(1, 1)).toBe(1.5);
    expect(stepK(1.5, 1)).toBe(2);
    expect(stepK(2, 1)).toBe(2);
    expect(stepK(1.2, 1)).toBe(1.5);
    expect(stepK(1, -1)).toBe(0.75);
    expect(stepK(0.5, -1)).toBe(0.4);
    expect(stepK(0.3, -1)).toBe(0.3);
    expect(stepK(0.44, 1)).toBe(0.5);
  });

  it('zooms around a point', () => {
    const v = zoomAround({ x: 0, y: 0, k: 1 }, 100, 50, 2);
    expect(v).toEqual({ x: -100, y: -50, k: 2 });
    // the world point under (100, 50) stays put
    expect((100 - v.x) / v.k).toBe(100);
    expect(zoomAround({ x: 0, y: 0, k: 1 }, 0, 0, 9).k).toBe(2);
  });
});

describe('labels', () => {
  it('hide below 0.7, and below 1 on low-density screens', () => {
    expect(labelsHidden(1, 1)).toBe(false);
    expect(labelsHidden(0.75, 2)).toBe(false);
    expect(labelsHidden(0.75, 1)).toBe(true);
    expect(labelsHidden(0.5, 3)).toBe(true);
    expect(labelsHidden(1.5, 1)).toBe(false);
  });
});

describe('homeView', () => {
  const small = geometry([
    { id: 'r', x: 0, y: 0, parents: [] },
    { id: 'a', x: 1, y: -1, parents: ['r'] },
    { id: 'b', x: 1, y: 1, parents: ['r'] },
  ], GY);
  const nodes = small.nodes.map(p => ({ cx: p.cx, cy: p.cy, open: p.n.id !== 'r', root: p.n.x === 0 }));

  it('is 1:1 and centres a tree that fits', () => {
    const v = homeView(nodes, box);
    expect(v.k).toBe(1);
    // content from cx - 52 to cx + 52 (x), cy - 30 to cy + 48 (y), centred
    const c0 = PAD - 52, c1 = PAD + GX + 52;
    expect(v.x).toBe((800 - c0 - c1) / 2);
    const y0 = PAD - 30, y1 = PAD + 2 * GY + 48;
    expect(v.y).toBe((600 - y0 - y1) / 2);
  });

  it('centres between the top bar and the reserved bottom', () => {
    const v = homeView(nodes, { w: 800, h: 600, t: 100 }, 44);
    const y0 = PAD - 30, y1 = PAD + 2 * GY + 48;
    expect(v.y).toBe(100 + (600 - 44 - 100 - y0 - y1) / 2);
  });

  it('shows the open nodes when the tree does not fit', () => {
    // a long chain; only the far end is open
    const chain = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: i, y: 0, parents: i ? [`n${i - 1}`] : [] }));
    const g = geometry(chain, GY);
    const ns = g.nodes.map(p => ({ cx: p.cx, cy: p.cy, open: p.n.id === 'n10', root: p.n.x === 0 }));
    const v = homeView(ns, { w: 400, h: 300, t: 0 });
    const open = g.nodes.find(p => p.n.id === 'n10')!;
    const sx = v.x + open.cx;
    expect(sx - 52).toBeGreaterThanOrEqual(0);
    expect(sx + 52).toBeLessThanOrEqual(400);
    // and never scrolls past the end of the content
    expect(v.x).toBeGreaterThanOrEqual(400 - (g.nodes[11].cx + 52) - 12);
  });

  it('falls back to the root when nothing is open', () => {
    const chain = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: i, y: 0, parents: i ? [`n${i - 1}`] : [] }));
    const g = geometry(chain, GY);
    const ns = g.nodes.map(p => ({ cx: p.cx, cy: p.cy, open: false, root: p.n.x === 0 }));
    const v = homeView(ns, { w: 400, h: 300, t: 0 });
    expect(v.x + PAD - 52).toBeGreaterThanOrEqual(0);
  });

  it('copes with an empty area', () => {
    expect(homeView([], box)).toEqual({ k: 1, x: 400, y: 300 });
  });
});

describe('fitView', () => {
  it('fits the content and snaps the zoom down', () => {
    const content = { x0: 0, x1: 1000, y0: 0, y1: 400 };
    const v = fitView(content, box);
    // (800 - 16) / 1000 = 0.784 → 0.75
    expect(v.k).toBe(0.75);
    expect(v.x).toBe((800 - 1000 * 0.75) / 2);
    expect(v.y).toBe((600 - 400 * 0.75) / 2);
  });

  it('never zooms in past 2 and respects the top bar', () => {
    const v = fitView({ x0: 0, x1: 100, y0: 0, y1: 100 }, { w: 800, h: 600, t: 100 });
    expect(v.k).toBe(2);
    expect(v.y).toBe(100 + (500 - 200) / 2);
  });

  it('goes below 0.5 for very large trees', () => {
    expect(fitView({ x0: 0, x1: 2000, y0: 0, y1: 400 }, box).k).toBeCloseTo((800 - 16) / 2000);
    expect(fitView({ x0: 0, x1: 8000, y0: 0, y1: 400 }, box).k).toBe(0.3);
  });
});

describe('centerView and nearEdge', () => {
  it('puts the point in the middle of the visible box, nudged down for the label', () => {
    const v = centerView(200, 100, 1, { w: 800, h: 400, t: 0 });
    expect(v.x + 200).toBe(400);
    expect(v.y + 100).toBe(210);
  });

  it('detects points near the edges', () => {
    const v = { x: 0, y: 0, k: 1 };
    expect(nearEdge(v, 400, 300, box, 40, 40, 60)).toBe(false);
    expect(nearEdge(v, 20, 300, box, 40, 40, 60)).toBe(true);
    expect(nearEdge(v, 400, 560, box, 40, 40, 60)).toBe(true);
    // under the top bar
    expect(nearEdge(v, 400, 120, { w: 800, h: 600, t: 100 }, 40, 40, 60)).toBe(true);
  });
});

describe('visibleBox', () => {
  const vp = { left: 20, top: 150, width: 360, height: 600 };

  it('is the whole viewport when nothing covers it', () => {
    expect(visibleBox({ ...vp, sheet: null, barBottom: null })).toEqual({ w: 360, h: 600, t: 0 });
  });

  it('stops 8px above the phone sheet, keeping at least 140px', () => {
    expect(visibleBox({ ...vp, sheet: { side: 'bottom', top: 500 }, barBottom: null })).toEqual({ w: 360, h: 342, t: 0 });
    expect(visibleBox({ ...vp, sheet: { side: 'bottom', top: 200 }, barBottom: null }).h).toBe(140);
    expect(visibleBox({ ...vp, sheet: { side: 'bottom', top: 2000 }, barBottom: null }).h).toBe(600);
  });

  it('stops 8px left of the sideways dock, keeping at least 160px', () => {
    expect(visibleBox({ ...vp, sheet: { side: 'right', left: 300 }, barBottom: null }).w).toBe(272);
    expect(visibleBox({ ...vp, sheet: { side: 'right', left: 100 }, barBottom: null }).w).toBe(160);
  });

  it('starts 4px below the top bar, leaving at least 120px', () => {
    expect(visibleBox({ ...vp, sheet: null, barBottom: 200 }).t).toBe(54);
    expect(visibleBox({ ...vp, sheet: { side: 'bottom', top: 400 }, barBottom: 380 }).t).toBe(242 - 120);
  });
});

describe('wheel', () => {
  it('pans by pixels, lines and pages', () => {
    expect(wheelPan({ deltaX: 3, deltaY: 10, deltaMode: 0, shiftKey: false }, 500)).toEqual({ dx: 3, dy: 10 });
    expect(wheelPan({ deltaX: 0, deltaY: 2, deltaMode: 1, shiftKey: false }, 500)).toEqual({ dx: 0, dy: 32 });
    expect(wheelPan({ deltaX: 0, deltaY: 1, deltaMode: 2, shiftKey: false }, 500)).toEqual({ dx: 0, dy: 500 });
  });

  it('turns a vertical wheel sideways with Shift', () => {
    expect(wheelPan({ deltaX: 0, deltaY: 10, deltaMode: 0, shiftKey: true }, 500)).toEqual({ dx: 10, dy: 0 });
  });

  it('zooms at most one 1.2x step per event', () => {
    expect(wheelZoom({ deltaX: 0, deltaY: -1000, deltaMode: 0, shiftKey: false }, 500)).toBeCloseTo(1.2);
    expect(wheelZoom({ deltaX: 0, deltaY: 1000, deltaMode: 0, shiftKey: false }, 500)).toBeCloseTo(1 / 1.2);
    expect(wheelZoom({ deltaX: 0, deltaY: -50, deltaMode: 0, shiftKey: false }, 500)).toBeCloseTo(Math.pow(1.2, 0.5));
  });
});

describe('arrange cells', () => {
  it('maps world points to the nearest cell and back', () => {
    expect(cellAt(PAD, PAD, GY, -3)).toEqual({ x: 0, y: -3 });
    expect(cellAt(PAD + GX * 2 + 50, PAD + GY - 40, GY, 0)).toEqual({ x: 2, y: 1 });
    expect(cellAt(PAD - 80, PAD - 50, GY, 0)).toEqual({ x: -1, y: -1 });
    expect(Object.is(cellAt(PAD - 10, PAD - 10, GY, 0).x, -0)).toBe(false);
    expect(cellBox({ x: 2, y: 1 }, GY, -1)).toEqual({ left: PAD + 2 * GX - 26, top: PAD + 2 * GY - 26 });
  });

  it('pans near the edges only', () => {
    expect(edgeSpeed(300, 0, 600)).toBe(0);
    expect(edgeSpeed(0, 0, 600)).toBe(8);
    expect(edgeSpeed(-50, 0, 600)).toBe(8);
    expect(edgeSpeed(600, 0, 600)).toBe(-8);
    expect(edgeSpeed(18, 0, 600)).toBe(4);
    // a tiny box never auto-pans
    expect(edgeSpeed(0, 0, 80)).toBe(0);
  });
});

describe('tipPosition', () => {
  it('sits right of the node, or left when there is no room', () => {
    expect(tipPosition({ left: 100, right: 152, top: 200 }, 200, 80, 1000, 800)).toEqual({ left: 162, top: 198 });
    expect(tipPosition({ left: 900, right: 952, top: 200 }, 200, 80, 1000, 800)).toEqual({ left: 690, top: 198 });
    expect(tipPosition({ left: 100, right: 152, top: 760 }, 200, 80, 1000, 800)).toEqual({ left: 162, top: 712 });
    expect(tipPosition({ left: 0, right: 52, top: 0 }, 2000, 80, 1000, 800)).toEqual({ left: 8, top: 8 });
  });
});
