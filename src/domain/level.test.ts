import { describe, expect, it } from 'vitest';
import { DEF_PTS, DEF_XP, levelOf, rankOf, RANKS, totals, xpAt } from './level';
import { starterData } from './templates';

describe('level', () => {
  it('follows the doubled Minecraft curve', () => {
    expect(xpAt(0)).toBe(0);
    expect(xpAt(1)).toBe(14);
    expect(xpAt(2)).toBe(32);
    expect(xpAt(16)).toBe(704);
    expect(xpAt(17)).toBe(788);
    expect(xpAt(30)).toBe(2790);
    expect(xpAt(31)).toBe(3014);
    expect(xpAt(32)).toBe(3256);
    expect(xpAt(50)).toBe(2 * (4.5 * 2500 - 162.5 * 50 + 2220));
    for (let L = 0; L < 80; L++) {
      expect(Number.isInteger(xpAt(L))).toBe(true);
      expect(xpAt(L + 1)).toBeGreaterThan(xpAt(L));
    }
  });

  it('turns XP into level and progress', () => {
    expect(levelOf(0)).toEqual({ level: 0, cur: 0, need: 14 });
    expect(levelOf(13)).toEqual({ level: 0, cur: 13, need: 14 });
    expect(levelOf(14)).toEqual({ level: 1, cur: 0, need: 18 });
    expect(levelOf(704)).toEqual({ level: 16, cur: 0, need: 84 });
    expect(levelOf(3013).level).toBe(30);
    expect(levelOf(3014).level).toBe(31);
  });

  it('lands near level 50 when every starter achievement is done', () => {
    const data = starterData(new Date(2026, 9, 10));
    const xp = data.achievements.reduce((a, n) => a + n.xp, 0);
    const L = levelOf(xp).level;
    expect(L).toBeGreaterThanOrEqual(40);
    expect(L).toBeLessThanOrEqual(60);
  });

  it('maps levels to ranks', () => {
    expect(RANKS).toEqual(['新手', '学徒', '老手', '专家', '大师']);
    expect(rankOf(0)).toBe('新手');
    expect(rankOf(9)).toBe('新手');
    expect(rankOf(10)).toBe('学徒');
    expect(rankOf(29)).toBe('老手');
    expect(rankOf(39)).toBe('专家');
    expect(rankOf(40)).toBe('大师');
    expect(rankOf(400)).toBe('大师');
  });

  it('has type defaults', () => {
    expect(DEF_XP).toEqual({ task: 40, goal: 120, challenge: 300 });
    expect(DEF_PTS).toEqual({ task: 2, goal: 6, challenge: 15 });
  });

  it('derives totals from done achievements and trades', () => {
    const base = starterData(new Date(2026, 9, 10));
    expect(totals(base)).toEqual({ xp: 0, earned: 0, spent: 0, emeralds: 0, done: 0, all: 97 });
    const a = base.achievements.find(n => n.id === 'o_start')!;
    const b = base.achievements.find(n => n.id === 'o_sleep')!;
    const data = {
      ...base,
      // a done entry for a missing node does not count
      done: { o_start: { date: '2026-10-01' }, o_sleep: { date: '2026-10-02' }, gone: { date: '2026-10-02' } },
      trades: [{ id: 't1', rewardId: null, name: 'x', cost: 1, icon: 'potion', date: '2026-10-03' }],
    };
    expect(totals(data)).toEqual({
      xp: a.xp + b.xp,
      earned: a.pts + b.pts,
      spent: 1,
      emeralds: a.pts + b.pts - 1,
      done: 2,
      all: 97,
    });
    expect(totals(data)).toBe(totals(data));
  });
});
