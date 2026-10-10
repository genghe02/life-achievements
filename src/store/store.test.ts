import { afterEach, describe, expect, it, vi } from 'vitest';
import { conflicts, placeNode } from '../domain/layout';
import { levelOf, totals } from '../domain/level';
import { byId, nodesOfArea, statusOf } from '../domain/rules';
import { blankData } from '../domain/templates';
import { parseBackup } from '../domain/validate';
import type { CompleteResult, LifeData } from '../domain/types';
import type { AchievementInput } from './inputs';
import { createPersistence, type UiPrefs } from './persist';
import { createAppStore, MSG } from './store';

const NOW = new Date(2026, 9, 10, 12);
const TODAY = '2026-10-10';

function fakePersist(stored: LifeData | null = null, ui: UiPrefs | null = null) {
  const p = {
    stored,
    ui,
    saves: [] as LifeData[],
    uiSaves: [] as UiPrefs[],
    backups: [] as string[],
    loadData: async () => p.stored,
    loadUi: async () => p.ui,
    saveData: (d: LifeData) => {
      p.saves.push(d);
      p.stored = d;
    },
    saveUi: (u: UiPrefs) => {
      p.uiSaves.push(u);
      p.ui = u;
    },
    setLastBackup: (d: string) => {
      p.backups.push(d);
    },
  };
  return p;
}

function setup(kind: 'starter' | 'blank' | null = 'starter') {
  let t = NOW;
  const persist = fakePersist();
  const store = createAppStore({ persist, now: () => t });
  if (kind) store.getState().start(kind);
  return {
    store,
    persist,
    s: () => store.getState(),
    data: () => store.getState().data,
    node: (id: string) => byId(store.getState().data).get(id)!,
    setNow: (d: Date) => (t = d),
  };
}

type Env = ReturnType<typeof setup>;

/** Complete id and, first, every ancestor it needs. */
function reach(env: Env, id: string) {
  const n = env.node(id);
  for (const p of n.parents) if (statusOf(env.data(), p) !== 'done') reach(env, p);
  if (statusOf(env.data(), id) !== 'done') expect(env.s().complete(id)).not.toBeNull();
}

const input = (patch: Partial<AchievementInput> = {}): AchievementInput => ({
  areaId: 'origin',
  title: '新进度',
  desc: '做到一件新事情',
  type: 'task',
  icon: 'book',
  parents: ['o_start'],
  ...patch,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('init and start', () => {
  it('starts in the new phase when nothing is saved', async () => {
    const env = setup(null);
    expect(env.s().phase).toBe('loading');
    await env.s().init();
    expect(env.s().phase).toBe('new');
  });

  it('loads saved data and restores the area', async () => {
    const a = setup();
    reach(a, 'o_water');
    const persist = fakePersist(a.data(), { areaId: 'mind' });
    const store = createAppStore({ persist, now: () => NOW });
    const p = store.getState().init();
    expect(store.getState().init()).toBe(p);
    await p;
    expect(store.getState().phase).toBe('ready');
    expect(store.getState().data).toEqual(a.data());
    expect(store.getState().areaId).toBe('mind');
  });

  it('falls back to the first area when the saved one is gone', async () => {
    const a = setup();
    const store = createAppStore({ persist: fakePersist(a.data(), { areaId: 'deleted' }), now: () => NOW });
    await store.getState().init();
    expect(store.getState().areaId).toBe('origin');
  });

  it('treats unreadable saved data as a first launch', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { areas: [], achievements: [] } as unknown as LifeData;
    const store = createAppStore({ persist: fakePersist(broken), now: () => NOW });
    await store.getState().init();
    expect(store.getState().phase).toBe('new');
    expect(error).toHaveBeenCalled();
  });

  it('recovers from the newest valid snapshot when the saved data is broken', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = setup();
    good.s().complete('o_start');
    const persist = {
      ...fakePersist({ areas: [] } as unknown as LifeData),
      listSnapshots: async () => [
        { date: '2026-10-09', done: 0, all: 0 },
        { date: '2026-10-08', done: 1, all: 97 },
      ],
      loadSnapshot: async (date: string) => (date === '2026-10-08' ? good.data() : ({ junk: true } as unknown as LifeData)),
    };
    const store = createAppStore({ persist, now: () => NOW });
    await store.getState().init();
    expect(store.getState().phase).toBe('ready');
    expect(store.getState().data).toEqual(good.data());
    expect(warn).toHaveBeenCalled();
  });

  const withSnapshots = (base: ReturnType<typeof fakePersist>, snap: LifeData) => ({
    ...base,
    listSnapshots: async () => [{ date: '2026-10-08', done: 1, all: 97 }],
    loadSnapshot: async (date: string) => (date === '2026-10-08' ? snap : null),
  });

  it('recovers from a snapshot when the saved document is missing but snapshots exist', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = setup();
    good.s().complete('o_start');
    const store = createAppStore({ persist: withSnapshots(fakePersist(null), good.data()), now: () => NOW });
    await store.getState().init();
    expect(store.getState().phase).toBe('ready');
    expect(store.getState().data.done).toHaveProperty('o_start');
  });

  it('recovers from a snapshot when reading the saved document fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = setup();
    good.s().complete('o_start');
    const persist = {
      ...withSnapshots(fakePersist(null), good.data()),
      loadData: async (): Promise<LifeData | null> => {
        throw new Error('read failed');
      },
    };
    const store = createAppStore({ persist, now: () => NOW });
    await store.getState().init();
    expect(store.getState().phase).toBe('ready');
    expect(store.getState().data.done).toHaveProperty('o_start');
  });

  it('keeps the saved data when only the remembered area cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = setup();
    a.s().complete('o_start');
    const persist = {
      ...fakePersist(a.data()),
      loadUi: async (): Promise<UiPrefs | null> => {
        throw new Error('read failed');
      },
    };
    const store = createAppStore({ persist, now: () => NOW });
    await store.getState().init();
    expect(store.getState().phase).toBe('ready');
    expect(store.getState().data).toEqual(a.data());
    expect(store.getState().areaId).toBe('origin');
  });

  it('does not let a late load override a start', async () => {
    const a = setup();
    const store = createAppStore({ persist: fakePersist(a.data()), now: () => NOW });
    const p = store.getState().init();
    store.getState().start('blank');
    await p;
    expect(store.getState().data.achievements).toHaveLength(7);
  });

  it('never saves the placeholder before start or import', async () => {
    const env = setup(null);
    env.s().setSettings({ sound: false });
    env.s().saveReward({ name: '奖励', cost: 5, icon: 'cake' });
    await env.s().init();
    expect(env.s().phase).toBe('new');
    env.s().setSettings({ labels: false });
    expect(env.persist.saves).toEqual([]);
    expect(env.persist.stored).toBeNull();
  });

  it('starts from the template or blank and saves', () => {
    const env = setup('starter');
    expect(env.s().phase).toBe('ready');
    expect(env.data().achievements).toHaveLength(97);
    expect(env.s().areaId).toBe('origin');
    expect(env.persist.saves).toHaveLength(1);
    expect(env.persist.uiSaves).toEqual([{ areaId: 'origin' }]);
    env.s().start('blank');
    expect(env.data().achievements).toHaveLength(7);
  });

  it('keeps sound and label settings across a restart', () => {
    const env = setup();
    env.s().setSettings({ sound: false, labels: false });
    env.s().start('starter');
    expect(env.data().settings).toEqual({ sound: false, labels: false });
    expect(env.data().done).toEqual({});
  });
});

describe('setArea', () => {
  it('switches to an existing area and remembers it', () => {
    const env = setup();
    env.s().setArea('mind');
    expect(env.s().areaId).toBe('mind');
    expect(env.persist.ui).toEqual({ areaId: 'mind' });
    env.s().setArea('nope');
    expect(env.s().areaId).toBe('mind');
  });
});

describe('complete', () => {
  it('marks an open achievement done and reports the change', () => {
    const env = setup();
    const res = env.s().complete('o_start');
    expect(res).toEqual<CompleteResult>({
      id: 'o_start',
      xpGained: 20,
      ptsGained: 1,
      levelBefore: 0,
      levelAfter: 1,
      unlockedNodes: ['o_sleep', 'o_water', 'o_tidy'],
      unlockedAreas: [],
    });
    expect(env.data().done.o_start).toEqual({ date: TODAY });
    expect(env.data().updatedAt).toBe(NOW.toISOString());
    expect(env.persist.stored).toBe(env.data());
  });

  it('only lists nodes whose every prerequisite is now done', () => {
    const env = setup();
    reach(env, 'o_sleep');
    expect(env.s().complete('o_water')!.unlockedNodes).toEqual(['o_body']);
  });

  it('reports areas unlocked through a gateway', () => {
    const env = setup();
    reach(env, 'o_sleep');
    reach(env, 'o_water');
    const res = env.s().complete('o_body')!;
    expect(res.unlockedNodes).toEqual(['o_offline', 'b_warm_up']);
    expect(res.unlockedAreas).toEqual(['body']);
    expect(statusOf(env.data(), 'b_warm_up')).toBe('open');
  });

  it('reports level changes from totals', () => {
    const env = setup();
    reach(env, 'o_body');
    const before = levelOf(totals(env.data()).xp).level;
    const res = env.s().complete('o_offline')!;
    expect(res.levelBefore).toBe(before);
    expect(res.levelAfter).toBe(levelOf(totals(env.data()).xp).level);
    expect(res.levelAfter).toBeGreaterThan(res.levelBefore);
  });

  it('refuses locked, done and unknown achievements', () => {
    const env = setup();
    expect(env.s().complete('o_sleep')).toBeNull();
    env.s().complete('o_start');
    const saves = env.persist.saves.length;
    expect(env.s().complete('o_start')).toBeNull();
    expect(env.s().complete('nope')).toBeNull();
    expect(env.persist.saves).toHaveLength(saves);
  });

  it('takes a past date and a note; future or bad dates become today', () => {
    const env = setup();
    env.s().complete('o_start', { date: '2026-09-01', note: '  第一步  ' });
    expect(env.data().done.o_start).toEqual({ date: '2026-09-01', note: '第一步' });
    env.s().complete('o_sleep', { date: '2027-01-01' });
    expect(env.data().done.o_sleep.date).toBe(TODAY);
    env.s().complete('o_water', { date: '10/01/2026', note: 'x'.repeat(300) });
    expect(env.data().done.o_water.date).toBe(TODAY);
    expect(env.data().done.o_water.note).toHaveLength(200);
  });

  it('remembers counter progress for undo', () => {
    const env = setup();
    reach(env, 'o_body');
    env.s().bump('o_offline', 1);
    env.s().bump('o_offline', 1);
    env.s().complete('o_offline');
    expect(env.data().done.o_offline).toEqual({ date: TODAY, prevProgress: 2 });
    expect(env.data().progress.o_offline).toBe(7);
  });
});

describe('undo', () => {
  it('is blocked by done children, named in 「」', () => {
    const env = setup();
    reach(env, 'o_sleep');
    reach(env, 'o_water');
    expect(env.s().undo('o_start')).toEqual({ ok: false, error: '先撤销「甜蜜的梦」「无限水源」的完成，再撤销这个。' });
    expect(env.data().done).toHaveProperty('o_start');
  });

  it('removes the done entry and restores counter progress', () => {
    const env = setup();
    reach(env, 'o_body');
    env.s().bump('o_offline', 1);
    env.s().complete('o_offline');
    expect(env.s().undo('o_offline')).toEqual({ ok: true });
    expect(env.data().done).not.toHaveProperty('o_offline');
    expect(env.data().progress.o_offline).toBe(1);
    expect(statusOf(env.data(), 'o_offline')).toBe('open');
  });

  it('clears a counter that was empty before completion', () => {
    const env = setup();
    reach(env, 'o_offline');
    env.s().undo('o_offline');
    expect(env.data().progress).not.toHaveProperty('o_offline');
  });

  it('puts a counter just below its target when completed by counting up', () => {
    const env = setup();
    reach(env, 'o_body');
    for (let i = 0; i < 7; i++) env.s().bump('o_offline', 1);
    expect(env.data().done).toHaveProperty('o_offline');
    env.s().undo('o_offline');
    expect(env.data().progress.o_offline).toBe(6);
  });

  it('is blocked when the emeralds were spent', () => {
    const env = setup();
    reach(env, 'o_body'); // 1 + 1 + 1 + 2 emeralds
    const sleep = env.data().rewards.find(r => r.cost === 5)!;
    expect(env.s().buy(sleep.id).ok).toBe(true);
    expect(env.s().undo('o_body')).toEqual({ ok: false, error: MSG.undoSpent(2) });
  });

  it('lets a node worth no emeralds be undone while the balance is negative', () => {
    const env = setup();
    env.s().complete('o_start');
    expect(env.s().saveAchievement({ ...input(), title: '甜蜜的梦', pts: 0 }, 'o_sleep').ok).toBe(true);
    env.s().complete('o_sleep');
    const debt = { id: 't_old', rewardId: null, name: '旧账', cost: 5, icon: 'cake', date: '2026-10-01' };
    expect(env.s().importBackup({ ...env.data(), trades: [debt] })).toEqual({ ok: true });
    expect(totals(env.data()).emeralds).toBe(-4);
    expect(env.s().undo('o_sleep')).toEqual({ ok: true });
    expect(env.s().undo('o_start')).toEqual({ ok: false, error: MSG.undoSpent(5) });
  });

  it('fails for unknown and not-done achievements', () => {
    const env = setup();
    expect(env.s().undo('nope')).toEqual({ ok: false, error: MSG.noNode });
    expect(env.s().undo('o_start')).toEqual({ ok: false, error: MSG.notDone });
  });
});

describe('bump', () => {
  it('counts up and down between 0 and target - 1', () => {
    const env = setup();
    expect(env.s().bump('o_offline', 1)).toBeNull(); // locked
    expect(env.data().progress).toEqual({});
    reach(env, 'o_body');
    expect(env.s().bump('o_offline', 1)).toBeNull();
    expect(env.data().progress.o_offline).toBe(1);
    env.s().bump('o_offline', -1);
    expect(env.data().progress).not.toHaveProperty('o_offline');
    const saves = env.persist.saves.length;
    env.s().bump('o_offline', -1);
    expect(env.data().progress).not.toHaveProperty('o_offline');
    expect(env.persist.saves).toHaveLength(saves);
  });

  it('completes the achievement when the target is reached', () => {
    const env = setup();
    reach(env, 'o_body');
    for (let i = 0; i < 6; i++) expect(env.s().bump('o_offline', 1)).toBeNull();
    const res = env.s().bump('o_offline', 1);
    expect(res).toMatchObject({ id: 'o_offline', xpGained: 120, ptsGained: 6 });
    expect(env.data().done.o_offline).toEqual({ date: TODAY, prevProgress: 6 });
    expect(env.data().progress.o_offline).toBe(7);
    expect(env.s().bump('o_offline', 1)).toBeNull();
  });

  it('ignores achievements without a counter', () => {
    const env = setup();
    expect(env.s().bump('o_start', 1)).toBeNull();
    expect(env.data().progress).toEqual({});
  });
});

describe('setDoneInfo', () => {
  it('edits date and note of a done achievement', () => {
    const env = setup();
    env.s().complete('o_start');
    expect(env.s().setDoneInfo('o_start', { date: '2025-12-31', note: '  好的开始 ' })).toEqual({ ok: true });
    expect(env.data().done.o_start).toEqual({ date: '2025-12-31', note: '好的开始' });
    env.s().setDoneInfo('o_start', { note: '' });
    expect(env.data().done.o_start).toEqual({ date: '2025-12-31' });
  });

  it('validates', () => {
    const env = setup();
    expect(env.s().setDoneInfo('o_start', { note: 'x' })).toEqual({ ok: false, error: MSG.notDone });
    expect(env.s().setDoneInfo('nope', { note: 'x' })).toEqual({ ok: false, error: MSG.noNode });
    env.s().complete('o_start');
    expect(env.s().setDoneInfo('o_start', { date: '2026-10-11' })).toEqual({ ok: false, error: MSG.futureDate });
    expect(env.s().setDoneInfo('o_start', { date: '2026-02-30' })).toEqual({ ok: false, error: MSG.badDate });
    expect(env.s().setDoneInfo('o_start', { note: '字'.repeat(201) })).toEqual({ ok: false, error: MSG.noteLong });
    expect(env.data().done.o_start).toEqual({ date: TODAY });
  });

  it('does not save when nothing changed', () => {
    const env = setup();
    env.s().complete('o_start');
    const saves = env.persist.saves.length;
    env.s().setDoneInfo('o_start', { date: TODAY });
    expect(env.persist.saves).toHaveLength(saves);
  });
});

describe('saveAchievement: create', () => {
  it('places a new achievement after its prerequisites without tangles', () => {
    const env = setup();
    const res = env.s().saveAchievement(input({ parents: ['o_cook', 'o_wealth'] }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const n = env.node(res.id);
    expect(n).toMatchObject({ areaId: 'origin', title: '新进度', type: 'task', xp: 40, pts: 2, parents: ['o_cook', 'o_wealth'] });
    expect(n.x).toBeGreaterThan(2);
    expect(conflicts(nodesOfArea(env.data(), 'origin'))).toBe(0);
    expect(statusOf(env.data(), res.id)).toBe('locked');
  });

  it('uses type defaults, keeps given values and optional fields', () => {
    const env = setup();
    const a = env.s().saveAchievement(input({ type: 'challenge' }));
    expect(a.ok && env.node(a.id)).toMatchObject({ xp: 300, pts: 15 });
    const b = env.s().saveAchievement(
      input({ title: ' 读书 ', type: 'goal', xp: 0, pts: 9, target: 12, unit: '', tip: ' 慢慢来 ', reward: '新书', hidden: true }),
    );
    expect(b.ok && env.node(b.id)).toMatchObject({
      title: '读书',
      xp: 0,
      pts: 9,
      target: 12,
      unit: '次',
      tip: '慢慢来',
      reward: '新书',
      hidden: true,
    });
    const c = env.s().saveAchievement(input({ target: undefined, unit: '天', tip: '', hidden: false }));
    expect(c.ok).toBe(true);
    if (c.ok) {
      const n = env.node(c.id);
      for (const k of ['target', 'unit', 'tip', 'reward', 'hidden']) expect(n).not.toHaveProperty(k);
    }
  });

  it('reads an emptied number field (NaN or null) as left empty', () => {
    const env = setup();
    const res = env.s().saveAchievement(input({ type: 'goal', target: NaN, xp: NaN, pts: null as unknown as number }));
    if (!res.ok) throw new Error(res.error);
    expect(env.node(res.id)).toMatchObject({ xp: 120, pts: 6 });
    expect(env.node(res.id)).not.toHaveProperty('target');
  });

  it('keeps many additions conflict-free', () => {
    const env = setup();
    const ids = env.data().achievements.filter(n => n.areaId === 'origin').map(n => n.id);
    for (let i = 0; i < 25; i++) env.s().saveAchievement(input({ title: `新${i}`, parents: [ids[(i * 5) % ids.length]] }));
    expect(conflicts(nodesOfArea(env.data(), 'origin'))).toBe(0);
  });

  it.each([
    [{ areaId: 'nope' }, MSG.noArea],
    [{ title: '  ' }, MSG.titleEmpty],
    [{ title: '一二三四五六七八九十一二三' }, MSG.titleLong],
    [{ desc: '' }, MSG.descEmpty],
    [{ desc: '字'.repeat(61) }, MSG.descLong],
    [{ tip: '字'.repeat(61) }, MSG.tipLong],
    [{ type: 'quest' as never }, MSG.type],
    [{ icon: 'dragon' }, MSG.icon],
    [{ target: 1 }, MSG.target],
    [{ target: 10000 }, MSG.target],
    [{ target: 2.5 }, MSG.target],
    [{ target: 3, unit: '一二三四五' }, MSG.unitLong],
    [{ reward: '字'.repeat(21) }, MSG.rewardLong],
    [{ xp: -1 }, MSG.xp],
    [{ xp: 5001 }, MSG.xp],
    [{ pts: 1.5 }, MSG.pts],
    [{ pts: 501 }, MSG.pts],
    [{ parents: [] }, MSG.parentNone],
    [{ parents: ['gone'] }, MSG.parentGone],
    [{ parents: ['b_warm_up'] }, MSG.parentArea],
  ])('rejects %o', (patch, error) => {
    const env = setup();
    const before = env.data();
    expect(env.s().saveAchievement(input(patch))).toEqual({ ok: false, error });
    expect(env.data()).toBe(before);
  });

  it('accepts limits exactly', () => {
    const env = setup();
    const res = env.s().saveAchievement(
      input({ title: '字'.repeat(12), desc: '字'.repeat(60), tip: '字'.repeat(60), reward: '字'.repeat(20), target: 9999, unit: '四个字呀', xp: 5000, pts: 500 }),
    );
    expect(res.ok).toBe(true);
  });

  it('makes room under a crowded node by inserting a row', () => {
    const env = setup();
    const before = nodesOfArea(env.data(), 'bond');
    const res = env.s().saveAchievement(input({ areaId: 'bond', parents: ['r_new_friends'] }));
    expect(res.ok).toBe(true);
    const after = nodesOfArea(env.data(), 'bond');
    expect(after).toHaveLength(before.length + 1);
    expect(conflicts(after)).toBe(0);
    // the existing nodes keep their order: some moved down by exactly one row, none moved up or sideways
    for (const b of before) {
      const a = after.find(n => n.id === b.id)!;
      expect(a.x).toBe(b.x);
      expect([b.y, b.y + 1]).toContain(a.y);
    }
    expect(after.some(n => n.y !== before.find(b => b.id === n.id)?.y)).toBe(true);
  });

  it('says when prerequisites are too far apart', () => {
    const env = setup();
    const ns = nodesOfArea(env.data(), 'origin');
    let pair: string[] | null = null;
    for (let i = 0; i < ns.length && !pair; i++) {
      for (let j = i + 1; j < ns.length && !pair; j++) if (!placeNode(ns, [ns[i].id, ns[j].id])) pair = [ns[i].id, ns[j].id];
    }
    expect(pair).not.toBeNull();
    expect(env.s().saveAchievement(input({ parents: pair! }))).toEqual({ ok: false, error: MSG.noRoom });
  });
});

describe('saveAchievement: edit', () => {
  it('keeps the cell when only the text changes', () => {
    const env = setup();
    const before = env.node('o_cook');
    const res = env.s().saveAchievement(input({ title: '改名', parents: before.parents, type: before.type, icon: before.icon }), 'o_cook');
    expect(res).toEqual({ ok: true, id: 'o_cook' });
    expect(env.node('o_cook')).toMatchObject({ title: '改名', x: before.x, y: before.y });
  });

  it('keeps the cell when new prerequisites still allow it', () => {
    const env = setup();
    // o_cook (2,1) from o_water + o_tidy -> only o_water: still a clean spot
    const before = env.node('o_cook');
    expect(env.s().saveAchievement(input({ parents: ['o_water'] }), 'o_cook').ok).toBe(true);
    expect(env.node('o_cook')).toMatchObject({ x: before.x, y: before.y, parents: ['o_water'] });
    expect(conflicts(nodesOfArea(env.data(), 'origin'))).toBe(0);
  });

  it('moves the node when its cell no longer works', () => {
    const env = setup();
    // o_road (3,3) under o_offline (3,-1) has to move right of column 3
    const res = env.s().saveAchievement(input({ title: '离开出生点', type: 'goal', parents: ['o_offline'] }), 'o_road');
    expect(res).toEqual({ ok: true, id: 'o_road' });
    expect(env.node('o_road').x).toBeGreaterThan(3);
    expect(conflicts(nodesOfArea(env.data(), 'origin'))).toBe(0);
    // its child in another area is unaffected
    expect(env.node('e_weekend_escape').parents).toEqual(['o_road']);
  });

  it('refuses cycles, self and area changes', () => {
    const env = setup();
    expect(env.s().saveAchievement(input({ parents: ['o_home'] }), 'o_offline')).toEqual({ ok: false, error: MSG.cycle });
    // o_sleep would have to sit right of o_water and left of its children in column 2
    expect(env.s().saveAchievement(input({ parents: ['o_water'] }), 'o_sleep')).toEqual({ ok: false, error: MSG.noRoomOne });
    expect(env.s().saveAchievement(input({ parents: ['o_cook'] }), 'o_cook')).toEqual({ ok: false, error: MSG.parentSelf });
    expect(env.s().saveAchievement(input({ areaId: 'body', parents: ['b_warm_up'] }), 'o_cook')).toEqual({ ok: false, error: MSG.moveArea });
    expect(env.s().saveAchievement(input(), 'nope')).toEqual({ ok: false, error: MSG.noNode });
  });

  it('lets a root take gateways from other areas only', () => {
    const env = setup();
    const root = env.node('b_warm_up');
    const asRoot = (parents: string[]) => input({ areaId: 'body', title: root.title, parents });
    expect(env.s().saveAchievement(asRoot(['b_quit_soda']), 'b_warm_up')).toEqual({ ok: false, error: MSG.rootParent });
    expect(env.s().saveAchievement(asRoot(['m_bookshelf']), 'b_warm_up').ok).toBe(true);
    expect(env.node('b_warm_up')).toMatchObject({ x: 0, y: root.y, parents: ['m_bookshelf'] });
    expect(env.s().saveAchievement(asRoot([]), 'b_warm_up').ok).toBe(true);
    expect(statusOf(env.data(), 'b_warm_up')).toBe('open');
    // origin's root gated by something that depends on origin
    expect(env.s().saveAchievement(input({ parents: ['m_bookshelf'] }), 'o_start')).toEqual({ ok: false, error: MSG.cycle });
  });

  it('keeps counter values in range when the target changes', () => {
    const env = setup();
    reach(env, 'o_body');
    for (let i = 0; i < 5; i++) env.s().bump('o_offline', 1);
    const base = { title: '离线模式', type: 'goal' as const, parents: ['o_body'] };
    env.s().saveAchievement(input({ ...base, target: 3, unit: '天' }), 'o_offline');
    expect(env.data().progress.o_offline).toBe(2);
    env.s().saveAchievement(input({ ...base }), 'o_offline');
    expect(env.data().progress).not.toHaveProperty('o_offline');
    env.s().saveAchievement(input({ ...base, target: 4 }), 'o_offline');
    env.s().bump('o_offline', 1);
    env.s().complete('o_offline');
    env.s().saveAchievement(input({ ...base, target: 10 }), 'o_offline');
    expect(env.data().progress.o_offline).toBe(10);
    expect(env.data().done.o_offline.prevProgress).toBe(1);
  });
});

describe('deleteAchievement', () => {
  it('refuses the root', () => {
    const env = setup();
    expect(env.s().deleteAchievement('o_start')).toEqual({ ok: false, error: MSG.deleteRoot });
  });

  it('names the achievements that depend on it, in any area', () => {
    const env = setup();
    expect(env.s().deleteAchievement('o_body')).toEqual({ ok: false, error: '先删除或修改「离线模式」「热身完毕」，它们把这个进度当作前置。' });
    // a hidden locked dependant is not spoiled
    expect(env.s().deleteAchievement('o_home')).toEqual({ ok: false, error: MSG.deleteDeps('「???」') });
  });

  it('asks to undo a done achievement first', () => {
    const env = setup();
    env.s().complete('o_start');
    const add = env.s().saveAchievement(input());
    if (!add.ok) throw new Error(add.error);
    env.s().complete(add.id);
    expect(env.s().deleteAchievement(add.id)).toEqual({ ok: false, error: MSG.deleteDone });
  });

  it('removes a leaf with its counter progress', () => {
    const env = setup();
    env.s().complete('o_start');
    const res = env.s().saveAchievement(input({ target: 5 }));
    if (!res.ok) throw new Error(res.error);
    env.s().bump(res.id, 1);
    expect(env.data().progress[res.id]).toBe(1);
    expect(env.s().deleteAchievement(res.id)).toEqual({ ok: true });
    expect(byId(env.data()).has(res.id)).toBe(false);
    expect(env.data().progress).not.toHaveProperty(res.id);
    expect(env.s().deleteAchievement(res.id)).toEqual({ ok: false, error: MSG.noNode });
  });
});

describe('moveAchievement', () => {
  it('moves a node to a valid free cell', () => {
    const env = setup();
    expect(env.s().moveAchievement('o_tree', 6, 0)).toEqual({ ok: true });
    expect(env.node('o_tree')).toMatchObject({ x: 6, y: 0 });
    expect(conflicts(nodesOfArea(env.data(), 'origin'))).toBe(0);
  });

  it('accepts its own cell without saving', () => {
    const env = setup();
    const saves = env.persist.saves.length;
    expect(env.s().moveAchievement('o_tree', 5, 0)).toEqual({ ok: true });
    expect(env.persist.saves).toHaveLength(saves);
  });

  it('explains why a cell is not allowed', () => {
    const env = setup();
    expect(env.s().moveAchievement('o_start', 1, 5)).toEqual({ ok: false, error: MSG.placeRoot });
    expect(env.s().moveAchievement('o_sleep', 0, 5)).toEqual({ ok: false, error: MSG.placeFirstCol });
    expect(env.s().moveAchievement('o_home', 3, 4)).toEqual({ ok: false, error: MSG.placeColumn });
    expect(env.s().moveAchievement('o_home', 6, 0)).toEqual({ ok: false, error: MSG.placeColumn });
    expect(env.s().moveAchievement('o_tree', 4, 0)).toEqual({ ok: false, error: MSG.placeColumn });
    expect(env.s().moveAchievement('o_road', 3, 1)).toEqual({ ok: false, error: MSG.placeTaken });
    expect(env.s().moveAchievement('o_road', 3, -2)).toEqual({ ok: false, error: MSG.placeTangle });
    expect(env.s().moveAchievement('o_road', 3.5, 2)).toEqual({ ok: false, error: MSG.placeBad });
    expect(env.s().moveAchievement('nope', 1, 1)).toEqual({ ok: false, error: MSG.noNode });
    expect(env.node('o_road')).toMatchObject({ x: 3, y: 3 });
  });

  it('refuses cells off the grid, so the saved data always loads again', async () => {
    const env = setup();
    expect(env.s().moveAchievement('o_tree', 5, 1000)).toEqual({ ok: false, error: MSG.placeBad });
    expect(env.s().moveAchievement('o_tree', 1000, 0)).toEqual({ ok: false, error: MSG.placeBad });
    expect(env.node('o_tree')).toMatchObject({ x: 5, y: 0 });
    const again = createAppStore({ persist: fakePersist(env.data()), now: () => NOW });
    await again.getState().init();
    expect(again.getState().phase).toBe('ready');
  });
});

describe('areas', () => {
  const area = { name: '新领域', subtitle: '一个开始', icon: 'heart', bg: 'grass' as const };

  it('creates an area with one open root', () => {
    const env = setup();
    const res = env.s().saveArea(area);
    if (!res.ok) throw new Error(res.error);
    expect(env.data().areas.at(-1)).toEqual({ id: res.id, ...area });
    const ns = nodesOfArea(env.data(), res.id);
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({ title: '新的开始', desc: '这个领域的第一步', type: 'goal', icon: 'heart', x: 0, y: 0, parents: [], xp: 120, pts: 6 });
    expect(statusOf(env.data(), ns[0].id)).toBe('open');
    expect(env.s().areaId).toBe('origin');
  });

  it('edits an area', () => {
    const env = setup();
    expect(env.s().saveArea({ ...area, name: ' 身体 ' }, 'body')).toEqual({ ok: true, id: 'body' });
    expect(env.data().areas[1]).toEqual({ id: 'body', ...area, name: '身体' });
  });

  it.each([
    [{ name: ' ' }, MSG.areaEmpty],
    [{ name: '一二三四五六七' }, MSG.areaLong],
    [{ subtitle: '字'.repeat(21) }, MSG.subtitleLong],
    [{ icon: 'nope' }, MSG.icon],
    [{ bg: 'lava' as never }, MSG.bg],
  ])('rejects %o', (patch, error) => {
    const env = setup();
    expect(env.s().saveArea({ ...area, ...patch })).toEqual({ ok: false, error });
  });

  it('rejects editing a missing area', () => {
    const env = setup();
    expect(env.s().saveArea(area, 'nope')).toEqual({ ok: false, error: MSG.noArea });
  });

  it('deletes an area with its achievements and the gateways into it', () => {
    const env = setup();
    reach(env, 'o_body');
    env.s().bump('o_offline', 1);
    const res = env.s().deleteArea('origin');
    expect(res).toEqual({ ok: true });
    const d = env.data();
    expect(d.areas.map(a => a.id)).toEqual(['body', 'mind', 'craft', 'wealth', 'bond', 'road']);
    expect(d.achievements.some(n => n.areaId === 'origin')).toBe(false);
    expect(d.done).toEqual({});
    expect(d.progress).toEqual({});
    expect(env.node('b_warm_up').parents).toEqual([]);
    expect(statusOf(d, 'm_bookshelf')).toBe('open');
    expect(env.s().areaId).toBe('body');
    expect(env.persist.ui).toEqual({ areaId: 'body' });
  });

  it('keeps the current area when another one is deleted', () => {
    const env = setup();
    env.s().setArea('mind');
    env.s().deleteArea('road');
    expect(env.s().areaId).toBe('mind');
  });

  it('keeps the last area', () => {
    const env = setup('blank');
    for (const id of ['origin', 'body', 'mind', 'craft', 'wealth', 'bond']) expect(env.s().deleteArea(id).ok).toBe(true);
    expect(env.s().deleteArea('road')).toEqual({ ok: false, error: MSG.lastArea });
    expect(env.s().deleteArea('nope')).toEqual({ ok: false, error: MSG.noArea });
  });

  it('moves tabs left and right', () => {
    const env = setup();
    env.s().moveArea('body', 1);
    expect(env.data().areas.slice(0, 3).map(a => a.id)).toEqual(['origin', 'mind', 'body']);
    env.s().moveArea('body', -1);
    env.s().moveArea('body', -1);
    expect(env.data().areas[0].id).toBe('body');
    const before = env.data();
    env.s().moveArea('body', -1);
    env.s().moveArea('road', 1);
    env.s().moveArea('nope', 1);
    expect(env.data()).toBe(before);
  });
});

describe('rewards and trades', () => {
  it('refuses a trade without enough emeralds', () => {
    const env = setup();
    const tea = env.data().rewards[0];
    expect(env.s().buy(tea.id)).toEqual({ ok: false, error: '绿宝石不够，还差 3 颗。' });
    env.s().complete('o_start');
    expect(env.s().buy(tea.id)).toEqual({ ok: false, error: MSG.poor(2) });
    expect(env.s().buy('nope')).toEqual({ ok: false, error: MSG.noReward });
  });

  it('logs a trade and spends emeralds', () => {
    const env = setup();
    reach(env, 'o_body');
    const tea = env.data().rewards[0];
    const res = env.s().buy(tea.id);
    if (!res.ok) throw new Error(res.error);
    expect(res.entry).toMatchObject({ rewardId: tea.id, name: tea.name, cost: tea.cost, icon: tea.icon, date: TODAY });
    expect(env.data().trades).toEqual([res.entry]);
    expect(totals(env.data()).emeralds).toBe(5 - 3);
  });

  it('creates, edits and deletes rewards', () => {
    const env = setup();
    const add = env.s().saveReward({ name: ' 新耳机 ', cost: 30, icon: 'music_disc' });
    if (!add.ok) throw new Error(add.error);
    expect(env.data().rewards.at(-1)).toEqual({ id: add.id, name: '新耳机', cost: 30, icon: 'music_disc' });
    expect(env.s().saveReward({ name: '好耳机', cost: 40, icon: 'music_disc' }, add.id)).toEqual({ ok: true, id: add.id });
    expect(env.data().rewards.at(-1)).toMatchObject({ name: '好耳机', cost: 40 });
    expect(env.s().saveReward({ name: 'x', cost: 1, icon: 'book' }, 'nope')).toEqual({ ok: false, error: MSG.noReward });
  });

  it.each([
    [{ name: '' }, MSG.rewardEmpty],
    [{ name: '一二三四五六七八九十一二三' }, MSG.rewardNameLong],
    [{ cost: 0 }, MSG.cost],
    [{ cost: 1000 }, MSG.cost],
    [{ cost: 2.5 }, MSG.cost],
    [{ icon: 'nope' }, MSG.icon],
  ])('rejects reward %o', (patch, error) => {
    const env = setup();
    expect(env.s().saveReward({ name: '奖励', cost: 5, icon: 'cake', ...patch })).toEqual({ ok: false, error });
  });

  it('keeps the trade log when a reward is deleted', () => {
    const env = setup();
    reach(env, 'o_body');
    const tea = env.data().rewards[0];
    env.s().buy(tea.id);
    env.s().deleteReward(tea.id);
    expect(env.data().rewards.some(r => r.id === tea.id)).toBe(false);
    expect(env.data().trades[0]).toMatchObject({ rewardId: null, name: tea.name, cost: 3 });
    const before = env.data();
    env.s().deleteReward('nope');
    expect(env.data()).toBe(before);
  });
});

describe('settings', () => {
  it('changes only the given booleans and skips no-op saves', () => {
    const env = setup();
    env.s().setSettings({ sound: false });
    expect(env.data().settings).toEqual({ sound: false, labels: true });
    const saves = env.persist.saves.length;
    env.s().setSettings({ sound: false });
    env.s().setSettings({ labels: 'x' as never });
    expect(env.persist.saves).toHaveLength(saves);
  });
});

describe('updatedAt', () => {
  it('is set by every mutation', () => {
    const env = setup();
    const later = new Date(2026, 9, 10, 18);
    env.setNow(later);
    env.s().complete('o_start');
    expect(env.data().updatedAt).toBe(later.toISOString());
    expect(env.data().createdAt).toBe(NOW.toISOString());
    const at = (d: Date, fn: () => unknown) => {
      env.setNow(d);
      fn();
      expect(env.data().updatedAt).toBe(d.toISOString());
    };
    at(new Date(2026, 9, 10, 19), () => env.s().setSettings({ labels: false }));
    at(new Date(2026, 9, 10, 20), () => env.s().moveArea('body', 1));
    at(new Date(2026, 9, 10, 21), () => env.s().saveReward({ name: '奖励', cost: 5, icon: 'cake' }));
    at(new Date(2026, 9, 10, 22), () => env.s().undo('o_start'));
  });
});

describe('backups', () => {
  it('exports a backup file and remembers the date', () => {
    const env = setup();
    const file = env.s().exportBackup();
    expect(file).toEqual({ app: 'life-achievements', version: 1, exportedAt: NOW.toISOString(), data: env.data() });
    expect(env.persist.backups).toEqual([TODAY]);
  });

  it('round-trips through JSON into a fresh store', () => {
    const a = setup();
    reach(a, 'o_offline');
    reach(a, 'b_warm_up');
    a.s().complete('o_tidy', { note: '干净了' });
    a.s().bump('o_home', 1);
    const tea = a.data().rewards[0];
    a.s().buy(tea.id);
    a.s().saveAchievement(input({ title: '自己加的', parents: ['o_tidy'], target: 3, unit: '次' }));
    a.s().saveArea({ name: '爱好', subtitle: '', icon: 'music_disc', bg: 'planks' });
    const json = JSON.stringify(a.s().exportBackup());

    const b = setup(null);
    expect(b.s().importBackup(JSON.parse(json))).toEqual({ ok: true });
    expect(b.s().phase).toBe('ready');
    expect(b.data()).toEqual(a.data());
    expect(b.s().areaId).toBe('origin');
    expect(b.persist.stored).toEqual(a.data());
  });

  it('accepts the JSON text too', () => {
    const a = setup();
    const b = setup('blank');
    b.s().setArea('road');
    expect(b.s().importBackup(JSON.stringify(a.s().exportBackup()))).toEqual({ ok: true });
    expect(b.data().achievements).toHaveLength(97);
    expect(b.s().areaId).toBe('road');
  });

  it('leaves data untouched when the file is bad', () => {
    const env = setup();
    env.s().complete('o_start');
    const before = env.data();
    const res = env.s().importBackup({ hello: 'world' });
    expect(res.ok).toBe(false);
    expect(env.data()).toBe(before);
  });

  it('falls back to the first area when the imported data lacks the current one', () => {
    const env = setup();
    env.s().setArea('road');
    expect(env.s().importBackup(blankData(NOW))).toEqual({ ok: true });
    expect(env.s().areaId).toBe('road');
    const one = { ...blankData(NOW) };
    one.areas = one.areas.slice(0, 1);
    one.achievements = one.achievements.slice(0, 1);
    expect(env.s().importBackup(one)).toEqual({ ok: true });
    expect(env.s().areaId).toBe('origin');
  });
});

describe('persistence round trip (IndexedDB)', () => {
  it('reloads everything into a fresh store', async () => {
    const name = `store-rt-${Date.now()}`;
    const p1 = createPersistence({ dbName: name, autoFlush: false });
    const a = createAppStore({ persist: p1, now: () => NOW });
    await a.getState().init();
    expect(a.getState().phase).toBe('new');
    a.getState().start('starter');
    a.getState().complete('o_start', { note: '出发' });
    a.getState().complete('o_water');
    a.getState().setArea('craft');
    a.getState().saveArea({ name: '音乐', subtitle: '弹一首曲子', icon: 'music_disc', bg: 'planks' });
    await p1.flush();

    const p2 = createPersistence({ dbName: name, autoFlush: false });
    const b = createAppStore({ persist: p2, now: () => NOW });
    await b.getState().init();
    expect(b.getState().phase).toBe('ready');
    expect(b.getState().data).toEqual(a.getState().data);
    expect(b.getState().areaId).toBe('craft');
    expect(await p2.listSnapshots()).toEqual([{ date: TODAY, done: 2, all: 98 }]);
  });
});

describe('random action sequences', () => {
  // mulberry32: a small seeded generator, so a failure names a reproducible seed
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const canon = (v: unknown) =>
    JSON.stringify(v, (_k, val: unknown) =>
      val && typeof val === 'object' && !Array.isArray(val)
        ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
        : val,
    );

  /** What every action must keep true (see the known issues for done-with-undone-parent and emeralds). */
  function problems(d: LifeData): string[] {
    const out: string[] = [];
    const map = byId(d);
    for (const a of d.areas) {
      const ns = nodesOfArea(d, a.id);
      if (ns.filter(n => n.x === 0).length !== 1) out.push(`area ${a.id}: not exactly one root`);
      if (conflicts(ns)) out.push(`area ${a.id}: ${conflicts(ns)} conflicts`);
    }
    for (const n of d.achievements) {
      if (!d.areas.some(a => a.id === n.areaId)) out.push(`${n.id}: no area`);
      for (const pid of n.parents) {
        const p = map.get(pid);
        if (!p) out.push(`${n.id}: dangling prerequisite ${pid}`);
        else if (n.x === 0 ? p.areaId === n.areaId : p.areaId !== n.areaId || p.x >= n.x) out.push(`${n.id}: illegal prerequisite ${pid}`);
      }
      const v = d.progress[n.id];
      const done = Object.hasOwn(d.done, n.id);
      if (v !== undefined && (!n.target || (done ? v !== n.target : v < 1 || v >= n.target))) out.push(`${n.id}: progress ${v}`);
      if (v === undefined && n.target && done) out.push(`${n.id}: done counter without progress`);
    }
    for (const id of [...Object.keys(d.done), ...Object.keys(d.progress)]) if (!map.has(id)) out.push(`dangling record ${id}`);
    const again = parseBackup(JSON.parse(JSON.stringify(d)), NOW);
    if (!again.ok) out.push(`does not load again: ${again.error}`);
    else if (canon(again.data) !== canon(d)) out.push('changes when loaded again');
    return out;
  }

  for (let seed = 1; seed <= 8; seed++) {
    it(`keep the data valid and loadable (seed ${seed})`, () => {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]): T | undefined => (xs.length ? xs[Math.floor(r() * xs.length)] : undefined);
      const env = setup(r() < 0.8 ? 'starter' : 'blank');
      const log: string[] = [];
      for (let step = 0; step < 120; step++) {
        const d = env.data();
        const k = r();
        const areaId = pick(d.areas)!.id;
        const ns = nodesOfArea(d, areaId);
        const n = pick(ns)!;
        let what = '';
        if (k < 0.3) {
          const open = pick(d.achievements.filter(m => statusOf(d, m.id) === 'open'));
          if (open) what = `complete ${open.id} ${!!env.s().complete(open.id, r() < 0.3 ? { date: '2026-01-02' } : undefined)}`;
        } else if (k < 0.38) {
          const done = pick(d.achievements.filter(m => Object.hasOwn(d.done, m.id)));
          if (done) what = `undo ${done.id} ${env.s().undo(done.id).ok}`;
        } else if (k < 0.48) {
          const c = pick(d.achievements.filter(m => m.target));
          if (c) what = `bump ${c.id} ${!!env.s().bump(c.id, r() < 0.7 ? 1 : -1)}`;
        } else if (k < 0.58) {
          const parents = [n.id, ...(r() < 0.3 ? [pick(ns)!.id] : [])];
          const res = env.s().saveAchievement(input({ areaId, title: `新${step}`, type: pick(['task', 'goal', 'challenge'] as const), parents, target: r() < 0.3 ? 3 : undefined }));
          what = `create after ${parents} ${res.ok}`;
        } else if (k < 0.68) {
          const others = d.achievements.filter(m => m.areaId !== areaId);
          const parents = n.x === 0 ? (r() < 0.5 ? [] : [pick(others)?.id ?? 'x']) : [pick(ns)!.id, ...(r() < 0.4 ? [pick(ns)!.id] : [])];
          const target = r() < 0.3 ? (r() < 0.5 ? 2 : undefined) : n.target;
          const res = env.s().saveAchievement({ ...n, desc: n.desc || '条件', parents, target, pts: r() < 0.2 ? 0 : n.pts }, n.id);
          what = `edit ${n.id} parents ${parents} ${res.ok}`;
        } else if (k < 0.73) {
          what = `delete ${n.id} ${env.s().deleteAchievement(n.id).ok}`;
        } else if (k < 0.83) {
          const x = n.x + Math.floor(r() * 5) - 2, y = n.y + Math.floor(r() * 7) - 3;
          what = `move ${n.id} to ${x},${y} ${env.s().moveAchievement(n.id, x, y).ok}`;
        } else if (k < 0.86) {
          what = `new area ${env.s().saveArea({ name: '新领域', subtitle: '', icon: 'book', bg: 'dirt' }).ok}`;
        } else if (k < 0.875) {
          what = `delete area ${areaId} ${env.s().deleteArea(areaId).ok}`;
        } else if (k < 0.9) {
          env.s().moveArea(areaId, r() < 0.5 ? -1 : 1);
          what = 'move area';
        } else if (k < 0.97) {
          const rw = pick(d.rewards);
          if (rw) what = `buy ${env.s().buy(rw.id).ok}`;
        } else {
          what = `re-import ${env.s().importBackup(JSON.parse(JSON.stringify(env.s().exportBackup()))).ok}`;
        }
        log.push(`${step}: ${what}`);
        const bad = problems(env.data());
        if (bad.length) throw new Error(`${bad.join('\n')}\nlast steps:\n${log.slice(-6).join('\n')}`);
      }
    });
  }
});
