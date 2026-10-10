// Local persistence. The whole LifeData is one document in a Dexie (IndexedDB) key-value table,
// written 300 ms after the last change and flushed when the page is hidden. The first save of each
// calendar day also stores a snapshot of the document it replaces (newest 14 kept), and an import,
// restore or restart keeps the document it replaces too (newest 3 kept). When IndexedDB can't be
// opened we fall back to localStorage, then to memory. Tabs of the app share the document: a save
// never overwrites a newer one another tab wrote, and the other tabs pick up each save. A sync
// backend can later sit behind the same interface.

import Dexie from 'dexie';
import { today } from '../domain/dates';
import { totals } from '../domain/level';
import type { LifeData } from '../domain/types';

export type StorageKind = 'indexeddb' | 'localstorage' | 'memory';

/** UI state remembered across launches. */
export interface UiPrefs {
  areaId?: string;
}

export interface SnapshotInfo {
  /** YYYY-MM-DD for a daily snapshot; YYYY-MM-DD HH:MM for the copy kept before the data was replaced. */
  date: string;
  done: number;
  all: number;
}

interface Snapshot extends SnapshotInfo {
  data: LifeData;
}

export const DB_NAME = 'life-achievements';
export const SAVE_DELAY = 300;
export const SNAPSHOT_KEEP = 14;
/** Copies kept from just before an import, a snapshot restore or a restart replaced the data. */
export const REPLACED_KEEP = 3;
const OPEN_TIMEOUT = 10_000;

/** A newer document another tab of the app saved. */
export interface ExternalChange {
  /** As stored. Not validated: run it through parseBackup. */
  data: LifeData;
  /** This tab had changes that were not saved, because they were made on the older document. */
  lost: boolean;
}

export interface Persistence {
  /** The saved document, or null on first launch. Not validated: run it through parseBackup. */
  loadData(): Promise<LifeData | null>;
  loadUi(): Promise<UiPrefs | null>;
  /** Debounced; the newest call wins. */
  saveData(data: LifeData): void;
  saveUi(ui: UiPrefs): void;
  /** Write anything pending now and wait for every queued write. */
  flush(): Promise<void>;
  /** Newest first. */
  listSnapshots(): Promise<SnapshotInfo[]>;
  loadSnapshot(date: string): Promise<LifeData | null>;
  /**
   * Keep `data` as an extra snapshot, dated to the minute, before an import, restore or restart
   * replaces it: the day's snapshot only holds the day's starting state.
   */
  keepBeforeReplace(data: LifeData): void;
  /** Called when another tab saved a newer document; this tab no longer writes over it. */
  onExternalChange(listener: (e: ExternalChange) => void): () => void;
  /** Ask the browser not to evict our storage. False when refused or unsupported. */
  requestPersist(): Promise<boolean>;
  /** Where data is going. Accurate once the first load or save has run. */
  storageKind(): StorageKind;
  /** Date (YYYY-MM-DD) of the last exported backup, if any. */
  lastBackup(): Promise<string | null>;
  setLastBackup(date: string): void;
}

export interface PersistOptions {
  dbName?: string;
  delay?: number;
  now?: () => Date;
  /** Force a backend (tests). By default: IndexedDB, then localStorage, then memory. */
  backend?: StorageKind;
  /** IndexedDB factory to use; null behaves as if IndexedDB is missing. */
  indexedDB?: IDBFactory | null;
  /** Flush on visibilitychange (hidden) and pagehide. Default true. */
  autoFlush?: boolean;
  /** Storage for the localStorage fallback (tests); null behaves as if it is missing. */
  localStorage?: Storage | null;
  /** Hear about saves of other tabs (BroadcastChannel, and a check when the page shows again). Default true. */
  sync?: boolean;
}

interface Backend {
  kind: StorageKind;
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  /**
   * Write the document unless the stored one changed since this tab last saw it. `expect` is the
   * updatedAt it saw (null: nothing was stored; undefined: unknown, write anyway). Returns the
   * stored document instead of writing when they differ.
   */
  putData(value: LifeData, expect: string | null | undefined): Promise<LifeData | null>;
  hasSnapshot(date: string): Promise<boolean>;
  putSnapshot(s: Snapshot): Promise<void>;
  /** Newest first. */
  listSnapshots(): Promise<SnapshotInfo[]>;
  getSnapshot(date: string): Promise<Snapshot | undefined>;
  pruneSnapshots(keepDaily: number, keepReplaced: number): Promise<void>;
}

const info = ({ date, done, all }: SnapshotInfo): SnapshotInfo => ({ date, done, all });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Shaped like a saved document (it is validated when it is loaded). */
const isDoc = (v: unknown): v is LifeData => isObj(v) && Array.isArray(v.areas) && Array.isArray(v.achievements);

/** Enough of a LifeData's shape to count and store as a snapshot. */
const looksLikeData = (v: unknown): v is LifeData => isDoc(v) && Array.isArray(v.trades) && isObj(v.done);

const stamp = (d: LifeData) => {
  const t = Date.parse(String(d.updatedAt));
  return Number.isNaN(t) ? -Infinity : t;
};

/** Which version of the document a stored value is (null: there is none). */
const version = (v: unknown): string | null => (isDoc(v) ? String(v.updatedAt) : null);

/** The stored value is a document other than the one this tab last saw. */
const clashes = (stored: unknown, expect: string | null | undefined): stored is LifeData =>
  expect !== undefined && isDoc(stored) && version(stored) !== expect;

/** Daily snapshot keys are YYYY-MM-DD; the copies kept before a replacement add the time. */
const isDayKey = (k: string) => k.length === 10;

/** Snapshot keys beyond the ones to keep, given every key newest first. */
const surplus = (keys: string[], keepDaily: number, keepReplaced: number): string[] => [
  ...keys.filter(isDayKey).slice(keepDaily),
  ...keys.filter(k => !isDayKey(k)).slice(keepReplaced),
];

const pad = (n: number) => String(n).padStart(2, '0');
const minuteKey = (d: Date) => `${today(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function openDexie(name: string, idb: IDBFactory): Promise<Backend> {
  const db = new Dexie(name, { indexedDB: idb, IDBKeyRange: globalThis.IDBKeyRange });
  db.version(1).stores({ kv: 'key', snapshots: 'date' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.open(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), OPEN_TIMEOUT);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const kv = db.table<{ key: string; value: unknown }, string>('kv');
  const snaps = db.table<Snapshot, string>('snapshots');
  return {
    kind: 'indexeddb',
    get: async key => (await kv.get(key))?.value,
    put: async (key, value) => {
      await kv.put({ key, value });
    },
    // one transaction, so another tab cannot write between the check and the write
    putData: (value, expect) =>
      db.transaction('rw', kv, async () => {
        const cur = expect === undefined ? undefined : (await kv.get('data'))?.value;
        if (clashes(cur, expect)) return cur;
        await kv.put({ key: 'data', value });
        return null;
      }),
    hasSnapshot: async date => (await snaps.where('date').equals(date).count()) > 0,
    putSnapshot: async s => {
      await snaps.put(s);
    },
    listSnapshots: async () => (await snaps.orderBy('date').reverse().toArray()).map(info),
    getSnapshot: date => snaps.get(date),
    pruneSnapshots: async (keepDaily, keepReplaced) => {
      const drop = surplus(await snaps.orderBy('date').reverse().primaryKeys(), keepDaily, keepReplaced);
      if (drop.length) await snaps.bulkDelete(drop);
    },
  };
}

function lsAvailable(given?: Storage | null): Storage | null {
  try {
    const ls = given === undefined ? globalThis.localStorage : given;
    if (!ls) return null;
    const probe = '__la_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

function lsRead(ls: Storage, key: string): unknown {
  const raw = ls.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function localBackend(ls: Storage, name: string): Backend {
  const kvKey = (k: string) => `${name}:kv:${k}`;
  const snapPrefix = `${name}:snap:`;
  const snapDates = () => {
    const out: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(snapPrefix)) out.push(k.slice(snapPrefix.length));
    }
    return out.sort().reverse();
  };
  // localStorage holds ~5 MB: when a write hits the quota, the oldest snapshots make room for it.
  // If it still fails with none left, they are put back, since dropping them gained nothing.
  const setWithRoom = (key: string, value: string, keepDate?: string) => {
    const dropped: [string, string][] = [];
    for (;;) {
      try {
        ls.setItem(key, value);
        return;
      } catch (e) {
        const oldest = snapDates().filter(d => d !== keepDate).pop();
        if (oldest === undefined) {
          for (const [k, v] of dropped) {
            try {
              ls.setItem(k, v);
            } catch {
              // best effort
            }
          }
          throw e;
        }
        dropped.push([snapPrefix + oldest, ls.getItem(snapPrefix + oldest) ?? '']);
        ls.removeItem(snapPrefix + oldest);
      }
    }
  };
  return {
    kind: 'localstorage',
    get: async key => lsRead(ls, kvKey(key)),
    put: async (key, value) => setWithRoom(kvKey(key), JSON.stringify(value)),
    putData: async (value, expect) => {
      const cur = expect === undefined ? undefined : lsRead(ls, kvKey('data'));
      if (clashes(cur, expect)) return cur;
      setWithRoom(kvKey('data'), JSON.stringify(value));
      return null;
    },
    hasSnapshot: async date => ls.getItem(snapPrefix + date) !== null,
    putSnapshot: async s => setWithRoom(snapPrefix + s.date, JSON.stringify(s), s.date),
    listSnapshots: async () =>
      snapDates()
        .map(d => lsRead(ls, snapPrefix + d) as Snapshot | undefined)
        .filter((s): s is Snapshot => !!s)
        .map(info),
    getSnapshot: async date => lsRead(ls, snapPrefix + date) as Snapshot | undefined,
    pruneSnapshots: async (keepDaily, keepReplaced) => {
      for (const d of surplus(snapDates(), keepDaily, keepReplaced)) ls.removeItem(snapPrefix + d);
    },
  };
}

function memoryBackend(): Backend {
  const kv = new Map<string, unknown>();
  const snaps = new Map<string, Snapshot>();
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  const dates = () => [...snaps.keys()].sort().reverse();
  return {
    kind: 'memory',
    get: async key => clone(kv.get(key)),
    put: async (key, value) => {
      kv.set(key, clone(value));
    },
    putData: async (value, expect) => {
      const cur = kv.get('data');
      if (clashes(cur, expect)) return clone(cur);
      kv.set('data', clone(value));
      return null;
    },
    hasSnapshot: async date => snaps.has(date),
    putSnapshot: async s => {
      snaps.set(s.date, clone(s));
    },
    listSnapshots: async () => dates().map(d => info(snaps.get(d) as Snapshot)),
    getSnapshot: async date => clone(snaps.get(date)),
    pruneSnapshots: async (keepDaily, keepReplaced) => {
      for (const d of surplus(dates(), keepDaily, keepReplaced)) snaps.delete(d);
    },
  };
}

export function createPersistence(opts: PersistOptions = {}): Persistence {
  const name = opts.dbName ?? DB_NAME;
  const delay = opts.delay ?? SAVE_DELAY;
  const now = opts.now ?? (() => new Date());
  const idb = opts.indexedDB === undefined ? (globalThis.indexedDB ?? null) : opts.indexedDB;
  let kind: StorageKind = opts.backend ?? (idb ? 'indexeddb' : lsAvailable(opts.localStorage) ? 'localstorage' : 'memory');

  async function open(): Promise<Backend> {
    if (opts.backend !== 'memory' && opts.backend !== 'localstorage' && idb) {
      try {
        return await openDexie(name, idb);
      } catch (e) {
        console.warn('life-achievements: IndexedDB unavailable, falling back', e);
      }
    }
    const ls = opts.backend === 'memory' ? null : lsAvailable(opts.localStorage);
    return ls ? localBackend(ls, name) : memoryBackend();
  }

  let opened: Promise<Backend> | null = null;
  const backend = () =>
    (opened ??= open().then(b => {
      kind = b.kind;
      return b;
    }));

  let chain: Promise<void> = Promise.resolve();
  const enqueue = (job: (b: Backend) => Promise<void>): Promise<void> => {
    chain = chain
      .then(() => backend())
      .then(job)
      .catch(e => {
        console.error('life-achievements: write failed', e);
      });
    return chain;
  };

  // localStorage, if any, for the unsaved-copy below and for data an earlier fallback session left
  let lsMemo: Storage | null | undefined;
  const localStore = () => (lsMemo === undefined ? (lsMemo = lsAvailable(opts.localStorage)) : lsMemo);
  const unsavedKey = `${name}:unsaved`;

  /** The newest document handed to saveData that is not known to be written yet. */
  let unconfirmed: LifeData | null = null;
  /** A copy may sit in localStorage (one could be left over from an earlier session). */
  let copyMayExist = true;
  const dropCopy = () => {
    if (!copyMayExist) return;
    try {
      localStore()?.removeItem(unsavedKey);
      copyMayExist = false;
    } catch {
      // try again after the next write
    }
  };

  // Another tab can save the document too. `base` is the version of the stored document this tab
  // last read or wrote (null: none was stored; undefined: never read, so it cannot tell). A save
  // made on an older version is not written: the newer document is handed to the listeners instead,
  // and saves still queued from before are dropped (`epoch`).
  let base: string | null | undefined;
  let epoch = 0;
  const listeners = new Set<(e: ExternalChange) => void>();
  const emit = (e: ExternalChange) => {
    for (const l of listeners) {
      try {
        l(e);
      } catch (err) {
        console.error('life-achievements: external change listener failed', err);
      }
    }
  };

  let channel: BroadcastChannel | null = null;
  if (opts.sync !== false && typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(name);
      channel.onmessage = () => void check();
      // Node (tests) would otherwise stay alive for the channel
      (channel as { unref?: () => void }).unref?.();
    } catch {
      channel = null;
    }
  }
  const announce = () => {
    try {
      channel?.postMessage('saved');
    } catch {
      // the other tabs still catch up when they are shown again
    }
  };

  /**
   * Take over a document another tab saved. Changes of this tab not written yet were made on the
   * older document: they are dropped (`lost`).
   */
  function adopt(cur: LifeData, lost: boolean) {
    known = cur;
    base = version(cur);
    if (lost) {
      epoch++;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      unconfirmed = null;
      dropCopy();
    }
    emit({ data: cur, lost });
  }

  /** Pick up a document another tab saved, unless this tab has a save on the way (it will clash). */
  function check(): Promise<void> {
    return enqueue(async b => {
      if (base === undefined || unconfirmed) return;
      const cur = await b.get('data');
      if (!isDoc(cur) || version(cur) === base || unconfirmed) return;
      adopt(cur, false);
    });
  }

  /**
   * Another tab is going away with a save still on its way and left its copy (see copyUnsaved). Its
   * own write may never land, so this tab finishes it, as if that tab had saved first.
   */
  function takeOver(raw: string): Promise<void> {
    return enqueue(async b => {
      let copy: unknown;
      try {
        copy = JSON.parse(raw) as unknown;
      } catch {
        return;
      }
      if (base === undefined || !isDoc(copy) || version(copy) === base) return;
      if (known && stamp(copy) <= stamp(known)) return;
      if (unconfirmed && version(copy) === version(unconfirmed)) return; // this tab's own copy
      const clash = await b.putData(copy, base);
      // when its write landed after all (or yet another tab saved), the stored document is the one
      const cur = clash ?? copy;
      if (!clash) {
        announce();
        try {
          if (localStore()?.getItem(unsavedKey) === raw) localStore()?.removeItem(unsavedKey);
        } catch {
          // it is older than the stored document now, so it is not loaded again anyway
        }
      }
      adopt(cur, unconfirmed !== null);
    });
  }

  // The day's snapshot holds the document as it stood before the day's first save (as loaded, or
  // as last written), so a wrong first action of the day, like a reset, can still be undone.
  // The main write goes first: when the page is closing, it is the one that has to land. Only a
  // session that never read the document (its startup read failed) reads it before writing.
  let known: LifeData | null = null;
  let lastSnapDay = '';
  async function writeData(b: Backend, data: LifeData) {
    let prev = known;
    if (base === undefined && lastSnapDay !== today(now())) {
      try {
        const v = await b.get('data');
        prev = isDoc(v) ? v : null;
      } catch {
        // no snapshot of it then; the write itself still goes ahead
      }
    }
    const clash = await b.putData(data, base);
    // the same document stored already (another tab finished this save for us) is no clash
    if (clash && version(clash) !== version(data)) {
      adopt(clash, true);
      return;
    }
    base = version(data);
    known = data;
    announce();
    if (unconfirmed === data) {
      unconfirmed = null;
      dropCopy();
    }
    const day = today(now());
    if (lastSnapDay === day) return;
    try {
      if (!(await b.hasSnapshot(day))) {
        const snap = looksLikeData(prev) ? prev : data;
        const t = totals(snap);
        await b.putSnapshot({ date: day, done: t.done, all: t.all, data: snap });
        await b.pruneSnapshots(SNAPSHOT_KEEP, REPLACED_KEEP);
      }
      lastSnapDay = day;
    } catch (e) {
      // a failed snapshot (e.g. localStorage quota) must not count as a failed save
      console.warn('life-achievements: snapshot failed', e);
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: LifeData | null = null;
  const writePending = () => {
    timer = null;
    const d = pending;
    pending = null;
    const e = epoch;
    if (d) void enqueue(b => (e === epoch ? writeData(b, d) : Promise.resolve()));
  };

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      writePending();
    }
    await chain;
  };

  // An IndexedDB write started while the page is closing may never land (Chromium drops it on a
  // reload or navigation), so the unsaved document also goes to localStorage, synchronously.
  const copyUnsaved = () => {
    if (!unconfirmed || kind !== 'indexeddb') return;
    try {
      localStore()?.setItem(unsavedKey, JSON.stringify(unconfirmed));
      copyMayExist = true;
    } catch (e) {
      console.warn('life-achievements: could not keep an unsaved copy', e);
    }
  };

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (opts.autoFlush !== false) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') return;
        copyUnsaved();
        void flush();
      });
      window.addEventListener('pagehide', () => {
        copyUnsaved();
        void flush();
      });
    }
    if (opts.sync !== false) {
      // a hidden, frozen or back-forward-cached page can miss the other tabs' messages
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void check();
      });
      window.addEventListener('pageshow', e => {
        if (e.persisted) void check();
      });
      window.addEventListener('storage', e => {
        if (e.key === unsavedKey && e.newValue !== null) void takeOver(e.newValue);
      });
    }
  }

  return {
    async loadData() {
      const b = await backend();
      const v = await b.get('data');
      let doc = isDoc(v) ? v : null;
      const store = b.kind === 'indexeddb' ? localStore() : null;
      if (store) {
        // an unsaved copy from a page that closed mid-save, or data from an earlier session that had
        // to fall back to localStorage: the newest document wins
        for (const key of [unsavedKey, `${name}:kv:data`]) {
          const alt = lsRead(store, key);
          if (isDoc(alt) && (!doc || stamp(alt) > stamp(doc))) doc = alt;
        }
      }
      known = doc;
      base = version(v);
      return doc;
    },
    async loadUi() {
      const v = await (await backend()).get('ui');
      if (!isObj(v)) return null;
      return typeof v.areaId === 'string' ? { areaId: v.areaId } : {};
    },
    saveData(data) {
      pending = data;
      unconfirmed = data;
      if (timer) clearTimeout(timer);
      timer = setTimeout(writePending, delay);
    },
    saveUi(ui) {
      const copy: UiPrefs = { ...ui };
      void enqueue(b => b.put('ui', copy));
    },
    flush,
    // reads wait for the writes queued before them (a copy kept just before an import, the day's
    // snapshot), so the menu opened right after lists them
    async listSnapshots() {
      await chain;
      return (await backend()).listSnapshots();
    },
    async loadSnapshot(date) {
      await chain;
      const s = await (await backend()).getSnapshot(date);
      return s ? s.data : null;
    },
    keepBeforeReplace(data) {
      const key = minuteKey(now());
      void enqueue(async b => {
        try {
          // several replacements within a minute: the first copy holds the work they replaced
          if (await b.hasSnapshot(key)) return;
          const t = totals(data);
          await b.putSnapshot({ date: key, done: t.done, all: t.all, data });
          await b.pruneSnapshots(SNAPSHOT_KEEP, REPLACED_KEEP);
        } catch (e) {
          console.warn('life-achievements: could not keep a copy of the replaced data', e);
        }
      });
    },
    onExternalChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestPersist,
    storageKind: () => kind,
    async lastBackup() {
      await chain;
      const v = await (await backend()).get('meta');
      return isObj(v) && typeof v.lastBackup === 'string' ? v.lastBackup : null;
    },
    setLastBackup(date) {
      void enqueue(b => b.put('meta', { lastBackup: date }));
    },
  };
}

export async function requestPersist(): Promise<boolean> {
  try {
    const st = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!st || typeof st.persist !== 'function') return false;
    if (typeof st.persisted === 'function' && (await st.persisted())) return true;
    return await st.persist();
  } catch {
    return false;
  }
}

let shared: Persistence | null = null;
/** The app's persistence (created on first use). */
export function defaultPersistence(): Persistence {
  return (shared ??= createPersistence());
}

export const loadData = () => defaultPersistence().loadData();
export const loadUi = () => defaultPersistence().loadUi();
export const saveData = (data: LifeData) => defaultPersistence().saveData(data);
export const saveUi = (ui: UiPrefs) => defaultPersistence().saveUi(ui);
export const flush = () => defaultPersistence().flush();
export const listSnapshots = () => defaultPersistence().listSnapshots();
export const loadSnapshot = (date: string) => defaultPersistence().loadSnapshot(date);
export const storageKind = () => defaultPersistence().storageKind();
export const lastBackup = () => defaultPersistence().lastBackup();
export const setLastBackup = (date: string) => defaultPersistence().setLastBackup(date);
