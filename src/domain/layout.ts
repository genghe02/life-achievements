// Tree geometry: cell positions, pan bounds, connector routing, conflict checks and auto placement.
// The rules match the demo's conflicts()/placeNode() and tools/validate_tree.py:
// - one root per area in column 0; same-area parents sit in a smaller column;
// - within one column gap, the vertical buses of two parents never overlap, and touch end to end
//   only at a row where they share a child;
// - a horizontal edge into a child never runs through another node's cell;
// - a horizontal edge into a child never crosses another parent's bus.

import type { Achievement, LifeData, NodeStatus } from './types';
import { isDone, statusOf } from './rules';

export const GX = 112;
export const PAD = 56;
/** Row pitch: 84, or 76 on short desktop screens. */
export const GY = 84;
export const GY_SHORT = 76;
/** Largest column and largest row distance from 0 a node may use. parseBackup rejects anything further out. */
export const GRID_MAX = 999;

const onGrid = (x: number, y: number) => x <= GRID_MAX && Math.abs(y) <= GRID_MAX;

/** The fields geometry cares about. */
export interface GridNode {
  id: string;
  x: number;
  y: number;
  parents: readonly string[];
}

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface PlacedNode<T extends GridNode = Achievement> {
  n: T;
  cx: number;
  cy: number;
}

export interface Geometry<T extends GridNode = Achievement> {
  nodes: PlacedNode<T>[];
  width: number;
  height: number;
  /** Pan-clamp box: the centre of the visible area stays inside it. */
  bounds: Box;
  /** Node-and-label extents, for the home view and 「全览」. */
  content: Box;
}

export function geometry<T extends GridNode = Achievement>(nodes: readonly T[], gy: number = GY): Geometry<T> {
  if (!nodes.length) {
    return {
      nodes: [],
      width: PAD * 2,
      height: PAD * 2 + 20,
      bounds: { x0: PAD - 60, x1: PAD + 60, y0: PAD - 50, y1: PAD + 70 },
      content: { x0: PAD - 52, x1: PAD + 52, y0: PAD - 30, y1: PAD + 48 },
    };
  }
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const n of nodes) {
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
  }
  const placed = nodes.map(n => ({ n, cx: PAD + n.x * GX, cy: PAD + (n.y - minY) * gy }));
  const rows = maxY - minY;
  return {
    nodes: placed,
    width: PAD * 2 + maxX * GX,
    height: PAD * 2 + rows * gy + 20,
    bounds: { x0: PAD - 60, x1: PAD + maxX * GX + 60, y0: PAD - 50, y1: PAD + rows * gy + 70 },
    content: { x0: PAD + minX * GX - 52, x1: PAD + maxX * GX + 52, y0: PAD - 30, y1: PAD + rows * gy + 48 },
  };
}

export interface Segment {
  /** SVG path data. */
  d: string;
  /** Colour: a bus takes 'done' when its parent is done, else 'locked'; a stem takes its child's status. */
  state: NodeStatus;
  kind: 'bus' | 'stem';
  /** The parent the segment starts from. */
  from: string;
  /** The child a stem leads into; absent on a bus. */
  to?: string;
}

interface Span {
  id: string;
  lo: number;
  hi: number;
}

/**
 * Horizontal offset of each parent's bus. Parents whose buses meet end to end in the same gap get
 * side-by-side lanes (±6px), so one parent's bus never looks like it feeds the other's children.
 */
export function busLanes(nodes: readonly GridNode[]): Map<string, number> {
  const ids = new Set(nodes.map(n => n.id));
  const kids = new Map<string, GridNode[]>();
  for (const c of nodes) {
    for (const p of c.parents) {
      if (!ids.has(p)) continue;
      let list = kids.get(p);
      if (!list) kids.set(p, (list = []));
      if (!list.includes(c)) list.push(c);
    }
  }
  const spans = new Map<number, Span[]>();
  for (const p of nodes) {
    const ks = kids.get(p.id);
    if (!ks) continue;
    const ys = [p.y, ...ks.map(c => c.y)];
    let col = spans.get(p.x);
    if (!col) spans.set(p.x, (col = []));
    col.push({ id: p.id, lo: Math.min(...ys), hi: Math.max(...ys) });
  }
  const lane = new Map<string, number>();
  for (const list of spans.values()) {
    list.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    list.forEach((s, i) => {
      const prev = list[i - 1], next = list[i + 1];
      const tPrev = !!prev && prev.hi === s.lo, tNext = !!next && next.lo === s.hi;
      lane.set(s.id, tPrev ? -(lane.get(prev.id) ?? 0) || 6 : tNext ? -6 : 0);
    });
  }
  return lane;
}

const STATE_ORDER: Record<NodeStatus, number> = { locked: 0, open: 1, done: 2 };

/**
 * Connector paths for one area, ordered locked → open → done so brighter lines draw on top.
 * Each parent gets one bus path (to its elbow, then one vertical run covering all its children);
 * each parent→child edge gets a stem from the elbow into the child.
 */
export function connectorSegments(data: LifeData, areaId: string, geo: Geometry<Achievement>): Segment[] {
  const placed = geo.nodes.filter(p => p.n.areaId === areaId);
  const pos = new Map<string, PlacedNode<Achievement>>();
  for (const p of placed) pos.set(p.n.id, p);
  const lane = busLanes(placed.map(p => p.n));
  const out: Segment[] = [];
  const busRange = new Map<string, { lo: number; hi: number }>();
  const stems: Segment[] = [];
  for (const c of placed) {
    for (const pid of c.n.parents) {
      const p = pos.get(pid);
      if (!p) continue;
      const bx = p.cx + GX / 2 + (lane.get(pid) ?? 0);
      const r = busRange.get(pid) ?? { lo: p.cy, hi: p.cy };
      r.lo = Math.min(r.lo, c.cy);
      r.hi = Math.max(r.hi, c.cy);
      busRange.set(pid, r);
      stems.push({ d: `M${bx} ${c.cy}H${c.cx}`, state: statusOf(data, c.n.id), kind: 'stem', from: pid, to: c.n.id });
    }
  }
  for (const [pid, r] of busRange) {
    const p = pos.get(pid) as PlacedNode<Achievement>;
    const bx = p.cx + GX / 2 + (lane.get(pid) ?? 0);
    let d = `M${p.cx} ${p.cy}H${bx}`;
    if (r.lo === p.cy && r.hi !== p.cy) d += `V${r.hi}`;
    else if (r.hi === p.cy && r.lo !== p.cy) d += `V${r.lo}`;
    else if (r.lo !== r.hi) d += `M${bx} ${r.lo}V${r.hi}`;
    out.push({ d, state: isDone(data, pid) ? 'done' : 'locked', kind: 'bus', from: pid });
  }
  out.push(...stems);
  // stable sort keeps buses before stems within a colour
  return out.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
}

interface ColSpan {
  lo: number;
  hi: number;
  kids: Set<string>;
}

/** Number of geometry problems among these nodes (0 for a clean tree). Parents outside the list are ignored. */
export function conflicts(nodes: readonly GridNode[]): number {
  const by = new Map<string, GridNode>();
  const pos = new Set<string>();
  let bad = 0;
  for (const n of nodes) {
    by.set(n.id, n);
    const k = n.x + ',' + n.y;
    if (pos.has(k)) bad++;
    else pos.add(k);
  }
  const spans = new Map<number, Map<string, ColSpan>>();
  for (const c of nodes) {
    for (const pid of c.parents) {
      const p = by.get(pid);
      if (!p) continue;
      if (p.x >= c.x) { bad++; continue; }
      let col = spans.get(p.x);
      if (!col) spans.set(p.x, (col = new Map()));
      let sp = col.get(pid);
      if (!sp) col.set(pid, (sp = { lo: p.y, hi: p.y, kids: new Set() }));
      sp.lo = Math.min(sp.lo, c.y);
      sp.hi = Math.max(sp.hi, c.y);
      sp.kids.add(c.id);
    }
  }
  for (const col of spans.values()) {
    const list = [...col.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j], lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
        if (lo < hi) bad++;
        else if (lo === hi && ![...a.kids].some(k => b.kids.has(k) && by.get(k)?.y === lo)) bad++;
      }
    }
  }
  for (const c of nodes) {
    for (const pid of c.parents) {
      const p = by.get(pid);
      if (!p || p.x >= c.x) continue;
      for (let cx = p.x + 1; cx < c.x; cx++) {
        if (pos.has(cx + ',' + c.y)) bad++;
        for (const sp of spans.get(cx)?.values() ?? []) if (sp.lo <= c.y && c.y <= sp.hi && !sp.kids.has(c.id)) bad++;
      }
    }
  }
  return bad;
}

const noNegZero = (v: number) => (v === 0 ? 0 : v);

/**
 * A free cell after all the given (same-area) parents that adds no conflicts, searching up to four
 * columns right of the last parent and outward from the parents' average row. Null if none fits.
 * With `id`, the node of that id is being re-placed: it is left out of `nodes` while searching and
 * its children's edges count, so the cell also has to stay left of every child.
 */
export function findSlot(nodes: readonly GridNode[], parents: readonly string[], id?: string): { x: number; y: number } | null {
  const rest = id ? nodes.filter(n => n.id !== id) : nodes;
  const by = new Map(rest.map(n => [n.id, n]));
  const ps = parents.map(p => by.get(p)).filter((p): p is GridNode => !!p);
  if (!ps.length) return null;
  const base = conflicts(rest);
  const x0 = Math.max(...ps.map(p => p.x)) + 1;
  const yc = Math.round(ps.reduce((a, p) => a + p.y, 0) / ps.length);
  const probe: GridNode = { id: id ?? '__new', x: 0, y: 0, parents };
  for (let x = x0; x < x0 + 4; x++) {
    for (let i = 0; i < 30; i++) {
      const y = noNegZero(yc + (i % 2 ? (i + 1) / 2 : -i / 2));
      if (!onGrid(x, y)) continue;
      if (conflicts([...rest, { ...probe, x, y }]) <= base) return { x, y };
    }
  }
  return null;
}

export type PlaceProblem = 'missing' | 'root' | 'column' | 'occupied' | 'tangle';

/**
 * Why `id` can't move to (x, y), or null when it can. 'missing' covers an unknown node and a cell
 * that is fractional or off the grid. The root stays in column 0 and nothing else may enter it; the
 * node must stay right of every same-area parent and left of every child; the cell must be free;
 * and the move must add no conflicts.
 */
export function placeProblem(nodes: readonly GridNode[], id: string, x: number, y: number): PlaceProblem | null {
  const node = nodes.find(n => n.id === id);
  if (!node || !Number.isInteger(x) || !Number.isInteger(y) || !onGrid(x, y)) return 'missing';
  const isRoot = node.x === 0;
  if (isRoot ? x !== 0 : x <= 0) return 'root';
  const by = new Map(nodes.map(n => [n.id, n]));
  for (const pid of node.parents) {
    const p = by.get(pid);
    if (p && p.id !== id && p.x >= x) return 'column';
  }
  for (const c of nodes) if (c.id !== id && c.parents.includes(id) && c.x <= x) return 'column';
  if (nodes.some(n => n.id !== id && n.x === x && n.y === y)) return 'occupied';
  const rest = nodes.filter(n => n.id !== id);
  return conflicts([...rest, { ...node, x, y }]) <= conflicts(rest) ? null : 'tangle';
}

/** True when moving `id` to (x, y) keeps the column rule and adds no conflict. */
export function canPlace(nodes: readonly GridNode[], id: string, x: number, y: number): boolean {
  return placeProblem(nodes, id, x, y) === null;
}
