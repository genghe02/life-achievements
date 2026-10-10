// Starting points: the starter template (src/data/starter.json), a blank tree, default rewards.

import starter from '../data/starter.json';
import { newId } from './ids';
import { DEF_PTS, DEF_XP } from './level';
import type { Achievement, Area, AreaBg, IconName, LifeData, NodeType, Reward } from './types';

interface StarterNode {
  id: string;
  x: number;
  y: number;
  title: string;
  desc: string;
  tip?: string;
  type: NodeType;
  icon: IconName;
  parents: string[];
  xp: number;
  pts: number;
  target?: number;
  unit?: string;
  reward?: string;
  hidden?: boolean;
}

interface StarterTab {
  id: string;
  name: string;
  subtitle: string;
  bg: AreaBg;
  icon: IconName;
  nodes: StarterNode[];
}

const TABS = (starter as unknown as { tabs: StarterTab[] }).tabs;

/** The default rewards (the demo's trade list), without ids. */
export const BASE_TRADES: ReadonlyArray<Omit<Reward, 'id'>> = [
  { name: '一杯奶茶', cost: 3, icon: 'potion' },
  { name: '周末睡到自然醒', cost: 5, icon: 'bed' },
  { name: '看一场电影', cost: 8, icon: 'camera' },
  { name: '买一本想读的书', cost: 10, icon: 'book' },
  { name: '一顿火锅', cost: 15, icon: 'stew' },
  { name: '一款新游戏', cost: 20, icon: 'computer' },
  { name: '周末短途旅行', cost: 40, icon: 'map' },
  { name: '心愿单上的大件', cost: 80, icon: 'chest' },
];

export function defaultRewards(): Reward[] {
  return BASE_TRADES.map(t => ({ id: newId('r'), ...t }));
}

function toArea(t: StarterTab): Area {
  return { id: t.id, name: t.name, subtitle: t.subtitle, icon: t.icon, bg: t.bg };
}

function toAchievement(n: StarterNode, areaId: string): Achievement {
  const a: Achievement = {
    id: n.id,
    areaId,
    title: n.title,
    desc: n.desc,
    type: n.type,
    icon: n.icon,
    parents: [...n.parents],
    x: n.x,
    y: n.y,
    xp: n.xp,
    pts: n.pts,
  };
  if (n.tip) a.tip = n.tip;
  if (n.target) {
    a.target = n.target;
    a.unit = n.unit || '次';
  }
  if (n.reward) a.reward = n.reward;
  if (n.hidden) a.hidden = true;
  return a;
}

function base(now: Date, areas: Area[], achievements: Achievement[]): LifeData {
  const stamp = now.toISOString();
  return {
    version: 1,
    areas,
    achievements,
    done: {},
    progress: {},
    rewards: defaultRewards(),
    trades: [],
    settings: { sound: true, labels: true },
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** 7 areas and 97 achievements with their gateways, nothing done. */
export function starterData(now: Date = new Date()): LifeData {
  return base(
    now,
    TABS.map(toArea),
    TABS.flatMap(t => t.nodes.map(n => toAchievement(n, t.id))),
  );
}

/** The same 7 areas, each with only its root and no gateways. */
export function blankData(now: Date = new Date()): LifeData {
  return base(
    now,
    TABS.map(toArea),
    TABS.flatMap(t => t.nodes.filter(n => n.x === 0).map(n => ({ ...toAchievement(n, t.id), parents: [] }))),
  );
}

/** The single root a newly created area starts with. */
export function newAreaRoot(areaId: string, icon: IconName): Achievement {
  return {
    id: newId('n'),
    areaId,
    title: '新的开始',
    desc: '这个领域的第一步',
    type: 'goal',
    icon,
    parents: [],
    x: 0,
    y: 0,
    xp: DEF_XP.goal,
    pts: DEF_PTS.goal,
  };
}
