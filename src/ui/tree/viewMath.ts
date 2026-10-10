// Pure view maths for the tree viewport: clamping, zoom steps, the home and fit views, and the
// visible part of the viewport. Ported from the demo's clampTo / homeView / fitView / visibleBox.
// A view maps world px to viewport-local px: screen = view.x + world * view.k.

import type { Box } from '../../domain/layout';

export interface View {
  x: number;
  y: number;
  k: number;
}

/**
 * The part of the viewport the tree can use, in viewport-local px. Its left edge is always 0;
 * `w` is its right edge, `h` its bottom edge and `t` its top edge.
 */
export interface VisBox {
  w: number;
  h: number;
  t: number;
}

/** Zoom levels are whole texel multiples (the art is 2 CSS px per texel), so pixels stay square. */
export const ZOOMS = [0.5, 0.75, 1, 1.5, 2] as const;
export const K_MIN = 0.3;
export const K_MAX = 2;

export const clampK = (k: number): number => Math.min(K_MAX, Math.max(K_MIN, k));

/** Keep the middle of the visible box over the tree's pan bounds, so it can never be dragged out of sight. */
export function clampView(v: View, b: VisBox, bounds: Box): View {
  const k = v.k, cx = b.w / 2, cy = (b.t + b.h) / 2;
  return {
    k,
    x: Math.min(cx - bounds.x0 * k, Math.max(cx - bounds.x1 * k, v.x)),
    y: Math.min(cy - bounds.y0 * k, Math.max(cy - bounds.y1 * k, v.y)),
  };
}

/** The largest zoom level at or below k (below the smallest level: k itself, clamped). */
export function snapK(k: number): number {
  const z = ZOOMS.filter(v => v <= k + 1e-6);
  return z.length ? z[z.length - 1] : clampK(k);
}

/** The next zoom level up (1) or down (-1) from k. */
export function stepK(k: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOMS.find(v => v > k + 0.01) ?? K_MAX;
  return [...ZOOMS].reverse().find(v => v < k - 0.01) ?? clampK(k / 1.25);
}

/** Zoom to k keeping the viewport point (px, py) over the same world point. */
export function zoomAround(v: View, px: number, py: number, k: number): View {
  const nk = clampK(k);
  return { k: nk, x: px - (px - v.x) * (nk / v.k), y: py - (py - v.y) * (nk / v.k) };
}

/** Labels need about 9px of real size, and whole pixels on low-density screens. */
export function labelsHidden(k: number, dpr: number): boolean {
  return k < 0.99 && (k < 0.7 || dpr < 1.5);
}

/** A view at zoom k with the world point (cx, cy) in the middle of the visible box (nudged for the label). */
export function centerView(cx: number, cy: number, k: number, b: VisBox): View {
  return { k, x: b.w / 2 - cx * k, y: (b.t + b.h) / 2 - cy * k + 10 };
}

/** True when the world point sits closer than the margins to an edge of the visible box. */
export function nearEdge(v: View, cx: number, cy: number, b: VisBox, side: number, top: number, bottom: number): boolean {
  const x = v.x + cx * v.k, y = v.y + cy * v.k;
  return x < side || x > b.w - side || y < b.t + top || y > b.h - bottom;
}

// One axis of the home view. `all` and `foc` are node centres, lo/hi the node-and-label extent
// around a centre. Centre the content when it fits; otherwise pick the offset that shows the most
// focus nodes, then the most nodes, then stays nearest the centred offset.
function axis(all: readonly number[], foc: readonly number[], start: number, end: number, lo: number, hi: number): number {
  const size = end - start, c0 = Math.min(...all) - lo, c1 = Math.max(...all) + hi;
  if (c1 - c0 <= size - 12) return start + (size - c0 - c1) / 2;
  const omin = end - c1 - 12, omax = start - c0 + 12;
  const cands = [omin, omax, start + size / 2 - (Math.min(...foc) + Math.max(...foc)) / 2];
  for (const f of foc) cands.push(start + lo + 8 - f, end - hi - 8 - f);
  let best = omin, bestScore = -Infinity;
  for (const cand of cands) {
    const o = Math.min(omax, Math.max(omin, cand));
    const seenF = foc.filter(f => f + o - lo >= start && f + o + hi <= end).length;
    const seenA = all.filter(a => a + o - lo >= start && a + o + hi <= end).length;
    const score = seenF * 1000 + seenA * 10 - Math.abs(o - (start + size / 2 - (c0 + c1) / 2)) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

export interface HomeNode {
  cx: number;
  cy: number;
  /** Open nodes are what the home view tries to show. */
  open: boolean;
  /** The area root, shown when nothing is open. */
  root: boolean;
}

/**
 * Start at 1:1 (crisp pixels). Centre the tree on an axis where it fits; where it doesn't, pick
 * the offset that shows the most nodes you can start now, then the most of the tree.
 * `bottomReserve` keeps room at the bottom (the phone's floating zoom buttons).
 */
export function homeView(nodes: readonly HomeNode[], b: VisBox, bottomReserve = 0): View {
  if (!nodes.length) return { k: 1, x: b.w / 2, y: (b.t + b.h) / 2 };
  let focus = nodes.filter(n => n.open);
  if (!focus.length) focus = nodes.filter(n => n.root);
  if (!focus.length) focus = [...nodes];
  return {
    k: 1,
    x: axis(nodes.map(n => n.cx), focus.map(n => n.cx), 0, b.w, 52, 52),
    y: axis(nodes.map(n => n.cy), focus.map(n => n.cy), b.t, b.h - bottomReserve, 30, 48),
  };
}

/** Fit the content box into the visible box, snapped down to a zoom level, centred. */
export function fitView(content: Box, b: VisBox): View {
  const { x0, x1, y0, y1 } = content;
  const k = snapK(Math.min(K_MAX, (b.w - 16) / (x1 - x0), (b.h - b.t - 12) / (y1 - y0)));
  return { k, x: (b.w - (x0 + x1) * k) / 2, y: b.t + (b.h - b.t - (y0 + y1) * k) / 2 };
}

/** What covers the viewport, measured in window coordinates. */
export interface VisMeasure {
  /** The viewport's rect. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Phone bottom sheet (its top edge) or sideways dock (its left edge), when open. */
  sheet: { side: 'bottom'; top: number } | { side: 'right'; left: number } | null;
  /** Bottom edge of the locked-area banner or the arrange hint at the top, when shown. */
  barBottom: number | null;
}

/** The part of the viewport not covered by the phone sheet (bottom or right) or the top bar. */
export function visibleBox(m: VisMeasure): VisBox {
  let bottom = m.height, right = m.width, top = 0;
  if (m.sheet?.side === 'right') right = Math.max(160, Math.min(m.width, m.sheet.left - m.left - 8));
  else if (m.sheet?.side === 'bottom') bottom = Math.max(140, Math.min(m.height, m.sheet.top - m.top - 8));
  if (m.barBottom !== null) top = Math.min(bottom - 120, m.barBottom - m.top + 4);
  return { w: right, h: bottom, t: Math.max(0, top) };
}

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey: boolean;
}

/** Pixels per wheel delta unit: lines count 16px, pages a viewport height. */
const wheelUnit = (e: WheelInput, pageH: number) => (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageH : 1);

/** How far the plain wheel pans (Shift turns a vertical wheel into a horizontal pan). */
export function wheelPan(e: WheelInput, pageH: number): { dx: number; dy: number } {
  const f = wheelUnit(e, pageH), sideways = e.shiftKey && !e.deltaX;
  return { dx: (sideways ? e.deltaY : e.deltaX) * f, dy: (sideways ? 0 : e.deltaY) * f };
}

/** The zoom factor for Ctrl/Cmd + wheel: at most one 1.2x step per event, so trackpads and mice feel alike. */
export function wheelZoom(e: WheelInput, pageH: number): number {
  return Math.pow(1.2, -Math.max(-1, Math.min(1, (e.deltaY * wheelUnit(e, pageH)) / 100)));
}
