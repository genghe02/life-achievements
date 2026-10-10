import { describe, expect, it } from 'vitest';
import {
  areaGates,
  areaLocked,
  areaRoot,
  byId,
  childrenOf,
  displayTitle,
  nodesOfArea,
  openIds,
  statusOf,
  TOAST_L1,
  TYPE_NAME,
  undoBlockers,
  wouldCycle,
} from './rules';
import { starterData } from './templates';
import type { LifeData } from './types';

const NOW = new Date(2026, 9, 10, 12);

function withDone(data: LifeData, ...ids: string[]): LifeData {
  const done = { ...data.done };
  for (const id of ids) done[id] = { date: '2026-10-01' };
  return { ...data, done };
}

describe('rules', () => {
  const base = starterData(NOW);

  it('has the type names and toast lines', () => {
    expect(TYPE_NAME).toEqual({ task: '任务', goal: '目标', challenge: '挑战' });
    expect(TOAST_L1.challenge).toBe('挑战已完成！');
  });

  it('caches byId per achievements array', () => {
    const a = byId(base);
    expect(byId(base)).toBe(a);
    expect(byId({ ...base, done: { o_start: { date: '2026-10-01' } } })).toBe(a);
    expect(byId({ ...base, achievements: base.achievements.slice() })).not.toBe(a);
    expect(a.get('o_start')?.title).toBe('开局一棵树');
  });

  it('lists the nodes of one area as a copy', () => {
    const ns = nodesOfArea(base, 'origin');
    expect(ns).toHaveLength(14);
    ns.pop();
    expect(nodesOfArea(base, 'origin')).toHaveLength(14);
    expect(nodesOfArea(base, 'nope')).toEqual([]);
  });

  it('computes status from parents', () => {
    expect(statusOf(base, 'o_start')).toBe('open');
    expect(statusOf(base, 'o_sleep')).toBe('locked');
    const d = withDone(base, 'o_start');
    expect(statusOf(d, 'o_start')).toBe('done');
    expect(statusOf(d, 'o_sleep')).toBe('open');
    expect(statusOf(d, 'missing')).toBe('locked');
  });

  it('needs every parent done', () => {
    const multi = base.achievements.find(n => n.areaId === 'origin' && n.parents.length >= 2);
    expect(multi).toBeDefined();
    const [p1, ...rest] = multi!.parents;
    // make all ancestors done except one parent
    const all = base.achievements.filter(n => n.areaId === 'origin').map(n => n.id);
    const d1 = withDone(base, ...all.filter(id => id !== multi!.id && id !== p1));
    expect(statusOf(d1, multi!.id)).toBe('locked');
    const d2 = withDone(d1, p1, ...rest);
    expect(statusOf(d2, multi!.id)).toBe('open');
  });

  it('ignores parents that no longer exist', () => {
    const data: LifeData = {
      ...base,
      achievements: base.achievements.map(n => (n.id === 'o_sleep' ? { ...n, parents: ['gone'] } : n)),
    };
    expect(statusOf(data, 'o_sleep')).toBe('open');
  });

  it('locks areas behind their gateway', () => {
    expect(areaRoot(base, 'body')?.id).toBe('b_warm_up');
    expect(areaLocked(base, 'body')).toBe(true);
    expect(areaLocked(base, 'origin')).toBe(false);
    expect(areaGates(base, 'body').map(n => n.id)).toEqual(['o_body']);
    expect(areaGates(base, 'origin')).toEqual([]);
    const d = withDone(base, 'o_body');
    expect(areaLocked(d, 'body')).toBe(false);
    expect(statusOf(d, 'b_warm_up')).toBe('open');
    expect(areaRoot(base, 'nope')).toBeUndefined();
    expect(areaLocked(base, 'nope')).toBe(false);
  });

  it('finds children across areas', () => {
    expect(childrenOf(base, 'o_body').map(n => n.id)).toContain('b_warm_up');
    expect(childrenOf(base, 'o_start').every(n => n.parents.includes('o_start'))).toBe(true);
    expect(childrenOf(base, 'nope')).toEqual([]);
  });

  it('hides the title of a hidden locked node', () => {
    const hidden = base.achievements.find(n => n.hidden)!;
    expect(displayTitle(base, hidden)).toBe('???');
    const parentsDone = withDone(base, ...hidden.parents);
    expect(displayTitle(parentsDone, hidden)).toBe(hidden.title);
    const open = base.achievements.find(n => !n.hidden)!;
    expect(displayTitle(base, open)).toBe(open.title);
  });

  it('names done children as undo blockers', () => {
    const d = withDone(base, 'o_start', 'o_sleep');
    expect(undoBlockers(d, 'o_start').map(n => n.id)).toEqual(['o_sleep']);
    expect(undoBlockers(d, 'o_sleep')).toEqual([]);
  });

  it('detects cycles through any area', () => {
    expect(wouldCycle(base, 'o_start', ['o_sleep'])).toBe(true);
    expect(wouldCycle(base, 'o_sleep', ['o_start'])).toBe(false);
    expect(wouldCycle(base, 'o_sleep', ['o_sleep'])).toBe(true);
    // origin's root gated by a body node would loop through o_body -> body root
    expect(wouldCycle(base, 'o_start', ['b_warm_up'])).toBe(true);
    expect(wouldCycle(base, 'b_warm_up', ['m_bookshelf'])).toBe(false);
  });

  it('lists open ids', () => {
    expect([...openIds(base)]).toEqual(['o_start']);
  });
});
