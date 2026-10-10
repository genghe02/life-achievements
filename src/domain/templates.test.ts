import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from './catalog';
import { conflicts } from './layout';
import { areaLocked, nodesOfArea, statusOf } from './rules';
import { BASE_TRADES, blankData, defaultRewards, newAreaRoot, starterData } from './templates';
import { parseBackup } from './validate';

const NOW = new Date(2026, 9, 10, 12);

describe('starterData', () => {
  const data = starterData(NOW);

  it('has 7 areas and 97 achievements, nothing done', () => {
    expect(data.version).toBe(1);
    expect(data.areas.map(a => a.id)).toEqual(['origin', 'body', 'mind', 'craft', 'wealth', 'bond', 'road']);
    expect(data.achievements).toHaveLength(97);
    expect(data.done).toEqual({});
    expect(data.progress).toEqual({});
    expect(data.trades).toEqual([]);
    expect(data.settings).toEqual({ sound: true, labels: true });
    expect(data.createdAt).toBe(NOW.toISOString());
    expect(data.updatedAt).toBe(NOW.toISOString());
  });

  it('keeps ids, positions, areas and gateways', () => {
    const body = data.achievements.find(n => n.id === 'b_warm_up')!;
    expect(body).toMatchObject({ areaId: 'body', x: 0, parents: ['o_body'] });
    const sleep = data.achievements.find(n => n.id === 'o_sleep')!;
    expect(sleep).toMatchObject({ areaId: 'origin', x: 1, y: -2, parents: ['o_start'] });
    for (const a of data.areas) {
      const ns = nodesOfArea(data, a.id);
      expect(ns.filter(n => n.x === 0), a.id).toHaveLength(1);
      expect(conflicts(ns), a.id).toBe(0);
    }
    expect(data.areas.filter(a => areaLocked(data, a.id)).map(a => a.id)).toEqual(['body', 'mind', 'craft', 'wealth', 'bond', 'road']);
    expect(statusOf(data, 'o_start')).toBe('open');
  });

  it('carries no demo fields and only known icons', () => {
    for (const n of data.achievements) {
      expect(Object.keys(n).some(k => k.startsWith('demo'))).toBe(false);
      expect(ICON_NAMES).toContain(n.icon);
      if (n.target) expect(n.unit).toBeTruthy();
    }
    for (const a of data.areas) expect(ICON_NAMES).toContain(a.icon);
  });

  it('gives default rewards with fresh ids', () => {
    expect(data.rewards.map(r => r.name)).toEqual(BASE_TRADES.map(t => t.name));
    const again = starterData(NOW);
    expect(new Set([...data.rewards, ...again.rewards].map(r => r.id)).size).toBe(16);
    expect(defaultRewards()).toHaveLength(8);
    for (const r of data.rewards) expect(ICON_NAMES).toContain(r.icon);
  });

  it('is a valid backup as it stands', () => {
    const res = parseBackup(data, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(data);
  });
});

describe('blankData', () => {
  const data = blankData(NOW);

  it('has the same 7 areas with only their roots, ungated', () => {
    expect(data.areas.map(a => a.id)).toEqual(starterData(NOW).areas.map(a => a.id));
    expect(data.achievements).toHaveLength(7);
    for (const n of data.achievements) {
      expect(n.x).toBe(0);
      expect(n.parents).toEqual([]);
      expect(statusOf(data, n.id)).toBe('open');
    }
    expect(new Set(data.achievements.map(n => n.areaId)).size).toBe(7);
    expect(data.rewards).toHaveLength(8);
  });
});

describe('newAreaRoot', () => {
  it('builds the first step of a new area', () => {
    expect(newAreaRoot('a1', 'heart')).toMatchObject({
      areaId: 'a1',
      title: '新的开始',
      desc: '这个领域的第一步',
      type: 'goal',
      icon: 'heart',
      parents: [],
      x: 0,
      y: 0,
      xp: 120,
      pts: 6,
    });
  });
});
