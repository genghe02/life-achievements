import { beforeEach, describe, expect, it } from 'vitest';
import { levelOf, totals } from '../../domain/level';
import { statusOf } from '../../domain/rules';
import { useStore } from '../../store/store';
import { holdHud, hudNumbers, landHud, resetHud } from './hudFx';

const openPlain = () => {
  const d = useStore.getState().data;
  return d.achievements.find(n => !n.target && statusOf(d, n.id) === 'open')!;
};

/** Complete the next open achievement and hold its gains, as completeWithFx does. */
const completeAndHold = () => {
  const r = useStore.getState().complete(openPlain().id)!;
  return { r, hold: holdHud(r.id, r.xpGained, r.ptsGained) };
};

describe('HUD holds while XP orbs fly', () => {
  beforeEach(() => {
    useStore.getState().start('starter');
    resetHud();
  });

  it('shows the numbers from before until the orbs land', () => {
    const { r, hold } = completeAndHold();
    const data = useStore.getState().data;
    expect(hudNumbers(data)).toMatchObject({ xp: 0, emeralds: 0, done: 0 });
    expect(landHud(hold, data)).toBe(r.levelAfter > r.levelBefore);
    expect(hudNumbers(data)).toEqual({ xp: r.xpGained, emeralds: r.ptsGained, done: 1, all: data.achievements.length });
  });

  it('lands overlapping completions one at a time and announces each level once', () => {
    const a = completeAndHold();
    const b = completeAndHold();
    const data = useStore.getState().data;
    expect(hudNumbers(data).xp).toBe(0);
    const levels = [0];
    const ups: boolean[] = [];
    for (const { hold } of [b, a]) {
      ups.push(landHud(hold, data));
      levels.push(levelOf(hudNumbers(data).xp).level);
    }
    expect(hudNumbers(data).xp).toBe(totals(data).xp);
    // a level-up is reported exactly when the shown level went up at that landing
    expect(ups).toEqual([levels[1] > levels[0], levels[2] > levels[1]]);
    // landing twice does nothing
    expect(landHud(a.hold, data)).toBe(false);
  });

  it('ignores a hold whose achievement was undone in the meantime', () => {
    const { r, hold } = completeAndHold();
    expect(useStore.getState().undo(r.id).ok).toBe(true);
    const data = useStore.getState().data;
    expect(hudNumbers(data)).toMatchObject({ xp: 0, done: 0 });
    expect(landHud(hold, data)).toBe(false);
  });
});
