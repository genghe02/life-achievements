// The app store's public shape. src/store/store.ts implements it as a zustand store:
//   export const useStore: UseBoundStore<StoreApi<AppStore>>
// UI code reads with selectors (useStore(s => s.data.areas)) and calls actions
// (useStore.getState().complete(id)). Actions are synchronous; persistence happens
// in the background (debounced) and never blocks the UI.

import type { AchievementInput, AreaInput, RewardInput } from './inputs';
import type { BackupFile, CompleteResult, LifeData, Result, TradeEntry } from '../domain/types';

export type StartKind = 'starter' | 'blank';

export interface AppStore {
  /** 'loading' until IndexedDB has been read; 'new' on first launch (show onboarding). */
  phase: 'loading' | 'new' | 'ready';
  data: LifeData;
  /** Currently shown area (tab). Remembered across launches. */
  areaId: string;

  /** Read saved data; sets phase to 'ready' or 'new'. Safe to call once at startup. */
  init(): Promise<void>;
  /** Onboarding / reset: replace all data with the starter template or a blank tree. */
  start(kind: StartKind): void;
  setArea(areaId: string): void;

  // ---- achievements ----
  /** Mark an open achievement done (date defaults to today). Null if it isn't open. */
  complete(id: string, opts?: { date?: string; note?: string }): CompleteResult | null;
  /** Undo a completion. Fails when a later achievement that depends on it is done. */
  undo(id: string): Result;
  /** Counter +1 / -1 on an open achievement with a target; reaching the target completes it. */
  bump(id: string, delta: 1 | -1): CompleteResult | null;
  /** Edit date / note of a done achievement. */
  setDoneInfo(id: string, patch: { date?: string; note?: string }): Result;
  /** Create (no id) or update an achievement. New ones are auto-placed in the tree. */
  saveAchievement(input: AchievementInput, id?: string): Result<{ id: string }>;
  /** Delete an achievement. Fails for an area root and for one that others depend on. */
  deleteAchievement(id: string): Result;
  /** Move a node to another grid cell of its area (arrange mode). Fails if the tree would get tangled. */
  moveAchievement(id: string, x: number, y: number): Result;

  // ---- areas ----
  /** Create (no id) or update an area. A new area gets one root achievement. */
  saveArea(input: AreaInput, id?: string): Result<{ id: string }>;
  /** Delete an area with all its achievements. Fails for the last remaining area. */
  deleteArea(id: string): Result;
  /** Move a tab left (-1) or right (+1). */
  moveArea(id: string, dir: -1 | 1): void;

  // ---- rewards ----
  buy(rewardId: string): Result<{ entry: TradeEntry }>;
  saveReward(input: RewardInput, id?: string): Result<{ id: string }>;
  deleteReward(id: string): void;

  // ---- settings & data ----
  setSettings(patch: Partial<LifeData['settings']>): void;
  exportBackup(): BackupFile;
  /** Validate, migrate and replace all data. Leaves data untouched on failure. */
  importBackup(file: unknown): Result;
}
