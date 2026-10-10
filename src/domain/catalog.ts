// The closed sets of values the data model allows (types, backgrounds, icon names).

import icons from '../data/icons.json';
import type { AreaBg, IconName, NodeType } from './types';

export const NODE_TYPES: readonly NodeType[] = ['task', 'goal', 'challenge'];
export const AREA_BGS: readonly AreaBg[] = ['dirt', 'grass', 'bookshelf', 'cobblestone', 'sandstone', 'planks', 'end_stone'];
/** Every icon in src/data/icons.json, in file order. */
export const ICON_NAMES: readonly IconName[] = Object.keys(icons.icons);
/** What unknown icons fall back to. */
export const FALLBACK_ICON: IconName = 'sapling';

const ICON_SET = new Set(ICON_NAMES);

export const isNodeType = (v: unknown): v is NodeType => typeof v === 'string' && (NODE_TYPES as readonly string[]).includes(v);
export const isAreaBg = (v: unknown): v is AreaBg => typeof v === 'string' && (AREA_BGS as readonly string[]).includes(v);
export const isIconName = (v: unknown): v is IconName => typeof v === 'string' && ICON_SET.has(v);
