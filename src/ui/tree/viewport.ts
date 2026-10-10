// The tree viewport's imperative half: the current view (pan and zoom), applied straight to the
// DOM through refs so a pointer move never re-renders React. Ported from the demo's applyView /
// clampTo / animateTo / visibleBox / homeView / fitView.

import type { Geometry, PlacedNode } from '../../domain/layout';
import type { Achievement, NodeStatus } from '../../domain/types';
import { isPhone, isSideways, prefersReducedMotion } from '../hooks/media';
import type { ToastArea } from '../fx/toastQueue';
import {
  centerView,
  clampView,
  fitView,
  homeView,
  labelsHidden,
  nearEdge,
  stepK,
  visibleBox,
  zoomAround,
  type View,
  type VisBox,
  type VisMeasure,
} from './viewMath';

/** What the viewport knows about the tree on screen; TreeView refreshes it on every render. */
export interface TreeModel {
  areaId: string;
  nodes: readonly Achievement[];
  geo: Geometry<Achievement>;
  pos: ReadonlyMap<string, PlacedNode<Achievement>>;
  status: ReadonlyMap<string, NodeStatus>;
  gy: number;
  /** The smallest row of the area (row minY is drawn at the top). */
  minY: number;
}

const EMPTY_GEO: Geometry<Achievement> = {
  nodes: [], width: 0, height: 0, bounds: { x0: 0, x1: 0, y0: 0, y1: 0 }, content: { x0: 0, x1: 0, y0: 0, y1: 0 },
};

export const EMPTY_MODEL: TreeModel = { areaId: '', nodes: [], geo: EMPTY_GEO, pos: new Map(), status: new Map(), gy: 84, minY: 0 };

const ANIM_MS = 320;

/** The phone sheet or sideways dock, when it is showing (the detail module toggles `.open`). */
function openSheet(): HTMLElement | null {
  if (typeof document === 'undefined' || !isPhone()) return null;
  const d = document.getElementById('detail');
  return d && d.classList.contains('open') ? d : null;
}

export class Viewport {
  vp: HTMLDivElement | null = null;
  world: HTMLDivElement | null = null;
  view: View = { x: 0, y: 0, k: 1 };
  /** Remembered view per area. */
  readonly views = new Map<string, View>();
  model: TreeModel = EMPTY_MODEL;
  /** Runs after every applied view change (the arrange drag keeps its node under the pointer). */
  onApply: (() => void) | null = null;
  private anim = 0;

  /** True while the phone sheet (or sideways dock) covers part of the tree. */
  sheetOpen(): boolean {
    return !!openSheet();
  }

  box(): VisBox {
    const vp = this.vp;
    if (!vp) return { w: 0, h: 0, t: 0 };
    const r = vp.getBoundingClientRect();
    const sheet = openSheet();
    let side: VisMeasure['sheet'] = null;
    if (sheet && isSideways()) side = { side: 'right', left: sheet.offsetLeft };
    else if (sheet) {
      // offsetHeight ignores the slide-in transform, so this is where the sheet ends up
      const gap = parseFloat(getComputedStyle(sheet).bottom);
      side = { side: 'bottom', top: window.innerHeight - (Number.isFinite(gap) ? gap : 10) - sheet.offsetHeight };
    }
    const bar = vp.querySelector('.vbanner, .arr-hint');
    return visibleBox({
      left: r.left, top: r.top, width: r.width, height: r.height,
      sheet: side,
      barBottom: bar ? bar.getBoundingClientRect().bottom : null,
    });
  }

  /** Where toasts go: the visible box in window coordinates. */
  toastArea(): ToastArea | null {
    const vp = this.vp;
    if (!vp) return null;
    const r = vp.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    const b = this.box();
    return { top: r.top + b.t, right: r.left + b.w, width: b.w };
  }

  clamp(v: View = this.view, b: VisBox = this.box()): View {
    return clampView(v, b, this.model.geo.bounds);
  }

  apply(): void {
    const v = this.view;
    v.x = Math.round(v.x);
    v.y = Math.round(v.y);
    const { world, vp } = this;
    if (world) {
      world.classList.toggle('tiny', labelsHidden(v.k, window.devicePixelRatio || 1));
      world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    }
    if (vp) {
      vp.style.backgroundSize = `auto, ${32 * v.k}px ${32 * v.k}px`;
      vp.style.backgroundPosition = `0 0, ${v.x}px ${v.y}px`;
    }
    this.onApply?.();
  }

  save(): void {
    if (this.model.areaId) this.views.set(this.model.areaId, { ...this.view });
  }

  /** Stop an animation; true if one was running. */
  stop(): boolean {
    const was = !!this.anim;
    if (was) cancelAnimationFrame(this.anim);
    this.anim = 0;
    return was;
  }

  /** Jump to a view (clamped) and remember it for the area. */
  set(v: View): void {
    this.stop();
    this.view = this.clamp(v);
    this.apply();
    this.save();
  }

  animateTo(target: View): void {
    this.stop();
    const t = this.clamp(target);
    if (prefersReducedMotion()) {
      this.set(t);
      return;
    }
    const s = { ...this.view }, t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ANIM_MS), e = 1 - Math.pow(1 - p, 3);
      this.view = { x: s.x + (t.x - s.x) * e, y: s.y + (t.y - s.y) * e, k: s.k + (t.k - s.k) * e };
      this.apply();
      if (p < 1) this.anim = requestAnimationFrame(step);
      else {
        this.anim = 0;
        this.set(this.view);
      }
    };
    this.anim = requestAnimationFrame(step);
  }

  /** Zoom keeping the viewport point (px, py) still. */
  zoomAt(px: number, py: number, k: number): void {
    this.set(zoomAround(this.view, px, py, k));
  }

  zoomStep(dir: 1 | -1): void {
    const b = this.box();
    this.zoomAt(b.w / 2, (b.t + b.h) / 2, stepK(this.view.k, dir));
  }

  home(): View {
    const { geo, status } = this.model;
    const nodes = geo.nodes.map(p => ({ cx: p.cx, cy: p.cy, open: status.get(p.n.id) === 'open', root: p.n.x === 0 }));
    // phones keep room for the floating zoom buttons while the sheet is closed
    return homeView(nodes, this.box(), isPhone() && !this.sheetOpen() ? 44 : 0);
  }

  /** 「定位」: forget the area's view and ease back home. */
  goHome(): void {
    this.views.delete(this.model.areaId);
    this.animateTo(this.home());
  }

  /** 「全览」 */
  fit(): void {
    if (!this.model.geo.nodes.length) return;
    this.animateTo(fitView(this.model.geo.content, this.box()));
  }

  centerOn(id: string, k = this.view.k): void {
    const p = this.model.pos.get(id);
    if (p) this.animateTo(centerView(p.cx, p.cy, k, this.box()));
  }

  /** Centre the node when it sits within the margins of an edge of the visible box. */
  reveal(id: string, side: number, top: number, bottom: number): void {
    const p = this.model.pos.get(id);
    if (p && nearEdge(this.view, p.cx, p.cy, this.box(), side, top, bottom)) this.centerOn(id);
  }

  /**
   * A bar just appeared over the top of the tree (the arrange hint): ease the tree down from under
   * it as far as the room below allows, so the top nodes can still be grabbed.
   */
  clearTop(): void {
    const b = this.box();
    const v = this.view;
    const { y0, y1 } = this.model.geo.content;
    if (!this.model.geo.nodes.length) return;
    const under = b.t - (v.y + y0 * v.k);
    // phones keep room for the floating zoom buttons while the sheet is closed
    const room = b.h - (isPhone() && !this.sheetOpen() ? 44 : 0) - (v.y + y1 * v.k);
    const dy = Math.min(under, room);
    if (dy >= 1) this.animateTo({ ...v, y: v.y + dy });
  }

  /** Show the current area's remembered view, or its home view. */
  restore(): void {
    this.stop();
    const b = this.box();
    // laid out with no size yet (hidden, or measured too early): place it on the first resize
    this.pending = !(b.w > 0 && b.h > 0);
    this.view = this.clamp(this.views.get(this.model.areaId) ?? this.home(), b);
    this.apply();
  }

  /**
   * After a resize: a view the user never moved stays the home view; any other is re-clamped.
   * `keep` (something is selected) also only re-clamps, so the selection does not jump away.
   */
  reclamp(keep = false): void {
    if (this.pending || (!keep && !this.anim && !this.views.has(this.model.areaId))) {
      this.restore();
      return;
    }
    if (this.anim) return;
    this.view = this.clamp();
    this.apply();
  }

  private pending = false;

  /** Window point to world point. */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.vp?.getBoundingClientRect();
    const v = this.view;
    return { x: (clientX - (r?.left ?? 0) - v.x) / v.k, y: (clientY - (r?.top ?? 0) - v.y) / v.k };
  }
}
