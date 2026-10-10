// Completion effects drawn straight into <body> (short-lived elements animated with WAAPI):
// a pixel burst, floating "+XP" text and XP orbs that fly to the HUD's XP bar.

import type { NodeType } from '../../domain/types';
import { SFX } from '../../art/sfx';
import { prefersReducedMotion } from '../hooks/media';

/** A screen rectangle in viewport coordinates (a DOMRect works). */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const canAnimate = () => typeof document !== 'undefined' && typeof document.body?.animate === 'function';

export function burst(r: Box, type: NodeType): void {
  if (prefersReducedMotion() || !canAnimate()) return;
  const cols = type === 'challenge' ? ['#ff88ff', '#ffd23f', '#ffffff', '#c040ff'] : ['#ffd23f', '#ffffff', '#ffff55', '#ffaa00'];
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, N = type === 'challenge' ? 26 : 14;
  for (let i = 0; i < N; i++) {
    const p = document.createElement('i');
    p.className = 'px';
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.background = cols[i % cols.length];
    document.body.append(p);
    const a = i / N * Math.PI * 2 + Math.random() * .4, sp = 46 + Math.random() * (type === 'challenge' ? 90 : 50);
    p.animate(
      [{ transform: 'translate(0,0)' }, { transform: `translate(${Math.cos(a) * sp}px, ${Math.sin(a) * sp + 34}px)`, opacity: 0 }],
      { duration: 650 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.4,1)' },
    ).onfinish = () => p.remove();
  }
}

/** Text that rises and fades above a rectangle, e.g. 「+120 经验  +6 绿宝石」. */
export function floatText(r: Box, text: string): void {
  if (prefersReducedMotion() || !canAnimate()) return;
  const f = document.createElement('div');
  f.className = 'float small';
  f.textContent = text;
  f.style.left = (r.left + r.width / 2) + 'px';
  f.style.top = (r.top - 18) + 'px';
  document.body.append(f);
  f.animate(
    [{ transform: 'translate(-50%, 0)', opacity: 1 }, { transform: 'translate(-50%, -36px)', opacity: 0 }],
    { duration: 1400, easing: 'ease-out' },
  ).onfinish = () => f.remove();
}

/**
 * XP orbs fly from the rectangle to the HUD's XP bar; `done` runs once, when the last one lands
 * (right away without motion or without a visible bar, and at the latest after a safety timeout).
 */
export function orbs(r: Box, xp: number, done: () => void): void {
  let finished = false;
  const finish = () => { if (!finished) { finished = true; done(); } };
  const bar = typeof document !== 'undefined' ? document.querySelector('.hud .xpbar')?.getBoundingClientRect() : undefined;
  if (prefersReducedMotion() || !canAnimate() || !bar || !bar.width) { finish(); return; }
  const N = Math.min(9, 3 + Math.floor(xp / 60)), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let left = N;
  for (let i = 0; i < N; i++) {
    const o = document.createElement('i');
    o.className = 'orb';
    o.style.left = cx + 'px';
    o.style.top = cy + 'px';
    document.body.append(o);
    const tx = bar.left + bar.width * (.2 + Math.random() * .6) - cx, ty = bar.top + 5 - cy;
    const ox = (Math.random() - .5) * 80, oy = -30 - Math.random() * 40;
    const anim = o.animate([
      { transform: 'translate(0,0) scale(.6)' },
      { transform: `translate(${ox}px, ${oy}px) scale(1)`, offset: .3 },
      { transform: `translate(${tx}px, ${ty}px) scale(.8)` }],
    { duration: 700 + i * 70, delay: 120 + i * 40, easing: 'cubic-bezier(.5,0,.6,1)', fill: 'backwards' });
    const land = () => { o.remove(); SFX.orb(); if (--left === 0) finish(); };
    anim.onfinish = land;
    anim.oncancel = land;
  }
  // a background tab can hold animations back; never leave the HUD frozen for long
  setTimeout(finish, 120 + (N - 1) * 40 + 700 + (N - 1) * 70 + 1200);
}
