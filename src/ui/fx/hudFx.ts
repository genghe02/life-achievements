// While a completion's XP orbs are in the air, the HUD leaves that completion's XP, emeralds and
// done count out. Each completion's numbers arrive when its own orbs land, with the level pop on a
// level-up (as in the game). Overlapping completions land one by one, so a level-up is announced
// exactly once.

import { useSyncExternalStore } from 'react';
import { levelOf, totals } from '../../domain/level';
import { isDone } from '../../domain/rules';
import type { LifeData } from '../../domain/types';

export interface HudNumbers {
  xp: number;
  emeralds: number;
  done: number;
  all: number;
}

/** Gains of one completion whose orbs are still flying. */
export interface PendingGain {
  token: number;
  id: string;
  xp: number;
  emeralds: number;
}

export interface HudFx {
  pending: readonly PendingGain[];
  /** Bumped on every level-up; the HUD replays its pop animation when it changes. */
  pop: number;
}

let state: HudFx = { pending: [], pop: 0 };
let seq = 0;
const listeners = new Set<() => void>();

function emit(next: HudFx): void {
  state = next;
  listeners.forEach(l => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const get = () => state;

/** The numbers the HUD shows: the live totals minus the gains still in flight. */
export function hudNumbers(data: LifeData, pending: readonly PendingGain[] = state.pending): HudNumbers {
  const t = totals(data);
  let { xp, emeralds, done } = t;
  const seen = new Set<string>();
  // newest first, so an achievement completed, undone and completed again counts once
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i];
    // undone or replaced (reset, import) while the orbs flew: nothing to hold back
    if (seen.has(p.id) || !isDone(data, p.id)) continue;
    seen.add(p.id);
    xp -= p.xp;
    emeralds -= p.emeralds;
    done -= 1;
  }
  return { xp: Math.max(0, xp), emeralds, done: Math.max(0, done), all: t.all };
}

/** Hold a completion's gains back from the HUD until its orbs land. Returns the token for landHud. */
export function holdHud(id: string, xp: number, emeralds: number): number {
  const token = ++seq;
  emit({ ...state, pending: [...state.pending, { token, id, xp, emeralds }] });
  return token;
}

/**
 * The orbs of a held completion landed: show its gains. Returns true when that raised the level
 * the HUD shows (the HUD then pops).
 */
export function landHud(token: number, data: LifeData): boolean {
  if (!state.pending.some(p => p.token === token)) return false;
  const before = levelOf(hudNumbers(data).xp).level;
  const pending = state.pending.filter(p => p.token !== token);
  const up = levelOf(hudNumbers(data, pending).xp).level > before;
  emit({ pending, pop: state.pop + (up ? 1 : 0) });
  return up;
}

/** Drop every hold (tests, data reset). */
export function resetHud(): void {
  emit({ pending: [], pop: state.pop });
}

export function useHudFx(): HudFx {
  return useSyncExternalStore(subscribe, get, get);
}
