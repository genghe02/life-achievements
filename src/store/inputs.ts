// Shapes the editor forms hand to the store. The store validates them (lengths, ranges,
// prerequisite rules) and returns a Chinese error message the form can show as-is.

import type { AreaBg, IconName, NodeType } from '../domain/types';

export interface AchievementInput {
  areaId: string;
  title: string;
  desc: string;
  tip?: string;
  type: NodeType;
  icon: IconName;
  parents: string[];
  /** Omit to use the type's default (task 40 / goal 120 / challenge 300). */
  xp?: number;
  /** Omit to use the type's default (task 2 / goal 6 / challenge 15). */
  pts?: number;
  target?: number;
  unit?: string;
  reward?: string;
  hidden?: boolean;
}

export interface AreaInput {
  name: string;
  subtitle: string;
  icon: IconName;
  bg: AreaBg;
}

export interface RewardInput {
  name: string;
  cost: number;
  icon: IconName;
}

/** Field limits shared by forms (maxlength) and store validation. */
export const LIMITS = {
  title: 12,
  desc: 60,
  tip: 60,
  unit: 4,
  reward: 20,
  areaName: 6,
  areaSubtitle: 20,
  rewardName: 12,
  note: 200,
  targetMin: 2,
  targetMax: 9999,
  costMin: 1,
  costMax: 999,
  xpMax: 5000,
  ptsMax: 500,
} as const;
