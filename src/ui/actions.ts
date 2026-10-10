// Store actions with their game feel: sounds, the pixel burst, the floating "+XP", orbs flying
// to the HUD, then the level-up and 「新领域已解锁！」 toasts. UI code calls these instead of
// useStore.getState().complete / bump when the user completes something.

import { icon, XPORB } from '../art/pixel';
import { SFX } from '../art/sfx';
import { levelOf, rankOf } from '../domain/level';
import { areaLocked, TOAST_L1 } from '../domain/rules';
import type { CompleteResult } from '../domain/types';
import { requestPersist } from '../pwa';
import { useStore } from '../store/store';
import { burst, floatText, orbs, type Box } from './fx/effects';
import { holdHud, hudNumbers, landHud } from './fx/hudFx';
import { toast } from './fx/toastQueue';

const completeListeners = new Set<(r: CompleteResult) => void>();

/** Hear about every completion made through these actions (e.g. to flash newly unlocked nodes). */
export function onCompleted(fn: (r: CompleteResult) => void): () => void {
  completeListeners.add(fn);
  return () => completeListeners.delete(fn);
}

function visible(r: DOMRect): boolean {
  return r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
}

/** Where effects start: the node on the tree if it is on screen, else the middle of the tree. */
function rectFor(id: string): Box {
  const sel = `.node[data-id="${id.replace(/["\\]/g, '\\$&')}"]`;
  const vp = document.querySelector('.vp')?.getBoundingClientRect();
  const node = document.querySelector(sel)?.getBoundingClientRect();
  if (node && visible(node)) {
    const cx = node.left + node.width / 2, cy = node.top + node.height / 2;
    if (!vp || (cx >= vp.left && cx <= vp.right && cy >= vp.top && cy <= vp.bottom)) return node;
  }
  if (vp && vp.width) return { left: vp.left + vp.width / 2 - 26, top: vp.top + vp.height / 2 - 26, width: 52, height: 52 };
  return { left: window.innerWidth / 2 - 26, top: window.innerHeight / 2 - 26, width: 52, height: 52 };
}

let persistAsked = false;

function play(r: CompleteResult, rect?: Box): void {
  const data = useStore.getState().data;
  const n = data.achievements.find(a => a.id === r.id);
  if (!n) return;
  const box = rect ?? rectFor(r.id);

  const hold = holdHud(r.id, r.xpGained, r.ptsGained);
  SFX[n.type]();
  toast({ icon: icon(n.icon), kind: n.type, l1: TOAST_L1[n.type], l2: n.title });
  burst(box, n.type);
  floatText(box, `+${r.xpGained} 经验  +${r.ptsGained} 绿宝石`);
  orbs(box, r.xpGained, () => {
    const now = useStore.getState().data;
    if (!landHud(hold, now)) return;
    const lv = levelOf(hudNumbers(now).xp).level;
    SFX.levelup();
    toast({ icon: XPORB, kind: 'level', l1: '等级提升！', l2: `人生等级 ${lv} · ${rankOf(lv)}` });
  });

  r.unlockedAreas.forEach((areaId, i) => setTimeout(() => {
    const d = useStore.getState().data;
    const a = d.areas.find(x => x.id === areaId);
    if (!a || areaLocked(d, areaId)) return;
    toast({ icon: icon(a.icon), kind: 'tab', l1: '新领域已解锁！', l2: a.subtitle ? `${a.name} · ${a.subtitle}` : a.name });
  }, 700 + i * 300));

  completeListeners.forEach(fn => fn(r));

  if (!persistAsked) {
    persistAsked = true;
    void requestPersist();
  }
}

/**
 * Complete an open achievement with all effects. `rect` is where the effects start (defaults to
 * the node on the tree). Returns the store result: null when the achievement isn't open.
 */
export function completeWithFx(id: string, rect?: Box): CompleteResult | null {
  const r = useStore.getState().complete(id);
  if (r) play(r, rect);
  return r;
}

/**
 * Counter +1 / -1. Reaching the target completes the achievement with all effects; otherwise a
 * click plays if the counter moved. Returns the store result (non-null only on completion).
 */
export function bumpWithFx(id: string, delta: 1 | -1, rect?: Box): CompleteResult | null {
  const st = useStore.getState();
  const prev = st.data.progress[id] ?? 0;
  const r = st.bump(id, delta);
  if (r) play(r, rect);
  else if ((useStore.getState().data.progress[id] ?? 0) !== prev) SFX.click();
  return r;
}
