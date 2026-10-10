import { afterEach, describe, expect, it, vi } from 'vitest';
import { starterData } from '../domain/templates';
import type { LifeData } from '../domain/types';
import { createPersistence, requestPersist, SNAPSHOT_KEEP } from './persist';

let n = 0;
const dbName = () => `test-persist-${Date.now()}-${n++}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function eventually<T>(read: () => Promise<T | null>): Promise<T | null> {
  for (let i = 0; i < 50; i++) {
    const v = await read();
    if (v !== null) return v;
    await sleep(20);
  }
  return null;
}

function clock(start: Date) {
  let t = start;
  return { now: () => t, set: (d: Date) => (t = d) };
}

/** A Storage that throws like a browser once its values pass `limit` characters. */
function quotaStorage(limit: number): Storage {
  const m = new Map<string, string>();
  const used = () => [...m.values()].reduce((a, v) => a + v.length, 0);
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const value = String(v);
      if (used() - (m.get(k)?.length ?? 0) + value.length > limit) throw new DOMException('full', 'QuotaExceededError');
      m.set(k, value);
    },
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const withDone = (d: LifeData, id: string): LifeData => ({ ...d, done: { ...d.done, [id]: { date: '2026-10-01' } } });

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('persistence (IndexedDB)', () => {
  it('starts empty and round-trips data and ui through a fresh instance', async () => {
    const name = dbName();
    const p = createPersistence({ dbName: name, autoFlush: false });
    expect(await p.loadData()).toBeNull();
    expect(await p.loadUi()).toBeNull();
    expect(p.storageKind()).toBe('indexeddb');
    const data = starterData(new Date(2026, 9, 10));
    p.saveData(data);
    p.saveUi({ areaId: 'body' });
    await p.flush();
    const q = createPersistence({ dbName: name, autoFlush: false });
    expect(await q.loadData()).toEqual(data);
    expect(await q.loadUi()).toEqual({ areaId: 'body' });
  });

  it('debounces saves and keeps the newest', async () => {
    const name = dbName();
    const p = createPersistence({ dbName: name, autoFlush: false, delay: 40 });
    const a = starterData(new Date(2026, 9, 10));
    p.saveData(a);
    p.saveData(withDone(a, 'o_start'));
    const last = withDone(withDone(a, 'o_start'), 'o_sleep');
    p.saveData(last);
    const q = createPersistence({ dbName: name, autoFlush: false });
    expect(await q.loadData()).toBeNull(); // nothing written before the delay
    await sleep(120);
    await p.flush();
    expect(Object.keys((await q.loadData())!.done)).toEqual(['o_start', 'o_sleep']);
  });

  it('writes on its own after the delay', async () => {
    const name = dbName();
    const p = createPersistence({ dbName: name, autoFlush: false, delay: 20 });
    p.saveData(starterData(new Date(2026, 9, 10)));
    await sleep(80);
    await p.flush();
    expect(await createPersistence({ dbName: name, autoFlush: false }).loadData()).not.toBeNull();
  });

  it('snapshots once per day and keeps the newest 14', async () => {
    const c = clock(new Date(2026, 9, 1, 9));
    const p = createPersistence({ dbName: dbName(), autoFlush: false, now: c.now });
    const base = starterData(c.now());
    p.saveData(base);
    await p.flush();
    p.saveData(withDone(base, 'o_start'));
    await p.flush();
    let list = await p.listSnapshots();
    expect(list).toEqual([{ date: '2026-10-01', done: 0, all: 97 }]);
    // the first save of the day is kept, later saves that day don't replace it
    expect((await p.loadSnapshot('2026-10-01'))!.done).toEqual({});
    for (let day = 2; day <= 20; day++) {
      c.set(new Date(2026, 9, day, 9));
      p.saveData(withDone(base, 'o_start'));
      await p.flush();
    }
    list = await p.listSnapshots();
    expect(list).toHaveLength(SNAPSHOT_KEEP);
    expect(list[0]).toEqual({ date: '2026-10-20', done: 1, all: 97 });
    expect(list[list.length - 1].date).toBe('2026-10-07');
    expect(await p.loadSnapshot('2026-10-01')).toBeNull();
    expect((await p.loadSnapshot('2026-10-07'))!.done).toHaveProperty('o_start');
  });

  it("keeps the day's starting state, so a wrong first action of the day can be undone", async () => {
    const c = clock(new Date(2026, 9, 1, 9));
    const p = createPersistence({ dbName: dbName(), autoFlush: false, now: c.now });
    const base = starterData(c.now());
    const worked = withDone(withDone(base, 'o_start'), 'o_sleep');
    p.saveData(base);
    await p.flush();
    p.saveData(worked);
    await p.flush();
    // next morning the first save replaces everything (say, 重新开始)
    c.set(new Date(2026, 9, 2, 8));
    p.saveData(starterData(c.now()));
    await p.flush();
    expect((await p.listSnapshots())[0]).toEqual({ date: '2026-10-02', done: 2, all: 97 });
    expect(Object.keys((await p.loadSnapshot('2026-10-02'))!.done)).toEqual(['o_start', 'o_sleep']);
    expect((await p.loadData())!.done).toEqual({});
  });

  it("keeps the day's starting state even when this session could not read it at startup", async () => {
    const name = dbName();
    const c = clock(new Date(2026, 9, 1, 9));
    const p = createPersistence({ dbName: name, autoFlush: false, now: c.now });
    p.saveData(withDone(starterData(c.now()), 'o_start'));
    await p.flush();
    // a new session whose startup read failed, so it never saw the document it now replaces
    c.set(new Date(2026, 9, 2, 8));
    const q = createPersistence({ dbName: name, autoFlush: false, now: c.now });
    q.saveData(starterData(c.now()));
    await q.flush();
    expect(Object.keys((await q.loadSnapshot('2026-10-02'))!.done)).toEqual(['o_start']);
  });

  it('remembers the last backup date', async () => {
    const name = dbName();
    const p = createPersistence({ dbName: name, autoFlush: false });
    expect(await p.lastBackup()).toBeNull();
    p.setLastBackup('2026-10-09');
    await p.flush();
    expect(await createPersistence({ dbName: name, autoFlush: false }).lastBackup()).toBe('2026-10-09');
  });

  it('flushes when the page is hidden', async () => {
    const name = dbName();
    const p = createPersistence({ dbName: name, delay: 60_000 });
    p.saveData(starterData(new Date(2026, 9, 10)));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    // no flush() here: only the event can have started the write
    expect(await eventually(() => createPersistence({ dbName: name, autoFlush: false }).loadData())).not.toBeNull();
  });

  it('flushes on pagehide', async () => {
    const name = dbName();
    const p = createPersistence({ dbName: name, delay: 60_000 });
    p.saveData(starterData(new Date(2026, 9, 10)));
    window.dispatchEvent(new Event('pagehide'));
    expect(await eventually(() => createPersistence({ dbName: name, autoFlush: false }).loadData())).not.toBeNull();
  });

  // In Chromium an IndexedDB write started in pagehide does not land when the page reloads or
  // navigates away, so the unsaved document is also copied to localStorage, which is synchronous.
  it('copies an unsaved document to localStorage the moment the page hides', async () => {
    const name = dbName();
    const p = createPersistence({ dbName: name, delay: 60_000 });
    await p.loadData();
    const data = withDone(starterData(new Date(2026, 9, 10)), 'o_start');
    p.saveData(data);
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem(`${name}:unsaved`)!)).toEqual(data);
    await p.flush();
    // once the document is safely in IndexedDB the copy goes away
    expect(localStorage.getItem(`${name}:unsaved`)).toBeNull();
  });

  it('does not copy anything when every save has landed', async () => {
    const name = dbName();
    const p = createPersistence({ dbName: name });
    p.saveData(starterData(new Date(2026, 9, 10)));
    await p.flush();
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(`${name}:unsaved`)).toBeNull();
  });

  it('loads the copy when it is newer than what IndexedDB holds, and drops it after the next save', async () => {
    const name = dbName();
    const p = createPersistence({ dbName: name, autoFlush: false });
    const saved = { ...starterData(new Date(2026, 9, 10)), updatedAt: '2026-10-10T08:00:00.000Z' };
    p.saveData(saved);
    await p.flush();
    const older = { ...withDone(saved, 'o_start'), updatedAt: '2026-10-10T07:00:00.000Z' };
    localStorage.setItem(`${name}:unsaved`, JSON.stringify(older));
    expect(await createPersistence({ dbName: name, autoFlush: false }).loadData()).toEqual(saved);
    const newer = { ...withDone(saved, 'o_start'), updatedAt: '2026-10-10T09:00:00.000Z' };
    localStorage.setItem(`${name}:unsaved`, JSON.stringify(newer));
    const q = createPersistence({ dbName: name, autoFlush: false });
    expect(await q.loadData()).toEqual(newer);
    q.saveData({ ...newer, updatedAt: '2026-10-10T10:00:00.000Z' });
    await q.flush();
    expect(localStorage.getItem(`${name}:unsaved`)).toBeNull();
  });
});

describe('persistence fallbacks', () => {
  it('uses localStorage when IndexedDB is missing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const name = dbName();
    const p = createPersistence({ dbName: name, autoFlush: false, indexedDB: null });
    const data = starterData(new Date(2026, 9, 10));
    p.saveData(data);
    p.saveUi({ areaId: 'mind' });
    await p.flush();
    expect(p.storageKind()).toBe('localstorage');
    expect(localStorage.getItem(`${name}:kv:data`)).not.toBeNull();
    const q = createPersistence({ dbName: name, autoFlush: false, indexedDB: null });
    expect(await q.loadData()).toEqual(data);
    expect(await q.loadUi()).toEqual({ areaId: 'mind' });
    expect(await q.listSnapshots()).toEqual([{ date: expect.any(String), done: 0, all: 97 }]);
  });

  it('uses localStorage when IndexedDB fails to open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = {
      open() {
        throw new Error('blocked');
      },
    } as unknown as IDBFactory;
    const p = createPersistence({ dbName: dbName(), autoFlush: false, indexedDB: broken });
    expect(await p.loadData()).toBeNull();
    expect(p.storageKind()).toBe('localstorage');
    expect(warn).toHaveBeenCalled();
  });

  it('picks up data an earlier localStorage session left behind', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const name = dbName();
    const data = starterData(new Date(2026, 9, 10));
    const old = createPersistence({ dbName: name, autoFlush: false, indexedDB: null });
    old.saveData(data);
    await old.flush();
    const p = createPersistence({ dbName: name, autoFlush: false });
    expect(await p.loadData()).toEqual(data);
    expect(p.storageKind()).toBe('indexeddb');
  });

  it('drops old snapshots when localStorage is full, so the main document still saves', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const base = starterData(new Date(2026, 9, 1));
    const size = JSON.stringify(base).length;
    const ls = quotaStorage(Math.round(size * 4.5));
    const c = clock(new Date(2026, 9, 1, 9));
    const name = dbName();
    const p = createPersistence({ dbName: name, autoFlush: false, indexedDB: null, localStorage: ls, now: c.now });
    for (let day = 1; day <= 4; day++) {
      c.set(new Date(2026, 9, day, 9));
      p.saveData(base);
      await p.flush();
    }
    // the document doubles in size: it only fits once older snapshots make room
    const big: LifeData = {
      ...base,
      achievements: [...base.achievements, ...base.achievements.map(n => ({ ...n, id: `${n.id}_2`, areaId: 'gone' }))],
    };
    p.saveData(big);
    await p.flush();
    const q = createPersistence({ dbName: name, autoFlush: false, indexedDB: null, localStorage: ls });
    expect(await q.loadData()).toEqual(big);
    const snaps = await q.listSnapshots();
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[0].date).toBe('2026-10-04');
  });

  it('keeps the old snapshots when even dropping them all would not make room', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const base = starterData(new Date(2026, 9, 1));
    const size = JSON.stringify(base).length;
    const ls = quotaStorage(Math.round(size * 3.5));
    const c = clock(new Date(2026, 9, 1, 9));
    const name = dbName();
    const p = createPersistence({ dbName: name, autoFlush: false, indexedDB: null, localStorage: ls, now: c.now });
    for (let day = 1; day <= 2; day++) {
      c.set(new Date(2026, 9, day, 9));
      p.saveData(base);
      await p.flush();
    }
    const huge: LifeData = { ...base, achievements: Array.from({ length: 5 }, () => base.achievements).flat() };
    p.saveData(huge);
    await p.flush();
    expect(error).toHaveBeenCalled();
    const q = createPersistence({ dbName: name, autoFlush: false, indexedDB: null, localStorage: ls });
    expect(await q.loadData()).toEqual(base);
    expect((await q.listSnapshots()).map(s => s.date)).toEqual(['2026-10-02', '2026-10-01']);
  });

  it('keeps working in memory', async () => {
    const p = createPersistence({ dbName: dbName(), autoFlush: false, backend: 'memory' });
    const data = starterData(new Date(2026, 9, 10));
    p.saveData(data);
    await p.flush();
    expect(p.storageKind()).toBe('memory');
    const back = await p.loadData();
    expect(back).toEqual(data);
    expect(back).not.toBe(data);
    expect(await p.listSnapshots()).toHaveLength(1);
  });

  it('logs a failed write and keeps going', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = createPersistence({ dbName: dbName(), autoFlush: false, indexedDB: null });
    await p.loadData(); // opens the localStorage backend while writes still work
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    p.saveData(starterData(new Date(2026, 9, 10)));
    await p.flush();
    expect(error).toHaveBeenCalled();
    setItem.mockRestore();
    p.saveUi({ areaId: 'x' });
    await p.flush();
    expect(await p.loadUi()).toEqual({ areaId: 'x' });
  });
});

describe('requestPersist', () => {
  it('is safe without the storage API', async () => {
    const desc = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
    expect(await requestPersist()).toBe(false);
    if (desc) Object.defineProperty(navigator, 'storage', desc);
    else delete (navigator as { storage?: unknown }).storage;
  });

  it('asks the browser when it can', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', { value: { persist, persisted: async () => false }, configurable: true });
    expect(await requestPersist()).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
    Object.defineProperty(navigator, 'storage', { value: { persist: async () => { throw new Error('no'); } }, configurable: true });
    expect(await requestPersist()).toBe(false);
    delete (navigator as { storage?: unknown }).storage;
  });
});
