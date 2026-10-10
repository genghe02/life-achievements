// Pixel art drawn in the browser: 16x16 icons from icons.json, 26x26 achievement frames,
// 16x16 block textures and a few small glyphs. Every result is a PNG data URL, cached.

import iconsJson from '../data/icons.json';
import type { AreaBg, NodeStatus, NodeType } from '../domain/types';

interface PixelIcon {
  palette: Record<string, string>;
  rows: string[];
}

const ICONS: Record<string, PixelIcon> = (iconsJson as { icons: Record<string, PixelIcon> }).icons;

/** Every icon key, in the order of icons.json (the order the icon pickers show). */
export const ICON_NAMES: readonly string[] = Object.keys(ICONS);

/** A transparent 1x1 GIF, used where no canvas is available (tests, server). */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// jsdom has a <canvas> element but no 2D context, and logs an error for every getContext call.
const CAN_DRAW = typeof document !== 'undefined' && typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent);

function context(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  if (!CAN_DRAW) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  return g ? [c, g] : null;
}

/** Draw rows of palette keys ('.' or any key missing from the palette is transparent). */
export function gridURL(rows: readonly string[], pal: Readonly<Record<string, string>>): string {
  const cg = context(rows[0]?.length ?? 1, rows.length || 1);
  if (!cg) return BLANK;
  const [c, g] = cg;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (col) {
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
  });
  return c.toDataURL();
}

export const QMARK = gridURL([
  '................', '.....oooooo.....', '....owwwwwwo....', '...owwooooowo...', '...owo....owwo..', '....o.....owwo..',
  '.........owwo...', '........owwo....', '.......owwo.....', '.......owo......', '.......owo......', '........o.......',
  '.......ooo......', '.......owo......', '.......ooo......', '................'], { o: '#1a1a1a', w: '#d8d8d8' });

export const LOCK = gridURL([
  '..ooo..', '.o...o.', '.o...o.', 'ooooooo', 'oyyyyyo', 'oyyoyyo', 'oyyyyyo', 'ooooooo'], { o: '#141414', y: '#f2c53d' });

export const ARROW = gridURL([
  '.....o....', '.....oo...', 'ooooowwo..', 'owwwwwwwo.', 'owwwwwwwwo', 'owwwwwwwo.', 'ooooowwo..', '.....oo...', '.....o....'],
{ o: '#3f3f3f', w: '#f0f0f0' });

export const XPORB = gridURL(['..oooo..', '.oyyggo.', 'oyywggdo', 'oygggggo', 'oggggddo', 'oggdddgo', '.oddddo.', '..oooo..'],
  { o: '#1d3d05', y: '#f2ffb0', w: '#ffffff', g: '#9ae62a', d: '#4c9a12' });

/** The HUD menu button glyph (three bars). */
export const MENU = gridURL(
  ['oooooooooo', 'owwwwwwwwo', 'oooooooooo', '..........', 'oooooooooo', 'owwwwwwwwo', 'oooooooooo', '..........', 'oooooooooo', 'owwwwwwwwo', 'oooooooooo'],
  { o: '#383838', w: '#ffffff' });

/** A gear for the icon-only 「领域设置」 button (white with the buttons' text shadow). */
export const GEAR = gridURL([
  '....ww.....',
  '.ww.wwoww..',
  '.wwwwwwwwo.',
  '..wwoowwoo.',
  'wwwoo..www.',
  'wwwo...wwwo',
  '.oww..wwooo',
  '.wwwwwwww..',
  '.wwowwowwo.',
  '..oowwo.oo.',
  '.....oo....'], { o: '#383838', w: '#ffffff' });

const ICON_CACHE = new Map<string, string>();

/** A 16x16 icon by name; unknown names draw the question mark. */
export function icon(name: string): string {
  let url = ICON_CACHE.get(name);
  if (url === undefined) {
    const d = Object.hasOwn(ICONS, name) ? ICONS[name] : undefined;
    url = d ? gridURL(d.rows, d.palette) : QMARK;
    ICON_CACHE.set(name, url);
  }
  return url;
}

interface FramePalette { o: string; h: string; f: string; d: string; i: string; ih: string; il: string }

const FRAME_PAL: Record<NodeStatus, FramePalette> = {
  done: { o: '#2a1c00', h: '#fff1a0', f: '#efbd31', d: '#946400', i: '#d29a22', ih: '#8a5b00', il: '#ffe07a' },
  open: { o: '#121212', h: '#ffffff', f: '#c6c6c6', d: '#5f5f5f', i: '#8f8f8f', ih: '#4f4f4f', il: '#dadada' },
  locked: { o: '#050505', h: '#5e5e5e', f: '#3a3a3a', d: '#1c1c1c', i: '#262626', ih: '#121212', il: '#404040' },
};

// task: square with clipped corners; goal: rounded; challenge: spiky.
function frameMask(type: NodeType): boolean[][] {
  const N = 26;
  const m: boolean[][] = [];
  for (let y = 0; y < N; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < N; x++) {
      const dx = Math.min(x, N - 1 - x), dy = Math.min(y, N - 1 - y);
      let v: boolean;
      if (type === 'task') v = dx + dy >= 1;
      else if (type === 'goal') v = dx + dy >= 5;
      else {
        const ex = Math.abs(x - 12.5), ey = Math.abs(y - 12.5);
        const body = dx >= 2 && dy >= 2;
        const fin = Math.abs(dx - dy) <= 2 && Math.max(dx, dy) <= 4 && dx + dy >= 1;
        const bump = (ex <= 4.5 && dy >= Math.max(0, ex - 2.5)) || (ey <= 4.5 && dx >= Math.max(0, ey - 2.5));
        v = body || fin || bump;
      }
      row.push(v);
    }
    m.push(row);
  }
  return m;
}

const FRAME_CACHE = new Map<string, string>();

/** The 26x26 achievement frame for a type in a status (drawn at 52x52). */
export function frame(type: NodeType, status: NodeStatus): string {
  const key = type + status;
  const hit = FRAME_CACHE.get(key);
  if (hit) return hit;
  const N = 26, m = frameMask(type), P = FRAME_PAL[status];
  const cg = context(N, N);
  if (!cg) return BLANK;
  const [c, g] = cg;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && m[y][x];
  const edge = (x: number, y: number) => at(x, y) && (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!m[y][x]) continue;
    let col: string;
    if (edge(x, y)) col = P.o;
    else if (x >= 4 && x <= 21 && y >= 4 && y <= 21) {
      col = (x === 4 || y === 4) ? P.ih : (x === 21 || y === 21) ? P.il : P.i;
    } else if (edge(x - 1, y) || edge(x, y - 1) || (edge(x - 1, y - 1) && !edge(x + 1, y + 1))) col = P.h;
    else if (edge(x + 1, y) || edge(x, y + 1) || edge(x + 1, y + 1)) col = P.d;
    else col = P.f;
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  }
  const url = c.toDataURL();
  FRAME_CACHE.set(key, url);
  return url;
}

/** mulberry32: the same seed always draws the same texture. */
function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16), cl = (v: number) => Math.max(0, Math.min(255, v));
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(v => cl(v + amt).toString(16).padStart(2, '0')).join('');
}

const TEX_CACHE = new Map<string, string>();

/** A 16x16 block texture (area backgrounds and the page's dirt). */
export function texture(kind: AreaBg): string {
  const hit = TEX_CACHE.get(kind);
  if (hit) return hit;
  const cg = context(16, 16);
  if (!cg) return BLANK;
  const [c, g] = cg;
  let seed = 7;
  for (const ch of kind) seed = seed * 31 + ch.charCodeAt(0);
  const R = rng(seed);
  const px = (x: number, y: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  const wpick = (list: [string, number][]) => {
    let r = R() * list.reduce((a, b) => a + b[1], 0);
    for (const [c2, w] of list) { if ((r -= w) <= 0) return c2; }
    return list[0][0];
  };
  const noise = (list: [string, number][]) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, wpick(list)); };

  if (kind === 'dirt') noise([['#866043', 5], ['#79553a', 4], ['#966c4a', 2], ['#593d29', 2], ['#6c4a30', 2], ['#b9855c', .6]]);
  else if (kind === 'grass') noise([['#5b8f31', 5], ['#4f7d2b', 4], ['#6aa339', 2], ['#3f6622', 1.6], ['#7cb446', .8]]);
  else if (kind === 'end_stone') {
    noise([['#dcdfa0', 6], ['#e6e8b4', 2], ['#cfd292', 3], ['#c2c486', 1]]);
    for (let i = 0; i < 5; i++) px(Math.floor(R() * 16), Math.floor(R() * 16), '#a9ab72');
  } else if (kind === 'sandstone') {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y % 8 === 3 ? '#c4b27a' : y % 8 < 3 ? '#e1d7a8' : '#d8cb98';
      px(x, y, R() < .18 ? wpick([['#cfc08a', 2], ['#e8dfb4', 1]]) : band);
    }
  } else if (kind === 'planks') {
    for (let b = 0; b < 4; b++) {
      const seam = Math.floor(R() * 16), base = ['#a0824f', '#9a7c4a', '#a68854', '#977848'][b];
      for (let y = b * 4; y < b * 4 + 4; y++) for (let x = 0; x < 16; x++) {
        let col = base;
        if (y % 4 === 3) col = '#6e5531';
        else if (x === seam) col = '#6e5531';
        else if (R() < .14) col = '#8f7244';
        else if (R() < .06) col = '#b39462';
        px(x, y, col);
      }
    }
  } else if (kind === 'bookshelf') {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const plank = y <= 1 || y >= 14 || y === 7 || y === 8;
      px(x, y, plank ? (y === 1 || y === 8 ? '#6e5531' : R() < .2 ? '#8f7244' : '#a0824f') : '#3b2a17');
    }
    const BOOK = ['#8b2f2f', '#2f4f8b', '#3f7a2f', '#7a5a2f', '#5f2f7a', '#9a7a2a', '#2f6f6f'];
    for (const [y0, y1] of [[2, 6], [9, 13]]) {
      let x = 1;
      while (x < 15) {
        const w = R() < .5 ? 1 : 2, col = BOOK[Math.floor(R() * BOOK.length)], top = y0 + (R() < .35 ? 1 : 0);
        for (let i = 0; i < w && x + i < 15; i++) for (let y = top; y <= y1; y++) px(x + i, y, y === top ? '#e8e0c8' : (i === 0 ? col : shade(col, -18)));
        x += w + (R() < .25 ? 1 : 0);
      }
    }
  } else if (kind === 'cobblestone') {
    const COB = ['#7a7a7a', '#8d8d8d', '#6a6a6a', '#9c9c9c', '#747474'];
    const seeds = Array.from({ length: 8 }, () => [R() * 16, R() * 16, COB[Math.floor(R() * 5)]] as const);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const ds = seeds.map(([sx, sy, col]) => {
        const dx = Math.min(Math.abs(x - sx), 16 - Math.abs(x - sx)), dy = Math.min(Math.abs(y - sy), 16 - Math.abs(y - sy));
        return [dx * dx + dy * dy, col] as const;
      }).sort((a, b) => a[0] - b[0]);
      const border = Math.sqrt(ds[1][0]) - Math.sqrt(ds[0][0]) < 1.1;
      px(x, y, border ? '#4a4a4a' : (R() < .15 ? shade(ds[0][1], 14) : ds[0][1]));
    }
  } else noise([['#555', 1]]);

  const url = c.toDataURL();
  TEX_CACHE.set(kind, url);
  return url;
}

/** How much each background is darkened behind the tree (bright blocks need more). */
export const BG_DIM: Readonly<Record<AreaBg, number>> = {
  dirt: .48, grass: .48, planks: .48, bookshelf: .66, cobblestone: .54, end_stone: .6, sandstone: .6,
};
