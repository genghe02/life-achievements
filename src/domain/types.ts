// Core data model. Everything the user owns lives in one LifeData document, which is
// persisted locally (IndexedDB) and exported as a BackupFile.

export type NodeType = 'task' | 'goal' | 'challenge';
export type NodeStatus = 'done' | 'open' | 'locked';
export type AreaBg = 'dirt' | 'grass' | 'bookshelf' | 'cobblestone' | 'sandstone' | 'planks' | 'end_stone';
/** A key of src/data/icons.json. */
export type IconName = string;

/** 领域: one tab with its own achievement tree. */
export interface Area {
  id: string;
  name: string;
  subtitle: string;
  icon: IconName;
  bg: AreaBg;
}

/** 进度: one node of a tree. */
export interface Achievement {
  id: string;
  areaId: string;
  title: string;
  /** Completion condition. */
  desc: string;
  tip?: string;
  type: NodeType;
  icon: IconName;
  /**
   * Prerequisite achievement ids. Same area, in a smaller column. The one exception is an
   * area's root (x = 0), which may name achievements in other areas: they gate the whole area.
   */
  parents: string[];
  /** Grid column, root at 0. */
  x: number;
  /** Grid row, any integer. */
  y: number;
  xp: number;
  /** Emeralds paid on completion. */
  pts: number;
  /** Counter goal (>= 2), with its unit. */
  target?: number;
  unit?: string;
  /** Real-life reward the user promised themselves. */
  reward?: string;
  /** Shown as ??? until it unlocks. */
  hidden?: boolean;
}

export interface DoneInfo {
  /** YYYY-MM-DD, editable by the user (backdating is normal). */
  date: string;
  note?: string;
  /** Counter value before completion, restored by undo. */
  prevProgress?: number;
}

/** A real-life reward that can be bought with emeralds. */
export interface Reward {
  id: string;
  name: string;
  cost: number;
  icon: IconName;
}

export interface TradeEntry {
  id: string;
  rewardId: string | null;
  name: string;
  cost: number;
  icon: IconName;
  /** YYYY-MM-DD */
  date: string;
}

export interface Settings {
  sound: boolean;
  /** Show node names under the tree icons. */
  labels: boolean;
}

export interface LifeData {
  version: 1;
  /** Tab order. */
  areas: Area[];
  achievements: Achievement[];
  done: Record<string, DoneInfo>;
  /** Counter values for achievements with a target. */
  progress: Record<string, number>;
  rewards: Reward[];
  /** Oldest first. */
  trades: TradeEntry[];
  settings: Settings;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
}

export interface BackupFile {
  app: 'life-achievements';
  version: 1;
  exportedAt: string;
  data: LifeData;
}

/** What completing an achievement changed, so the UI can play the right effects. */
export interface CompleteResult {
  id: string;
  xpGained: number;
  ptsGained: number;
  levelBefore: number;
  levelAfter: number;
  /** Achievements that became open because of this completion. */
  unlockedNodes: string[];
  /** Areas whose root became open because of this completion. */
  unlockedAreas: string[];
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
