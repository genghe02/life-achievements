// Experience curve, ranks, type defaults and the derived totals (XP and emeralds are never stored).

import type { LifeData, NodeType } from './types';

export const RANKS = ['新手', '学徒', '老手', '专家', '大师'] as const;
export const DEF_XP: Record<NodeType, number> = { task: 40, goal: 120, challenge: 300 };
export const DEF_PTS: Record<NodeType, number> = { task: 2, goal: 6, challenge: 15 };

/** Total XP needed to reach `level`: Minecraft's curve, doubled so finishing every tree lands near level 50. */
export function xpAt(level: number): number {
  const L = level;
  return 2 * (L <= 16 ? L * L + 6 * L : L <= 31 ? 2.5 * L * L - 40.5 * L + 360 : 4.5 * L * L - 162.5 * L + 2220);
}

export interface LevelInfo {
  level: number;
  /** XP into the current level. */
  cur: number;
  /** XP from this level to the next. */
  need: number;
}

export function levelOf(xp: number): LevelInfo {
  let level = 0;
  while (xpAt(level + 1) <= xp) level++;
  return { level, cur: xp - xpAt(level), need: xpAt(level + 1) - xpAt(level) };
}

/** 新手 for levels 0–9, 学徒 10–19 … 大师 from 40. */
export function rankOf(level: number): string {
  return RANKS[Math.max(0, Math.min(RANKS.length - 1, Math.floor(level / 10)))];
}

export interface Totals {
  xp: number;
  /** Emeralds earned from done achievements. */
  earned: number;
  /** Emeralds spent on trades. */
  spent: number;
  /** earned - spent */
  emeralds: number;
  done: number;
  all: number;
}

const totalsCache = new WeakMap<LifeData, Totals>();

export function totals(data: LifeData): Totals {
  const hit = totalsCache.get(data);
  if (hit) return hit;
  let xp = 0, earned = 0, done = 0, spent = 0;
  for (const n of data.achievements) {
    if (!Object.hasOwn(data.done, n.id)) continue;
    xp += n.xp;
    earned += n.pts;
    done++;
  }
  for (const t of data.trades) spent += t.cost;
  const out: Totals = { xp, earned, spent, emeralds: earned - spent, done, all: data.achievements.length };
  totalsCache.set(data, out);
  return out;
}
