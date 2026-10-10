// Backup parsing: accepts a BackupFile (or a bare LifeData, or either as JSON text), checks types and
// ranges, normalises (trim, clamp, fallback icons, drop dangling references, no future dates) and
// rejects what is not this app's data or is structurally broken. The app's own saved document goes
// through it on every launch too.

import { LIMITS } from '../store/inputs';
import { FALLBACK_ICON, isAreaBg, isIconName, isNodeType } from './catalog';
import { isIsoStamp, latestDay, safeDate } from './dates';
import { isSafeId, newId } from './ids';
import { conflicts, findSlot, GRID_MAX } from './layout';
import { DEF_PTS, DEF_XP } from './level';
import type { Achievement, Area, DoneInfo, LifeData, Result, Reward, Settings, TradeEntry } from './types';

export const IMPORT_ERRORS = {
  unreadable: '文件内容读不出来，换一个备份文件试试。',
  notOurs: '这不是人生成就系统的备份文件，换一个文件试试。',
  newer: '这个备份来自更新版本的应用，先更新应用再导入。',
  areas: '备份里的领域数据不完整，换一个备份文件试试。',
  nodes: '备份里的进度数据不完整，换一个备份文件试试。',
  duplicate: '备份里有重复的编号，换一个备份文件试试。',
  cycle: '备份里的前置进度绕成了一个圈，换一个备份文件试试。',
  root: (name: string) => `备份里「${name}」的起点进度不对，换一个备份文件试试。`,
} as const;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Cut to `max` characters (code points, so emoji are not split). */
export function cut(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? cut(v.trim(), max) : '');

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

const clampInt = (v: unknown, lo: number, hi: number, def: number): number => {
  const n = num(v);
  return n === null ? def : Math.min(hi, Math.max(lo, n));
};

class Reject extends Error {}
const fail = (msg: string): never => {
  throw new Reject(msg);
};

function parseAreas(list: unknown[]): Area[] {
  if (!list.length) fail(IMPORT_ERRORS.areas);
  const seen = new Set<string>();
  return list.map(a => {
    if (!isObj(a) || !isSafeId(a.id)) return fail(IMPORT_ERRORS.areas);
    const name = text(a.name, LIMITS.areaName);
    if (!name) fail(IMPORT_ERRORS.areas);
    if (seen.has(a.id)) fail(IMPORT_ERRORS.duplicate);
    seen.add(a.id);
    return {
      id: a.id,
      name,
      subtitle: text(a.subtitle, LIMITS.areaSubtitle),
      icon: isIconName(a.icon) ? a.icon : FALLBACK_ICON,
      bg: isAreaBg(a.bg) ? a.bg : 'dirt',
    };
  });
}

function parseAchievement(n: unknown): Achievement {
  if (!isObj(n) || !isSafeId(n.id) || typeof n.areaId !== 'string') return fail(IMPORT_ERRORS.nodes);
  const title = text(n.title, LIMITS.title);
  const x = num(n.x), y = num(n.y);
  if (!title || x === null || y === null || x < 0 || x > GRID_MAX || Math.abs(y) > GRID_MAX) return fail(IMPORT_ERRORS.nodes);
  const type = isNodeType(n.type) ? n.type : 'task';
  const a: Achievement = {
    id: n.id,
    areaId: n.areaId,
    title,
    desc: text(n.desc, LIMITS.desc),
    type,
    icon: isIconName(n.icon) ? n.icon : FALLBACK_ICON,
    parents: Array.isArray(n.parents) ? n.parents.filter((p): p is string => typeof p === 'string') : [],
    x,
    y,
    xp: clampInt(n.xp, 0, LIMITS.xpMax, DEF_XP[type]),
    pts: clampInt(n.pts, 0, LIMITS.ptsMax, DEF_PTS[type]),
  };
  const tip = text(n.tip, LIMITS.tip);
  if (tip) a.tip = tip;
  const target = num(n.target);
  if (target !== null && target >= LIMITS.targetMin) {
    a.target = Math.min(LIMITS.targetMax, target);
    a.unit = text(n.unit, LIMITS.unit) || '次';
  }
  const reward = text(n.reward, LIMITS.reward);
  if (reward) a.reward = reward;
  if (n.hidden === true) a.hidden = true;
  return a;
}

function hasCycle(nodes: Achievement[]): boolean {
  const by = new Map(nodes.map(n => [n.id, n]));
  const state = new Map<string, 1 | 2>(); // 1 visiting, 2 done
  for (const start of nodes) {
    if (state.get(start.id) === 2) continue;
    // iterative DFS: [id, next parent index]
    const stack: [string, number][] = [[start.id, 0]];
    state.set(start.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const node = by.get(top[0]) as Achievement;
      if (top[1] >= node.parents.length) {
        state.set(top[0], 2);
        stack.pop();
        continue;
      }
      const p = node.parents[top[1]++];
      const st = state.get(p);
      if (st === 1) return true;
      if (st === undefined && by.has(p)) {
        state.set(p, 1);
        stack.push([p, 0]);
      }
    }
  }
  return false;
}

function parseLifeData(raw: Obj, now: Date): LifeData {
  if (raw.version !== undefined && raw.version !== 1) {
    fail(typeof raw.version === 'number' && raw.version > 1 ? IMPORT_ERRORS.newer : IMPORT_ERRORS.notOurs);
  }
  const areas = parseAreas(raw.areas as unknown[]);
  const areaIds = new Set(areas.map(a => a.id));

  const seen = new Set<string>();
  let nodes: Achievement[] = [];
  for (const item of raw.achievements as unknown[]) {
    const n = parseAchievement(item);
    if (seen.has(n.id)) fail(IMPORT_ERRORS.duplicate);
    seen.add(n.id);
    if (areaIds.has(n.areaId)) nodes.push(n);
  }
  const by = new Map(nodes.map(n => [n.id, n]));
  // keep only prerequisites that exist and follow the area rules: a root's come from other areas,
  // everyone else's from the same area and a smaller column
  for (const n of nodes) {
    n.parents = [...new Set(n.parents)].filter(pid => {
      const p = by.get(pid);
      if (!p || pid === n.id) return false;
      return n.x === 0 ? p.areaId !== n.areaId : p.areaId === n.areaId && p.x < n.x;
    });
  }
  for (const a of areas) {
    if (nodes.filter(n => n.areaId === a.id && n.x === 0).length !== 1) fail(IMPORT_ERRORS.root(a.name));
  }
  if (hasCycle(nodes)) fail(IMPORT_ERRORS.cycle);
  nodes = spreadStacked(nodes);
  // "future" means future everywhere: a date picked as today in a time zone ahead of this one (a
  // trip, another device) is kept as it is
  const maxDate = latestDay(now);

  const done: Record<string, DoneInfo> = {};
  if (isObj(raw.done)) {
    for (const [id, v] of Object.entries(raw.done)) {
      const n = by.get(id);
      if (!n) continue;
      const info = typeof v === 'string' ? { date: v } : isObj(v) ? v : null;
      if (!info) continue;
      const d: DoneInfo = { date: safeDate(info.date, now, maxDate) };
      const note = text(info.note, LIMITS.note);
      if (note) d.note = note;
      if (n.target) {
        const pp = num(info.prevProgress);
        if (pp !== null) d.prevProgress = Math.min(n.target - 1, Math.max(0, pp));
      }
      done[id] = d;
    }
  }

  const progress: Record<string, number> = {};
  const rawProg = isObj(raw.progress) ? raw.progress : {};
  for (const n of nodes) {
    if (!n.target) continue;
    if (Object.hasOwn(done, n.id)) {
      progress[n.id] = n.target;
      continue;
    }
    const v = Object.hasOwn(rawProg, n.id) ? num(rawProg[n.id]) : null;
    if (v !== null && v > 0) progress[n.id] = Math.min(n.target - 1, v);
  }

  const rewards: Reward[] = [];
  const rewardIds = new Set<string>();
  for (const r of Array.isArray(raw.rewards) ? raw.rewards : []) {
    if (!isObj(r)) continue;
    const name = text(r.name, LIMITS.rewardName);
    if (!name) continue;
    const id = isSafeId(r.id) && !rewardIds.has(r.id) ? r.id : newId('r');
    rewardIds.add(id);
    rewards.push({
      id,
      name,
      cost: clampInt(r.cost, LIMITS.costMin, LIMITS.costMax, LIMITS.costMin),
      icon: isIconName(r.icon) ? r.icon : FALLBACK_ICON,
    });
  }

  const trades: TradeEntry[] = [];
  const tradeIds = new Set<string>();
  for (const t of Array.isArray(raw.trades) ? raw.trades : []) {
    if (!isObj(t)) continue;
    const name = text(t.name, LIMITS.rewardName);
    if (!name) continue;
    const id = isSafeId(t.id) && !tradeIds.has(t.id) ? t.id : newId('t');
    tradeIds.add(id);
    trades.push({
      id,
      rewardId: typeof t.rewardId === 'string' && rewardIds.has(t.rewardId) ? t.rewardId : null,
      name,
      cost: clampInt(t.cost, 0, LIMITS.costMax, 0),
      icon: isIconName(t.icon) ? t.icon : FALLBACK_ICON,
      date: safeDate(t.date, now, maxDate),
    });
  }

  const s = isObj(raw.settings) ? raw.settings : {};
  const settings: Settings = {
    sound: typeof s.sound === 'boolean' ? s.sound : true,
    labels: typeof s.labels === 'boolean' ? s.labels : true,
  };
  const stamp = now.toISOString();
  return {
    version: 1,
    areas,
    achievements: nodes,
    done,
    progress,
    rewards,
    trades,
    settings,
    createdAt: isIsoStamp(raw.createdAt) ? raw.createdAt : stamp,
    updatedAt: isIsoStamp(raw.updatedAt) ? raw.updatedAt : stamp,
  };
}

/** Nodes stacked on one cell would hide each other: move all but the first to a free cell if one fits. */
function spreadStacked(nodes: Achievement[]): Achievement[] {
  const taken = new Set<string>();
  const out = nodes.slice();
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    const key = `${n.areaId}|${n.x},${n.y}`;
    if (!taken.has(key)) {
      taken.add(key);
      continue;
    }
    const area = out.filter(m => m.areaId === n.areaId);
    const slot = (n.parents.length ? findSlot(area, n.parents, n.id) : null) ?? freeRow(area, n);
    if (slot) {
      out[i] = { ...n, x: slot.x, y: slot.y };
      taken.add(`${n.areaId}|${slot.x},${slot.y}`);
    }
  }
  return out;
}

/** A free cell in the node's own column, nearest its row: one that adds no conflicts if possible. */
function freeRow(area: Achievement[], n: Achievement): { x: number; y: number } | null {
  const rest = area.filter(m => m.id !== n.id);
  const used = new Set(rest.filter(m => m.x === n.x).map(m => m.y));
  const base = conflicts(rest);
  let first: { x: number; y: number } | null = null;
  for (let i = 1, tries = 0; i <= 4 * GRID_MAX && tries < 60; i++) {
    const y = n.y + (i % 2 ? (i + 1) / 2 : -i / 2);
    if (Math.abs(y) > GRID_MAX || used.has(y)) continue;
    tries++;
    if (conflicts([...rest, { ...n, y }]) <= base) return { x: n.x, y };
    first ??= { x: n.x, y };
  }
  return first;
}

/** Validate and normalise a backup. Never throws. */
export function parseBackup(input: unknown, now: Date = new Date()): Result<{ data: LifeData }> {
  try {
    let value = input;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value) as unknown;
      } catch {
        return { ok: false, error: IMPORT_ERRORS.unreadable };
      }
    }
    if (!isObj(value)) return { ok: false, error: IMPORT_ERRORS.notOurs };
    let raw: unknown = value;
    if ('app' in value || 'exportedAt' in value) {
      if (value.app !== 'life-achievements') return { ok: false, error: IMPORT_ERRORS.notOurs };
      if (typeof value.version === 'number' && value.version > 1) return { ok: false, error: IMPORT_ERRORS.newer };
      raw = value.data;
    }
    if (!isObj(raw) || !Array.isArray(raw.areas) || !Array.isArray(raw.achievements)) {
      return { ok: false, error: IMPORT_ERRORS.notOurs };
    }
    return { ok: true, data: parseLifeData(raw, now) };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, error: e.message };
    return { ok: false, error: IMPORT_ERRORS.unreadable };
  }
}
