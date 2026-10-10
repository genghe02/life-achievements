// Pointer, wheel and focus handling for the tree viewport (the demo's vp listeners): drag to pan
// with a 6px threshold, pinch to zoom, wheel pans and Ctrl/Cmd + wheel zooms, taps select, and in
// arrange mode a drag that starts on a node moves the node instead of the view.

import { isFinePointer } from '../hooks/media';
import { NodeDrag, type ArrangeHooks } from './arrange';
import type { Viewport } from './viewport';
import { clampK, wheelPan, wheelZoom } from './viewMath';

export interface PointerHooks extends ArrangeHooks {
  /** A click on a node that was not a drag. */
  tapNode(id: string): void;
  /** A click on empty space that was not a drag. */
  tapEmpty(): void;
  /** Hover a node with the mouse (null: leave). */
  hover(el: HTMLElement | null): void;
  arrange(): boolean;
}

const DRAG_PX = 6;
const IGNORE = '.vctl, .vbanner, .arr-hint';

const closest = (t: EventTarget | null, sel: string): HTMLElement | null =>
  t instanceof Element ? t.closest<HTMLElement>(sel) : null;

export interface PointerBinding {
  /** Drop an arrange drag in progress (snap the node back). */
  cancelDrag(): void;
  dispose(): void;
}

export function bindPointer(ctl: Viewport, vp: HTMLElement, h: PointerHooks): PointerBinding {
  const ptrs = new Map<number, { x: number; y: number }>();
  let pan: { id: number; sx: number; sy: number; vx: number; vy: number } | null = null;
  let pinch: { d: number; k: number; wx: number; wy: number } | null = null;
  let nd: { id: number; sx: number; sy: number; drag: NodeDrag } | null = null;
  let moved = false;

  const capture = (id: number) => {
    try { vp.setPointerCapture(id); } catch { /* pointer already gone */ }
  };
  const startPan = (id: number, x: number, y: number) => {
    pan = { id, sx: x, sy: y, vx: ctl.view.x, vy: ctl.view.y };
  };
  const cancelDrag = () => {
    if (!nd) return;
    nd.drag.cancel();
    nd = null;
  };

  const down = (e: PointerEvent) => {
    if (closest(e.target, IGNORE)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // a touch that stops an animation keeps the view where it stopped, also for this area's next visit
    if (ctl.stop()) ctl.save();
    if (ptrs.size === 1) {
      moved = false;
      const node = h.arrange() ? closest(e.target, '.node') : null;
      if (node?.dataset.id && ctl.model.pos.has(node.dataset.id)) {
        nd = { id: e.pointerId, sx: e.clientX, sy: e.clientY, drag: new NodeDrag(ctl, node, node.dataset.id, h, e.clientX, e.clientY) };
        pan = null;
      } else startPan(e.pointerId, e.clientX, e.clientY);
    } else if (ptrs.size === 2) {
      cancelDrag();
      const [a, b] = [...ptrs.values()], r = vp.getBoundingClientRect(), v = ctl.view;
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: v.k, wx: ((a.x + b.x) / 2 - r.left - v.x) / v.k, wy: ((a.y + b.y) / 2 - r.top - v.y) / v.k };
      moved = true;
      pan = null;
      for (const id of ptrs.keys()) capture(id);
    }
  };

  const move = (e: PointerEvent) => {
    if (!ptrs.has(e.pointerId)) return;
    // The pointer is only captured past the drag threshold, so a mouse that leaves the tree before
    // that and is released outside never sends pointerup here. Without this the next hover would pan.
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) {
      release(e.pointerId, false);
      return;
    }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()], r = vp.getBoundingClientRect();
      const k = clampK(pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
      ctl.set({ k, x: (a.x + b.x) / 2 - r.left - pinch.wx * k, y: (a.y + b.y) / 2 - r.top - pinch.wy * k });
      return;
    }
    if (nd && e.pointerId === nd.id) {
      if (!moved && Math.hypot(e.clientX - nd.sx, e.clientY - nd.sy) > DRAG_PX) {
        moved = true;
        capture(e.pointerId);
        vp.classList.add('grabbing');
        h.hover(null);
        nd.drag.begin();
      }
      nd.drag.move(e.clientX, e.clientY);
      return;
    }
    if (pan && e.pointerId === pan.id) {
      const dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
      if (!moved && Math.hypot(dx, dy) > DRAG_PX) {
        moved = true;
        capture(e.pointerId);
        vp.classList.add('grabbing');
        h.hover(null);
      }
      if (moved) ctl.set({ k: ctl.view.k, x: pan.vx + dx, y: pan.vy + dy });
    }
  };

  /** A pointer went up (drop: an arrange drag lands) or was lost (the drag snaps back). */
  function release(id: number, drop: boolean): void {
    if (!ptrs.has(id)) return;
    ptrs.delete(id);
    if (nd && id === nd.id) {
      if (drop) nd.drag.drop();
      else nd.drag.cancel();
      nd = null;
    }
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 1) {
      const [rest, p] = [...ptrs.entries()][0];
      startPan(rest, p.x, p.y);
    }
    if (ptrs.size === 0) {
      pan = null;
      vp.classList.remove('grabbing');
    }
  }
  const end = (e: PointerEvent) => release(e.pointerId, e.type === 'pointerup');

  const click = (e: MouseEvent) => {
    const node = closest(e.target, '.node');
    if (node) {
      // detail 0: a keyboard activation, never a drag
      if ((!moved || e.detail === 0) && node.dataset.id) h.tapNode(node.dataset.id);
      return;
    }
    if (closest(e.target, IGNORE)) return;
    if (!moved) h.tapEmpty();
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    ctl.stop();
    const r = vp.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) ctl.zoomAt(e.clientX - r.left, e.clientY - r.top, ctl.view.k * wheelZoom(e, r.height));
    else {
      const d = wheelPan(e, r.height), v = ctl.view;
      ctl.set({ k: v.k, x: v.x - d.dx, y: v.y - d.dy });
    }
  };

  const over = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || (moved && (pan || nd)) || !isFinePointer()) return;
    const b = closest(e.target, '.node');
    if (b) h.hover(b);
  };
  const out = (e: PointerEvent) => {
    const b = closest(e.target, '.node');
    if (b && !(e.relatedTarget instanceof Node && b.contains(e.relatedTarget))) h.hover(null);
  };
  const leave = () => h.hover(null);

  // keyboard focus on a node near an edge brings it into view (pointer focus never scrolls)
  const focus = (e: FocusEvent) => {
    const b = closest(e.target, '.node');
    if (!b?.dataset.id || ptrs.size) return;
    let keyboard = true;
    try { keyboard = b.matches(':focus-visible'); } catch { /* older engines: assume keyboard */ }
    if (keyboard) ctl.reveal(b.dataset.id, 50, 50, 50);
  };
  // focusing a node in the clipped viewport may scroll it; the view is the transform alone
  const scroll = () => {
    vp.scrollLeft = 0;
    vp.scrollTop = 0;
  };

  vp.addEventListener('pointerdown', down);
  vp.addEventListener('pointermove', move);
  vp.addEventListener('pointerup', end);
  vp.addEventListener('pointercancel', end);
  vp.addEventListener('click', click);
  vp.addEventListener('wheel', wheel, { passive: false });
  vp.addEventListener('pointerover', over);
  vp.addEventListener('pointerout', out);
  vp.addEventListener('pointerleave', leave);
  vp.addEventListener('focusin', focus);
  vp.addEventListener('scroll', scroll);

  return {
    cancelDrag,
    dispose() {
      cancelDrag();
      vp.removeEventListener('pointerdown', down);
      vp.removeEventListener('pointermove', move);
      vp.removeEventListener('pointerup', end);
      vp.removeEventListener('pointercancel', end);
      vp.removeEventListener('click', click);
      vp.removeEventListener('wheel', wheel);
      vp.removeEventListener('pointerover', over);
      vp.removeEventListener('pointerout', out);
      vp.removeEventListener('pointerleave', leave);
      vp.removeEventListener('focusin', focus);
      vp.removeEventListener('scroll', scroll);
    },
  };
}
