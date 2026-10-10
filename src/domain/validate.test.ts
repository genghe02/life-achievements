import { describe, expect, it } from 'vitest';
import { conflicts, GRID_MAX } from './layout';
import { nodesOfArea } from './rules';
import { starterData } from './templates';
import type { BackupFile, LifeData } from './types';
import { cut, IMPORT_ERRORS, parseBackup } from './validate';

const NOW = new Date(2026, 9, 10, 12);

function ok(input: unknown): LifeData {
  const res = parseBackup(input, NOW);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function error(input: unknown): string {
  const res = parseBackup(input, NOW);
  if (res.ok) throw new Error('expected a rejection');
  return res.error;
}

const sample = (): LifeData => {
  const d = starterData(NOW);
  return {
    ...d,
    done: { o_start: { date: '2026-10-01', note: '开始了' }, o_offline: { date: '2026-10-02', prevProgress: 6 } },
    progress: { o_offline: 7, o_home: 3 },
    trades: [{ id: 't_1', rewardId: d.rewards[0].id, name: '一杯奶茶', cost: 3, icon: 'potion', date: '2026-10-03' }],
  };
};

const backup = (data: unknown): BackupFile => ({ app: 'life-achievements', version: 1, exportedAt: NOW.toISOString(), data: data as LifeData });

describe('parseBackup: accepts', () => {
  it('a BackupFile unchanged', () => {
    const d = sample();
    expect(ok(backup(d))).toEqual(d);
  });

  it('a bare LifeData', () => {
    const d = sample();
    expect(ok(d)).toEqual(d);
  });

  it('JSON text', () => {
    const d = sample();
    expect(ok(JSON.stringify(backup(d)))).toEqual(d);
  });

  it('without touching the input', () => {
    const d = sample();
    const copy = structuredClone(d);
    ok(backup(d));
    expect(d).toEqual(copy);
  });
});

describe('parseBackup: rejects', () => {
  it('things that are not our data', () => {
    expect(error(null)).toBe(IMPORT_ERRORS.notOurs);
    expect(error(42)).toBe(IMPORT_ERRORS.notOurs);
    expect(error([])).toBe(IMPORT_ERRORS.notOurs);
    expect(error({ foo: 1 })).toBe(IMPORT_ERRORS.notOurs);
    expect(error({ app: 'other', version: 1, data: sample() })).toBe(IMPORT_ERRORS.notOurs);
    expect(error({ app: 'life-achievements', version: 1, data: 'x' })).toBe(IMPORT_ERRORS.notOurs);
    expect(error({ ...sample(), version: 0 })).toBe(IMPORT_ERRORS.notOurs);
  });

  it('unreadable text', () => {
    expect(error('{not json')).toBe(IMPORT_ERRORS.unreadable);
  });

  it('newer versions', () => {
    expect(error({ ...backup(sample()), version: 2 })).toBe(IMPORT_ERRORS.newer);
    expect(error({ ...sample(), version: 3 })).toBe(IMPORT_ERRORS.newer);
  });

  it('broken areas', () => {
    expect(error({ ...sample(), areas: [] })).toBe(IMPORT_ERRORS.areas);
    expect(error({ ...sample(), areas: [{ id: 'x' }] })).toBe(IMPORT_ERRORS.areas);
    expect(error({ ...sample(), areas: ['x'] })).toBe(IMPORT_ERRORS.areas);
    expect(error({ ...sample(), areas: [{ id: '__proto__', name: 'x' }] })).toBe(IMPORT_ERRORS.areas);
  });

  it('broken achievements', () => {
    const d = sample();
    const bad = (patch: object) => ({ ...d, achievements: [...d.achievements.slice(1), { ...d.achievements[0], ...patch }] });
    expect(error(bad({ title: '  ' }))).toBe(IMPORT_ERRORS.nodes);
    expect(error(bad({ x: 'a' }))).toBe(IMPORT_ERRORS.nodes);
    expect(error(bad({ x: -1 }))).toBe(IMPORT_ERRORS.nodes);
    expect(error(bad({ y: Infinity }))).toBe(IMPORT_ERRORS.nodes);
    expect(error(bad({ id: 'has space' }))).toBe(IMPORT_ERRORS.nodes);
    expect(error({ ...d, achievements: [...d.achievements, null] })).toBe(IMPORT_ERRORS.nodes);
  });

  it('duplicate ids', () => {
    const d = sample();
    expect(error({ ...d, achievements: [...d.achievements, { ...d.achievements[3] }] })).toBe(IMPORT_ERRORS.duplicate);
    expect(error({ ...d, areas: [...d.areas, { ...d.areas[0] }] })).toBe(IMPORT_ERRORS.duplicate);
  });

  it('an area without exactly one root', () => {
    const d = sample();
    const noRoot = { ...d, achievements: d.achievements.filter(n => n.id !== 'b_warm_up') };
    expect(error(noRoot)).toBe(IMPORT_ERRORS.root('体魄'));
    const twoRoots = { ...d, achievements: d.achievements.map(n => (n.id === 'o_sleep' ? { ...n, x: 0 } : n)) };
    expect(error(twoRoots)).toBe(IMPORT_ERRORS.root('起源'));
    const emptyArea = { ...d, areas: [...d.areas, { id: 'empty', name: '空', subtitle: '', icon: 'heart', bg: 'dirt' }] };
    expect(error(emptyArea)).toBe(IMPORT_ERRORS.root('空'));
  });

  it('prerequisite cycles', () => {
    const d = sample();
    // origin's root gated by a body node, whose area is gated by origin
    const cyc = { ...d, achievements: d.achievements.map(n => (n.id === 'o_start' ? { ...n, parents: ['b_warm_up'] } : n)) };
    expect(error(cyc)).toBe(IMPORT_ERRORS.cycle);
  });
});

describe('parseBackup: normalises', () => {
  it('trims and cuts strings, clamps numbers, falls back on icons, types and backgrounds', () => {
    const d = sample();
    const raw = {
      ...d,
      areas: d.areas.map((a, i) => (i === 0 ? { ...a, name: '  起源之地很长很长  ', icon: 'unknown', bg: 'lava', subtitle: 5 } : a)),
      achievements: d.achievements.map(n =>
        n.id === 'o_sleep'
          ? { ...n, title: '  甜蜜的梦  ', icon: 'nope', type: 'quest', xp: 1e9, pts: -4, tip: '   ', reward: 'x'.repeat(40), hidden: 'yes', y: -2.4 }
          : n,
      ),
    };
    const out = ok(raw);
    expect(out.areas[0]).toMatchObject({ name: '起源之地很长', icon: 'sapling', bg: 'dirt', subtitle: '' });
    const s = out.achievements.find(n => n.id === 'o_sleep')!;
    expect(s).toMatchObject({ title: '甜蜜的梦', icon: 'sapling', type: 'task', xp: 5000, pts: 0, y: -2 });
    expect(s.reward).toHaveLength(20);
    expect(s).not.toHaveProperty('tip');
    expect(s).not.toHaveProperty('hidden');
  });

  it('defaults missing xp and pts from the type', () => {
    const d = sample();
    const raw = { ...d, achievements: d.achievements.map(n => (n.id === 'o_sleep' ? { ...n, type: 'goal', xp: undefined, pts: 'x' } : n)) };
    expect(ok(raw).achievements.find(n => n.id === 'o_sleep')).toMatchObject({ xp: 120, pts: 6 });
  });

  it('handles counters: target range, unit, progress and prevProgress', () => {
    const d = sample();
    const raw = {
      ...d,
      achievements: d.achievements.map(n => {
        if (n.id === 'o_home') return { ...n, target: 99999, unit: '' };
        if (n.id === 'o_sleep') return { ...n, target: 1, unit: '天' };
        return n;
      }),
      done: { ...d.done, o_offline: { date: '2026-10-02', prevProgress: 50 } },
      progress: { o_offline: 2, o_home: 1e6, o_sleep: 3, o_start: 4, gone: 3 },
    };
    const out = ok(raw);
    const home = out.achievements.find(n => n.id === 'o_home')!;
    expect(home).toMatchObject({ target: 9999, unit: '次' });
    const sleep = out.achievements.find(n => n.id === 'o_sleep')!;
    expect(sleep).not.toHaveProperty('target');
    expect(sleep).not.toHaveProperty('unit');
    // done counter shows its target; open counters stay below it; others dropped
    expect(out.progress).toEqual({ o_offline: 7, o_home: 9998 });
    expect(out.done.o_offline.prevProgress).toBe(6);
  });

  it('drops dangling references', () => {
    const d = sample();
    const raw = {
      ...d,
      achievements: [
        ...d.achievements.map(n => (n.id === 'o_sleep' ? { ...n, parents: ['o_start', 'gone', 'o_start', 'o_sleep', 'b_warm_up'] } : n)),
        { ...d.achievements[1], id: 'orphan', areaId: 'no_area' },
      ],
      done: { ...d.done, gone: { date: '2026-10-01' }, orphan: { date: '2026-10-01' } },
      progress: { ...d.progress, gone: 3 },
      trades: [...d.trades, { id: 't_2', rewardId: 'gone', name: '旧奖励', cost: 4, icon: 'cake', date: '2026-10-04' }],
    };
    const out = ok(raw);
    expect(out.achievements.find(n => n.id === 'o_sleep')!.parents).toEqual(['o_start']);
    expect(out.achievements.some(n => n.id === 'orphan')).toBe(false);
    expect(Object.keys(out.done).sort()).toEqual(['o_offline', 'o_start']);
    expect(out.progress).not.toHaveProperty('gone');
    expect(out.trades[1].rewardId).toBeNull();
    expect(out.trades[0].rewardId).toBe(d.rewards[0].id);
  });

  it('keeps cross-area parents only on roots', () => {
    const d = sample();
    const raw = {
      ...d,
      achievements: d.achievements.map(n => {
        if (n.id === 'b_warm_up') return { ...n, parents: ['o_body', 'b_quit_soda'] };
        if (n.id === 'o_sleep') return { ...n, parents: ['o_start', 'm_bookshelf'] };
        return n;
      }),
    };
    const out = ok(raw);
    expect(out.achievements.find(n => n.id === 'b_warm_up')!.parents).toEqual(['o_body']);
    expect(out.achievements.find(n => n.id === 'o_sleep')!.parents).toEqual(['o_start']);
  });

  it('fixes future and invalid dates', () => {
    const d = sample();
    const raw = {
      ...d,
      done: { o_start: { date: '2030-01-01' }, o_offline: { date: '2026-02-30' } },
      trades: [{ ...d.trades[0], date: '2099-12-31' }],
    };
    const out = ok(raw);
    expect(out.done.o_start.date).toBe('2026-10-10');
    expect(out.done.o_offline.date).toBe('2026-10-10');
    expect(out.trades[0].date).toBe('2026-10-10');
  });

  it('reads plain date strings as done entries and drops empty notes', () => {
    const d = sample();
    const out = ok({ ...d, done: { o_start: '2026-09-01', o_offline: { date: '2026-09-02', note: '   ' } } });
    expect(out.done.o_start).toEqual({ date: '2026-09-01' });
    expect(out.done.o_offline).toEqual({ date: '2026-09-02' });
  });

  it('cleans rewards, trades and settings', () => {
    const d = sample();
    const out = ok({
      ...d,
      rewards: [{ id: 'r a', name: ' 奶茶 ', cost: 0, icon: '?' }, { name: '' }, 'x', { id: 'r_b', name: '书', cost: 5000, icon: 'book' }],
      trades: [{ name: '电影', cost: -3, date: 'x' }, { name: '' }],
      settings: { sound: false, labels: 'no' },
      createdAt: 'bad',
    });
    expect(out.rewards).toHaveLength(2);
    expect(out.rewards[0]).toMatchObject({ name: '奶茶', cost: 1, icon: 'sapling' });
    expect(out.rewards[0].id).toMatch(/^r_/);
    expect(out.rewards[1]).toEqual({ id: 'r_b', name: '书', cost: 999, icon: 'book' });
    expect(out.trades).toHaveLength(1);
    expect(out.trades[0]).toMatchObject({ rewardId: null, name: '电影', cost: 0, icon: 'sapling', date: '2026-10-10' });
    expect(out.settings).toEqual({ sound: false, labels: true });
    expect(out.createdAt).toBe(NOW.toISOString());
  });

  it('fills in missing optional parts', () => {
    const d = sample();
    const rest: Record<string, unknown> = { ...d };
    for (const k of ['done', 'progress', 'rewards', 'trades', 'settings']) delete rest[k];
    const out = ok(rest);
    expect(out.done).toEqual({});
    expect(out.progress).toEqual({});
    expect(out.rewards).toEqual([]);
    expect(out.trades).toEqual([]);
    expect(out.settings).toEqual({ sound: true, labels: true });
  });

  it('drops same-area prerequisites that are not in a smaller column', () => {
    const d = sample();
    const raw = {
      ...d,
      achievements: d.achievements.map(n => (n.id === 'o_water' ? { ...n, parents: ['o_start', 'o_tidy', 'o_wealth'] } : n)),
    };
    const out = ok(raw);
    expect(out.achievements.find(n => n.id === 'o_water')!.parents).toEqual(['o_start']);
    expect(conflicts(nodesOfArea(out, 'origin'))).toBe(0);
  });

  it('accepts every cell the store can place a node on, and nothing further out', () => {
    const d = sample();
    const at = (x: number, y: number) => ({ ...d, achievements: d.achievements.map(n => (n.id === 'o_tree' ? { ...n, x, y } : n)) });
    expect(ok(at(GRID_MAX, -GRID_MAX)).achievements.find(n => n.id === 'o_tree')).toMatchObject({ x: GRID_MAX, y: -GRID_MAX });
    expect(error(at(GRID_MAX + 1, 0))).toBe(IMPORT_ERRORS.nodes);
    expect(error(at(5, GRID_MAX + 1))).toBe(IMPORT_ERRORS.nodes);
  });

  it('moves a stacked node without prerequisites to a free cell too', () => {
    const d = sample();
    const water = d.achievements.find(n => n.id === 'o_water')!;
    const lost = { ...water, id: 'lost', title: '无前置', parents: [] };
    const out = ok({ ...d, achievements: [...d.achievements, lost] });
    const origin = nodesOfArea(out, 'origin');
    expect(new Set(origin.map(n => `${n.x},${n.y}`)).size).toBe(origin.length);
    expect(out.achievements.find(n => n.id === 'o_water')).toMatchObject({ x: water.x, y: water.y });
  });

  it('moves nodes stacked on one cell to a free one', () => {
    const d = sample();
    const water = d.achievements.find(n => n.id === 'o_water')!;
    const dup = { ...water, id: 'dup', title: '重叠', parents: ['o_start'] };
    const out = ok({ ...d, achievements: [...d.achievements, dup] });
    const origin = nodesOfArea(out, 'origin');
    expect(new Set(origin.map(n => `${n.x},${n.y}`)).size).toBe(origin.length);
    expect(out.achievements.find(n => n.id === 'o_water')).toMatchObject({ x: water.x, y: water.y });
    expect(conflicts(origin)).toBe(0);
  });
});

describe('cut', () => {
  it('counts code points', () => {
    expect(cut('abc', 2)).toBe('ab');
    expect(cut('😀😀😀', 2)).toBe('😀😀');
    expect(cut('短', 5)).toBe('短');
  });
});
