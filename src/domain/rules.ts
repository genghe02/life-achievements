// Status and relationships between achievements. Pure functions over one LifeData.

import type { Achievement, LifeData, NodeStatus, NodeType } from './types';

export const TYPE_NAME: Record<NodeType, string> = { task: '任务', goal: '目标', challenge: '挑战' };
export const TOAST_L1: Record<NodeType, string> = { task: '进度已达成！', goal: '目标已达成！', challenge: '挑战已完成！' };

interface Index {
  byId: Map<string, Achievement>;
  children: Map<string, Achievement[]>;
  byArea: Map<string, Achievement[]>;
}

// Keyed by the achievements array: the store replaces it on every structural change and
// keeps it when only done/progress change, so the index survives completions.
const indexCache = new WeakMap<readonly Achievement[], Index>();

function index(data: LifeData): Index {
  const list = data.achievements;
  let ix = indexCache.get(list);
  if (ix) return ix;
  ix = { byId: new Map(), children: new Map(), byArea: new Map() };
  for (const n of list) {
    ix.byId.set(n.id, n);
    let area = ix.byArea.get(n.areaId);
    if (!area) ix.byArea.set(n.areaId, (area = []));
    area.push(n);
  }
  for (const n of list) {
    for (const p of n.parents) {
      let kids = ix.children.get(p);
      if (!kids) ix.children.set(p, (kids = []));
      if (!kids.includes(n)) kids.push(n);
    }
  }
  indexCache.set(list, ix);
  return ix;
}

/** Map of every achievement by id (cached; do not mutate). */
export function byId(data: LifeData): Map<string, Achievement> {
  return index(data).byId;
}

export function nodesOfArea(data: LifeData, areaId: string): Achievement[] {
  return (index(data).byArea.get(areaId) ?? []).slice();
}

export function isDone(data: LifeData, id: string): boolean {
  return Object.hasOwn(data.done, id);
}

/** done, open (every existing parent is done) or locked. */
export function statusOf(data: LifeData, id: string): NodeStatus {
  if (isDone(data, id)) return 'done';
  const map = byId(data);
  const n = map.get(id);
  if (!n) return 'locked';
  return n.parents.every(p => isDone(data, p) || !map.has(p)) ? 'open' : 'locked';
}

/** Achievements (in any area) that list `id` as a prerequisite. */
export function childrenOf(data: LifeData, id: string): Achievement[] {
  return (index(data).children.get(id) ?? []).slice();
}

/** The area's root: its achievement in column 0. */
export function areaRoot(data: LifeData, areaId: string): Achievement | undefined {
  return index(data).byArea.get(areaId)?.find(n => n.x === 0);
}

/** True while the area's root is locked (its gateway in another area is not done yet). */
export function areaLocked(data: LifeData, areaId: string): boolean {
  const r = areaRoot(data, areaId);
  return !!r && statusOf(data, r.id) === 'locked';
}

/** The existing prerequisites of the area's root: the achievements that unlock the area. */
export function areaGates(data: LifeData, areaId: string): Achievement[] {
  const r = areaRoot(data, areaId);
  if (!r) return [];
  const map = byId(data);
  return r.parents.map(p => map.get(p)).filter((p): p is Achievement => !!p);
}

/** The title, or ??? for a hidden achievement that is still locked. */
export function displayTitle(data: LifeData, node: Achievement): string {
  return node.hidden && statusOf(data, node.id) === 'locked' ? '???' : node.title;
}

/** Done achievements that depend on `id`: they must be undone before `id` can be. */
export function undoBlockers(data: LifeData, id: string): Achievement[] {
  return childrenOf(data, id).filter(k => isDone(data, k.id));
}

/** True when `id` would (transitively) depend on itself if its prerequisites became `parents`. */
export function wouldCycle(data: LifeData, id: string, parents: readonly string[]): boolean {
  const map = byId(data);
  const seen = new Set<string>();
  const stack = [...parents];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (cur === id) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const n = map.get(cur);
    if (n) stack.push(...n.parents);
  }
  return false;
}

/** Ids of every achievement that is open right now. */
export function openIds(data: LifeData): Set<string> {
  const out = new Set<string>();
  for (const n of data.achievements) if (statusOf(data, n.id) === 'open') out.add(n.id);
  return out;
}
