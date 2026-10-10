// Local persistence. The whole LifeData is one document in a Dexie (IndexedDB) key-value table,
// written 300 ms after the last change and flushed when the page is hidden. The first save of each
// calendar day also stores a snapshot of the document it replaces (newest 14 kept). When IndexedDB
// can't be opened we fall back to localStorage, then to memory. A sync backend can later sit
// behind the same interface.

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
  /** YYYY-MM-DD */
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
const OPEN_TIMEOUT = 10_000;

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
}

interface Backend {
  kind: StorageKind;
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  hasSnapshot(date: string): Promise<boolean>;
  putSnapshot(s: Snapshot): Promise<void>;
  /** Newest first. */
  listSnapshots(): Promise<SnapshotInfo[]>;
  getSnapshot(date: string): Promise<Snapshot | undefined>;
  pruneSnapshots(keep: number): Promise<void>;
}

const info = ({ date, done, all }: SnapshotInfo): SnapshotInfo => ({ date, done, all });

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
    hasSnapshot: async date => (await snaps.where('date').equals(date).count()) > 0,
    putSnapshot: async s => {
      await snaps.put(s);
    },
    listSnapshots: async () => (await snaps.orderBy('date').reverse().toArray()).map(info),
    getSnapshot: date => snaps.get(date),
    pruneSnapshots: async keep => {
      const keys = await snaps.orderBy('date').reverse().primaryKeys();
      if (keys.length > keep) await snaps.bulkDelete(keys.slice(keep));
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
    hasSnapshot: async date => ls.getItem(snapPrefix + date) !== null,
    putSnapshot: async s => setWithRoom(snapPrefix + s.date, JSON.stringify(s), s.date),
    listSnapshots: async () =>
      snapDates()
        .map(d => lsRead(ls, snapPrefix + d) as Snapshot | undefined)
        .filter((s): s is Snapshot => !!s)
        .map(info),
    getSnapshot: async date => lsRead(ls, snapPrefix + date) as Snapshot | undefined,
    pruneSnapshots: async keep => {
      for (const d of snapDates().slice(keep)) ls.removeItem(snapPrefix + d);
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
    hasSnapshot: async date => snaps.has(date),
    putSnapshot: async s => {
      snaps.set(s.date, clone(s));
    },
    listSnapshots: async () => dates().map(d => info(snaps.get(d) as Snapshot)),
    getSnapshot: async date => clone(snaps.get(date)),
    pruneSnapshots: async keep => {
      for (const d of dates().slice(keep)) snaps.delete(d);
    },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Shaped like a saved document (it is validated when it is loaded). */
const isDoc = (v: unknown): v is LifeData => isObj(v) && Array.isArray(v.areas) && Array.isArray(v.achievements);

/** Enough of a LifeData's shape to count and store as a snapshot. */
const looksLikeData = (v: unknown): v is LifeData => isDoc(v) && Array.isArray(v.trades) && isObj(v.done);

const stamp = (d: LifeData) => {
  const t = Date.parse(String(d.updatedAt));
  return Number.isNaN(t) ? -Infinity : t;
};

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

  // The day's snapshot holds the document as it stood before the day's first save (as loaded, or
  // as last written), so a wrong first action of the day, like a reset, can still be undone.
  // The main write goes first: when the page is closing, it is the one that has to land. Only a
  // session that never read the document (its startup read failed) reads it before writing.
  let known: LifeData | null = null;
  let seen = false;
  let lastSnapDay = '';
  async function writeData(b: Backend, data: LifeData) {
    let prev = known;
    if (!seen && lastSnapDay !== today(now())) {
      try {
        const v = await b.get('data');
        prev = isDoc(v) ? v : null;
      } catch {
        // no snapshot of it then; the write itself still goes ahead
      }
    }
    await b.put('data', data);
    seen = true;
    known = data;
    if (unconfirmed === data) {
      unconfirmed = null;
      if (copyMayExist) {
        try {
          localStore()?.removeItem(unsavedKey);
          copyMayExist = false;
        } catch {
          // try again after the next write
        }
      }
    }
    const day = today(now());
    if (lastSnapDay === day) return;
    try {
      if (!(await b.hasSnapshot(day))) {
        const snap = looksLikeData(prev) ? prev : data;
        const t = totals(snap);
        await b.putSnapshot({ date: day, done: t.done, all: t.all, data: snap });
        await b.pruneSnapshots(SNAPSHOT_KEEP);
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
    if (d) void enqueue(b => writeData(b, d));
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

  if (opts.autoFlush !== false && typeof document !== 'undefined' && typeof window !== 'undefined') {
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
      seen = true;
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
    async listSnapshots() {
      return (await backend()).listSnapshots();
    },
    async loadSnapshot(date) {
      const s = await (await backend()).getSnapshot(date);
      return s ? s.data : null;
    },
    requestPersist,
    storageKind: () => kind,
    async lastBackup() {
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
