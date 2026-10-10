// The app's data store (zustand). Actions are synchronous, validate their input and return
// Chinese messages the UI shows as-is; every change sets updatedAt and schedules a debounced save.

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { isIconName, isAreaBg, isNodeType } from '../domain/catalog';
import { isDateStr, isFuture, today } from '../domain/dates';
import { newId } from '../domain/ids';
import { canPlace, placeNode, placeProblem, type Placement } from '../domain/layout';
import { DEF_PTS, DEF_XP, levelOf, totals } from '../domain/level';
import {
  byId,
  childrenOf,
  displayTitle,
  isDone,
  nodesOfArea,
  statusOf,
  undoBlockers,
  wouldCycle,
} from '../domain/rules';
import { blankData, newAreaRoot, starterData } from '../domain/templates';
import type { Achievement, BackupFile, CompleteResult, DoneInfo, LifeData, Reward, TradeEntry } from '../domain/types';
import { parseBackup } from '../domain/validate';
import type { AppStore } from './contract';
import { LIMITS } from './inputs';
import { defaultPersistence, type Persistence } from './persist';

export const MSG = {
  noNode: '找不到这个进度，刷新后再试。',
  noArea: '找不到这个领域，刷新后再试。',
  noReward: '这个奖励已经不在了，刷新后再试。',
  notDone: '这个进度还没有完成。',
  undoBlocked: (names: string) => `先撤销${names}的完成，再撤销这个。`,
  undoSpent: (short: number) => `这个进度给的绿宝石已经花掉了，还差 ${short} 颗才能撤销。`,
  badDate: '日期格式不对，换一个日期试试。',
  futureDate: '达成日期不能晚于今天。',
  noteLong: `感想最多 ${LIMITS.note} 个字。`,
  titleEmpty: '给这个进度起个名字。',
  titleLong: `名称最多 ${LIMITS.title} 个字。`,
  descEmpty: '写一句完成条件，比如“连续7天早起”。',
  descLong: `完成条件最多 ${LIMITS.desc} 个字。`,
  tipLong: `提示最多 ${LIMITS.tip} 个字。`,
  type: '选一个进度类型。',
  icon: '选一个图标。',
  bg: '选一个背景。',
  target: `累计目标填${LIMITS.targetMin}到${LIMITS.targetMax}之间的整数，或者留空。`,
  unitLong: `单位最多 ${LIMITS.unit} 个字。`,
  rewardLong: `现实奖励最多 ${LIMITS.reward} 个字。`,
  xp: `经验填0到${LIMITS.xpMax}之间的整数。`,
  pts: `绿宝石填0到${LIMITS.ptsMax}之间的整数。`,
  parentGone: '有一个前置进度已经不存在了，重新选一下。',
  parentSelf: '进度不能把自己当作前置。',
  parentNone: '至少选一个前置进度，它会挂在前置后面。',
  parentArea: '前置进度要在同一个领域里。',
  rootParent: '起点进度只能选其他领域的进度作为前置。',
  cycle: '这样前置关系会绕成一个圈，换一个前置试试。',
  moveArea: '进度不能换到别的领域。',
  noRoom: '这组前置进度离得太远，树上放不下新进度。换一组靠得近的前置试试。',
  noRoomOne: '这个进度后面挤满了，放不下新进度。先点「整理」挪开旁边的进度，再试试。',
  deleteRoot: '起点进度不能删除，可以删除整个领域。',
  deleteDeps: (names: string) => `先删除或修改${names}，它们把这个进度当作前置。`,
  deleteDone: '先撤销完成，再删除这个进度。',
  placeRoot: '起点进度只能留在第一列。',
  placeFirstCol: '第一列只能放起点进度。',
  placeColumn: '进度要放在所有前置进度的右边、后续进度的左边。',
  placeTaken: '这个格子已经有进度了，换一个空格子。',
  placeTangle: '放在这里连线会缠在一起，换一个格子试试。',
  placeBad: '这个位置放不下，换一个格子试试。',
  areaEmpty: '给这个领域起个名字。',
  areaLong: `领域名称最多 ${LIMITS.areaName} 个字。`,
  subtitleLong: `副标题最多 ${LIMITS.areaSubtitle} 个字。`,
  lastArea: '至少要保留一个领域。',
  poor: (short: number) => `绿宝石不够，还差 ${short} 颗。`,
  rewardEmpty: '先写下奖励的名字。',
  rewardNameLong: `奖励名称最多 ${LIMITS.rewardName} 个字。`,
  cost: `价格填${LIMITS.costMin}到${LIMITS.costMax}之间的整数。`,
} as const;

type StorePersistence = Pick<Persistence, 'loadData' | 'loadUi' | 'saveData' | 'saveUi'> &
  Partial<Pick<Persistence, 'setLastBackup' | 'listSnapshots' | 'loadSnapshot'>>;

export interface StoreDeps {
  /** Defaults to the app's IndexedDB persistence. */
  persist?: StorePersistence;
  /** Clock for dates and timestamps. */
  now?: () => Date;
}

const err = (error: string) => ({ ok: false as const, error });
const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const len = (s: string) => Array.from(s).length;
const quoteAll = (names: string[]) => names.map(n => `「${n}」`).join('');
const isIntIn = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
/** An optional number field: an emptied input (undefined, null or NaN from valueAsNumber) counts as not given. */
const given = (v: number | null | undefined): v is number => v !== undefined && v !== null && !Number.isNaN(v);

/** Keep counter values consistent with a node's (possibly changed) target. */
function fixCounter(data: LifeData, node: Achievement): Pick<LifeData, 'done' | 'progress'> {
  const id = node.id;
  const progress = { ...data.progress };
  let done = data.done;
  if (isDone(data, id)) {
    if (node.target) progress[id] = node.target;
    else delete progress[id];
    const d = data.done[id];
    if (d.prevProgress !== undefined) {
      const nd: DoneInfo = { ...d };
      if (node.target) nd.prevProgress = Math.min(node.target - 1, d.prevProgress);
      else delete nd.prevProgress;
      done = { ...data.done, [id]: nd };
    }
  } else {
    const v = node.target ? Math.min(node.target - 1, progress[id] ?? 0) : 0;
    if (v > 0) progress[id] = v;
    else delete progress[id];
  }
  return { done, progress };
}

export function createAppStore(deps: StoreDeps = {}): UseBoundStore<StoreApi<AppStore>> {
  const now = deps.now ?? (() => new Date());
  const persist = (): StorePersistence => deps.persist ?? defaultPersistence();
  const day = () => today(now());

  return create<AppStore>()((set, get) => {
    /** Replace the data document (stamping updatedAt) and schedule a save. */
    const commit = (data: LifeData, extra: Partial<Pick<AppStore, 'areaId' | 'phase'>> = {}): LifeData => {
      const next: LifeData = { ...data, updatedAt: now().toISOString() };
      // before init() or during onboarding the document is a placeholder: saving it would
      // overwrite the user's data or skip onboarding on the next launch
      const ready = (extra.phase ?? get().phase) === 'ready';
      set({ data: next, ...extra });
      if (ready) {
        persist().saveData(next);
        if (extra.areaId !== undefined) persist().saveUi({ areaId: extra.areaId });
      }
      return next;
    };

    let initP: Promise<void> | null = null;

    /** The newest daily snapshot that still validates, or null. */
    const recoverFromSnapshot = async () => {
      const p = persist();
      if (!p.listSnapshots || !p.loadSnapshot) return null;
      try {
        for (const snap of await p.listSnapshots()) {
          const raw = await p.loadSnapshot(snap.date);
          const res = raw ? parseBackup(raw, now()) : null;
          if (res?.ok) {
            console.warn(`life-achievements: restored the snapshot of ${snap.date}`);
            return res;
          }
        }
      } catch (e) {
        console.error('life-achievements: could not read snapshots', e);
      }
      return null;
    };

    const complete: AppStore['complete'] = (id, opts) => {
      const data = get().data;
      const n = byId(data).get(id);
      if (!n || statusOf(data, id) !== 'open') return null;
      const date = opts?.date && isDateStr(opts.date) && !isFuture(opts.date, now()) ? opts.date : day();
      const info: DoneInfo = { date };
      const note = clean(opts?.note);
      if (note) info.note = Array.from(note).slice(0, LIMITS.note).join('');
      let progress = data.progress;
      if (n.target) {
        info.prevProgress = Math.max(0, Math.min(n.target - 1, data.progress[id] ?? 0));
        progress = { ...progress, [id]: n.target };
      }
      const levelBefore = levelOf(totals(data).xp).level;
      const after = commit({ ...data, done: { ...data.done, [id]: info }, progress });
      // only this node's children can change status
      const unlocked = childrenOf(data, id).filter(
        c => statusOf(data, c.id) === 'locked' && statusOf(after, c.id) === 'open',
      );
      return {
        id,
        xpGained: n.xp,
        ptsGained: n.pts,
        levelBefore,
        levelAfter: levelOf(totals(after).xp).level,
        unlockedNodes: unlocked.map(c => c.id),
        unlockedAreas: [...new Set(unlocked.filter(c => c.x === 0).map(c => c.areaId))],
      } satisfies CompleteResult;
    };

    const placeholder = blankData(now());
    return {
      phase: 'loading',
      data: placeholder,
      areaId: placeholder.areas[0].id,

      init() {
        initP ??= (async () => {
          // read separately: a failed read of the remembered area must not cost the data
          const [savedRes, uiRes] = await Promise.allSettled([persist().loadData(), persist().loadUi()]);
          const saved = savedRes.status === 'fulfilled' ? savedRes.value : null;
          const ui = uiRes.status === 'fulfilled' ? uiRes.value : null;
          if (savedRes.status === 'rejected') console.error('life-achievements: could not read saved data', savedRes.reason);
          if (uiRes.status === 'rejected') console.error('life-achievements: could not read the remembered area', uiRes.reason);
          let parsed = saved ? parseBackup(saved, now()) : null;
          if (parsed && !parsed.ok) console.error('life-achievements: saved data is invalid:', parsed.error);
          // a missing, unreadable or broken document with snapshots left behind is a loss, not a
          // first launch; on a real first launch there are no snapshots
          if (!parsed?.ok) parsed = await recoverFromSnapshot();
          if (get().phase !== 'loading') return; // start() or importBackup() already ran
          if (!parsed || !parsed.ok) {
            set({ phase: 'new' });
            return;
          }
          const data = parsed.data;
          const areaId = ui?.areaId && data.areas.some(a => a.id === ui.areaId) ? ui.areaId : data.areas[0].id;
          set({ phase: 'ready', data, areaId });
        })();
        return initP;
      },

      start(kind) {
        const prev = get();
        const fresh = kind === 'starter' ? starterData(now()) : blankData(now());
        // a restart keeps the user's sound and label settings
        const data = prev.phase === 'ready' ? { ...fresh, settings: { ...prev.data.settings } } : fresh;
        const areaId = data.areas[0].id;
        set({ phase: 'ready', data, areaId });
        persist().saveData(data);
        persist().saveUi({ areaId });
      },

      setArea(areaId) {
        const s = get();
        if (areaId === s.areaId || !s.data.areas.some(a => a.id === areaId)) return;
        set({ areaId });
        persist().saveUi({ areaId });
      },

      complete,

      undo(id) {
        const data = get().data;
        const n = byId(data).get(id);
        if (!n) return err(MSG.noNode);
        if (!isDone(data, id)) return err(MSG.notDone);
        const blockers = undoBlockers(data, id);
        if (blockers.length) return err(MSG.undoBlocked(quoteAll(blockers.map(b => b.title))));
        const em = totals(data).emeralds;
        if (n.pts > 0 && em < n.pts) return err(MSG.undoSpent(n.pts - em));
        const done = { ...data.done };
        const prev = done[id].prevProgress;
        delete done[id];
        const progress = { ...data.progress };
        const v = n.target ? Math.max(0, Math.min(n.target - 1, prev ?? n.target - 1)) : 0;
        if (v > 0) progress[id] = v;
        else delete progress[id];
        commit({ ...data, done, progress });
        return { ok: true };
      },

      bump(id, delta) {
        const data = get().data;
        const n = byId(data).get(id);
        if (!n || !n.target || statusOf(data, id) !== 'open') return null;
        const cur = data.progress[id] ?? 0;
        const v = Math.max(0, Math.min(n.target, cur + delta));
        if (v >= n.target) return complete(id);
        if (v === cur) return null;
        const progress = { ...data.progress };
        if (v > 0) progress[id] = v;
        else delete progress[id];
        commit({ ...data, progress });
        return null;
      },

      setDoneInfo(id, patch) {
        const data = get().data;
        if (!byId(data).get(id)) return err(MSG.noNode);
        if (!isDone(data, id)) return err(MSG.notDone);
        const cur = data.done[id];
        const next: DoneInfo = { ...cur };
        if (patch.date !== undefined) {
          if (!isDateStr(patch.date)) return err(MSG.badDate);
          if (isFuture(patch.date, now())) return err(MSG.futureDate);
          next.date = patch.date;
        }
        if (patch.note !== undefined) {
          const note = clean(patch.note);
          if (len(note) > LIMITS.note) return err(MSG.noteLong);
          if (note) next.note = note;
          else delete next.note;
        }
        if (next.date !== cur.date || next.note !== cur.note) commit({ ...data, done: { ...data.done, [id]: next } });
        return { ok: true };
      },

      saveAchievement(input, id) {
        const data = get().data;
        const map = byId(data);
        const area = data.areas.find(a => a.id === input.areaId);
        if (!area) return err(MSG.noArea);
        const existing = id !== undefined ? map.get(id) : undefined;
        if (id !== undefined && !existing) return err(MSG.noNode);
        if (existing && existing.areaId !== area.id) return err(MSG.moveArea);

        const title = clean(input.title);
        if (!title) return err(MSG.titleEmpty);
        if (len(title) > LIMITS.title) return err(MSG.titleLong);
        const desc = clean(input.desc);
        if (!desc) return err(MSG.descEmpty);
        if (len(desc) > LIMITS.desc) return err(MSG.descLong);
        const tip = clean(input.tip);
        if (len(tip) > LIMITS.tip) return err(MSG.tipLong);
        if (!isNodeType(input.type)) return err(MSG.type);
        if (!isIconName(input.icon)) return err(MSG.icon);
        const hasTarget = given(input.target) && input.target !== 0;
        if (hasTarget && !isIntIn(input.target, LIMITS.targetMin, LIMITS.targetMax)) return err(MSG.target);
        const unit = clean(input.unit);
        if (len(unit) > LIMITS.unit) return err(MSG.unitLong);
        const reward = clean(input.reward);
        if (len(reward) > LIMITS.reward) return err(MSG.rewardLong);
        const xp = given(input.xp) ? input.xp : DEF_XP[input.type];
        const pts = given(input.pts) ? input.pts : DEF_PTS[input.type];
        if (!isIntIn(xp, 0, LIMITS.xpMax)) return err(MSG.xp);
        if (!isIntIn(pts, 0, LIMITS.ptsMax)) return err(MSG.pts);

        const parents = [...new Set(Array.isArray(input.parents) ? input.parents : [])];
        const isRoot = existing?.x === 0;
        for (const p of parents) {
          if (p === id) return err(MSG.parentSelf);
          if (!map.has(p)) return err(MSG.parentGone);
        }
        if (isRoot) {
          if (parents.some(p => map.get(p)?.areaId === area.id)) return err(MSG.rootParent);
        } else {
          if (!parents.length) return err(MSG.parentNone);
          if (parents.some(p => map.get(p)?.areaId !== area.id)) return err(MSG.parentArea);
        }
        if (existing && wouldCycle(data, existing.id, parents)) return err(MSG.cycle);

        const fields: Omit<Achievement, 'id' | 'areaId' | 'x' | 'y'> = {
          title,
          desc,
          type: input.type,
          icon: input.icon,
          parents,
          xp,
          pts,
        };
        if (tip) fields.tip = tip;
        if (hasTarget) {
          fields.target = input.target;
          fields.unit = unit || '次';
        }
        if (reward) fields.reward = reward;
        if (input.hidden) fields.hidden = true;

        // a placement that inserted a row moves the rest of the area down first
        const makeRoom = (list: Achievement[], place: Placement, skip?: string): Achievement[] =>
          place.insertRow === undefined
            ? list
            : list.map(m => (m.areaId === area.id && m.id !== skip && m.y >= place.insertRow! ? { ...m, y: m.y + 1 } : m));

        if (!existing) {
          const place = placeNode(nodesOfArea(data, area.id), parents);
          if (!place) return err(parents.length > 1 ? MSG.noRoom : MSG.noRoomOne);
          const node: Achievement = { id: newId('n'), areaId: area.id, ...fields, x: place.x, y: place.y };
          commit({ ...data, achievements: [...makeRoom(data.achievements, place), node] });
          return { ok: true, id: node.id };
        }

        const node: Achievement = { id: existing.id, areaId: existing.areaId, ...fields, x: existing.x, y: existing.y };
        const sameParents =
          parents.length === existing.parents.length && parents.every(p => existing.parents.includes(p));
        let others = data.achievements;
        if (!isRoot && !sameParents) {
          const areaNodes = nodesOfArea(data, area.id).map(m => (m.id === node.id ? node : m));
          if (!canPlace(areaNodes, node.id, node.x, node.y)) {
            const place = placeNode(areaNodes, parents, node.id);
            if (!place) return err(parents.length > 1 ? MSG.noRoom : MSG.noRoomOne);
            node.x = place.x;
            node.y = place.y;
            others = makeRoom(others, place, node.id);
          }
        }
        const next: LifeData = { ...data, achievements: others.map(m => (m.id === node.id ? node : m)) };
        commit({ ...next, ...fixCounter(next, node) });
        return { ok: true, id: node.id };
      },

      deleteAchievement(id) {
        const data = get().data;
        const n = byId(data).get(id);
        if (!n) return err(MSG.noNode);
        if (n.x === 0) return err(MSG.deleteRoot);
        const deps = childrenOf(data, id);
        if (deps.length) return err(MSG.deleteDeps(quoteAll(deps.map(d => displayTitle(data, d)))));
        if (isDone(data, id)) return err(MSG.deleteDone);
        const done = { ...data.done };
        const progress = { ...data.progress };
        delete done[id];
        delete progress[id];
        commit({ ...data, achievements: data.achievements.filter(m => m.id !== id), done, progress });
        return { ok: true };
      },

      moveAchievement(id, x, y) {
        const data = get().data;
        const n = byId(data).get(id);
        if (!n) return err(MSG.noNode);
        if (n.x === x && n.y === y) return { ok: true };
        const problem = placeProblem(nodesOfArea(data, n.areaId), id, x, y);
        if (problem) {
          const msg = {
            missing: MSG.placeBad,
            root: n.x === 0 ? MSG.placeRoot : MSG.placeFirstCol,
            column: MSG.placeColumn,
            occupied: MSG.placeTaken,
            tangle: MSG.placeTangle,
          }[problem];
          return err(msg);
        }
        commit({ ...data, achievements: data.achievements.map(m => (m.id === id ? { ...m, x, y } : m)) });
        return { ok: true };
      },

      saveArea(input, id) {
        const data = get().data;
        const name = clean(input.name);
        if (!name) return err(MSG.areaEmpty);
        if (len(name) > LIMITS.areaName) return err(MSG.areaLong);
        const subtitle = clean(input.subtitle);
        if (len(subtitle) > LIMITS.areaSubtitle) return err(MSG.subtitleLong);
        if (!isIconName(input.icon)) return err(MSG.icon);
        if (!isAreaBg(input.bg)) return err(MSG.bg);
        const fields = { name, subtitle, icon: input.icon, bg: input.bg };
        if (id !== undefined) {
          if (!data.areas.some(a => a.id === id)) return err(MSG.noArea);
          commit({ ...data, areas: data.areas.map(a => (a.id === id ? { ...a, ...fields } : a)) });
          return { ok: true, id };
        }
        const areaId = newId('a');
        commit({
          ...data,
          areas: [...data.areas, { id: areaId, ...fields }],
          achievements: [...data.achievements, newAreaRoot(areaId, input.icon)],
        });
        return { ok: true, id: areaId };
      },

      deleteArea(id) {
        const s = get();
        const data = s.data;
        if (!data.areas.some(a => a.id === id)) return err(MSG.noArea);
        if (data.areas.length <= 1) return err(MSG.lastArea);
        const gone = new Set(data.achievements.filter(n => n.areaId === id).map(n => n.id));
        const done = { ...data.done };
        const progress = { ...data.progress };
        for (const g of gone) {
          delete done[g];
          delete progress[g];
        }
        const achievements = data.achievements
          .filter(n => !gone.has(n.id))
          .map(n => (n.parents.some(p => gone.has(p)) ? { ...n, parents: n.parents.filter(p => !gone.has(p)) } : n));
        const areas = data.areas.filter(a => a.id !== id);
        commit({ ...data, areas, achievements, done, progress }, s.areaId === id ? { areaId: areas[0].id } : {});
        return { ok: true };
      },

      moveArea(id, dir) {
        const data = get().data;
        const i = data.areas.findIndex(a => a.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= data.areas.length) return;
        const areas = data.areas.slice();
        [areas[i], areas[j]] = [areas[j], areas[i]];
        commit({ ...data, areas });
      },

      buy(rewardId) {
        const data = get().data;
        const r = data.rewards.find(x => x.id === rewardId);
        if (!r) return err(MSG.noReward);
        const em = totals(data).emeralds;
        if (em < r.cost) return err(MSG.poor(r.cost - em));
        const entry: TradeEntry = { id: newId('t'), rewardId: r.id, name: r.name, cost: r.cost, icon: r.icon, date: day() };
        commit({ ...data, trades: [...data.trades, entry] });
        return { ok: true, entry };
      },

      saveReward(input, id) {
        const data = get().data;
        const name = clean(input.name);
        if (!name) return err(MSG.rewardEmpty);
        if (len(name) > LIMITS.rewardName) return err(MSG.rewardNameLong);
        if (!isIntIn(input.cost, LIMITS.costMin, LIMITS.costMax)) return err(MSG.cost);
        if (!isIconName(input.icon)) return err(MSG.icon);
        const fields = { name, cost: input.cost, icon: input.icon };
        if (id !== undefined) {
          if (!data.rewards.some(r => r.id === id)) return err(MSG.noReward);
          commit({ ...data, rewards: data.rewards.map(r => (r.id === id ? { ...r, ...fields } : r)) });
          return { ok: true, id };
        }
        const reward: Reward = { id: newId('r'), ...fields };
        commit({ ...data, rewards: [...data.rewards, reward] });
        return { ok: true, id: reward.id };
      },

      deleteReward(id) {
        const data = get().data;
        if (!data.rewards.some(r => r.id === id)) return;
        commit({
          ...data,
          rewards: data.rewards.filter(r => r.id !== id),
          // the log keeps its own copy of name and cost
          trades: data.trades.map(t => (t.rewardId === id ? { ...t, rewardId: null } : t)),
        });
      },

      setSettings(patch) {
        const data = get().data;
        const settings = { ...data.settings };
        if (typeof patch.sound === 'boolean') settings.sound = patch.sound;
        if (typeof patch.labels === 'boolean') settings.labels = patch.labels;
        if (settings.sound === data.settings.sound && settings.labels === data.settings.labels) return;
        commit({ ...data, settings });
      },

      exportBackup(): BackupFile {
        const file: BackupFile = { app: 'life-achievements', version: 1, exportedAt: now().toISOString(), data: get().data };
        persist().setLastBackup?.(day());
        return file;
      },

      importBackup(file) {
        const parsed = parseBackup(file, now());
        if (!parsed.ok) return parsed;
        const data = parsed.data;
        const cur = get().areaId;
        const areaId = data.areas.some(a => a.id === cur) ? cur : data.areas[0].id;
        commit(data, { phase: 'ready', areaId });
        return { ok: true };
      },
    };
  });
}

/** The app's store. */
export const useStore = createAppStore();
