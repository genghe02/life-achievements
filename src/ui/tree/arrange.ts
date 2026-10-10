// Arrange mode (「整理」): drag a node to another grid cell. The node follows the pointer, a
// .cell-target box marks the snapped cell (green when the node can go there, red when not), and
// dropping asks the store to move it; a refused drop snaps the node back and shows the reason.

import { SFX } from '../../art/sfx';
import { canPlace, GX, PAD } from '../../domain/layout';
import { useStore } from '../../store/store';
import type { Viewport } from './viewport';

export interface Cell {
  x: number;
  y: number;
}

/** The grid cell whose centre is nearest the world point. */
export function cellAt(wx: number, wy: number, gy: number, minY: number): Cell {
  const x = Math.round((wx - PAD) / GX), y = Math.round((wy - PAD) / gy) + minY;
  // no -0 in cell coordinates
  return { x: x || 0, y: y || 0 };
}

/** Top-left corner (world px) of a 52px box on the cell. */
export function cellBox(c: Cell, gy: number, minY: number): { left: number; top: number } {
  return { left: PAD + c.x * GX - 26, top: PAD + (c.y - minY) * gy - 26 };
}

/** Pan speed (px per frame) when the pointer is within `band` px of an edge: 0 inside, up to `max` at the edge and beyond. */
export function edgeSpeed(pos: number, lo: number, hi: number, band = 36, max = 8): number {
  if (hi - lo < band * 3) return 0;
  if (pos < lo + band) return Math.round(max * Math.min(1, (lo + band - pos) / band));
  if (pos > hi - band) return -Math.round(max * Math.min(1, (pos - (hi - band)) / band));
  return 0;
}

export interface ArrangeHooks {
  /** The .cell-target element. */
  target(): HTMLElement | null;
  /** Show a message in the hint bar ('' restores the hint). */
  message(msg: string): void;
}

const SNAP_MS = 200;
/** The pointer rests this long near an edge before the view starts to follow. */
const EDGE_DELAY_MS = 350;

export class NodeDrag {
  active = false;
  private cell: Cell | null = null;
  private last = { x: 0, y: 0 };
  private grab = { dx: 0, dy: 0 };
  private home = { left: 0, top: 0 };
  private from: Cell;
  private raf = 0;
  private edgeSince = 0;

  constructor(
    private ctl: Viewport,
    readonly el: HTMLElement,
    readonly id: string,
    private hooks: ArrangeHooks,
    clientX: number,
    clientY: number,
  ) {
    const p = ctl.model.pos.get(id);
    const cx = p?.cx ?? 0, cy = p?.cy ?? 0;
    this.from = { x: p?.n.x ?? 0, y: p?.n.y ?? 0 };
    this.home = { left: cx - 26, top: cy - 26 };
    const w = ctl.toWorld(clientX, clientY);
    this.grab = { dx: w.x - cx, dy: w.y - cy };
    this.last = { x: clientX, y: clientY };
  }

  /** The pointer moved past the drag threshold. */
  begin(): void {
    this.active = true;
    this.el.classList.remove('snap');
    this.el.classList.add('dragging');
    this.hooks.message('');
    this.ctl.onApply = () => this.place();
    this.place();
    this.raf = requestAnimationFrame(this.edgePan);
  }

  move(clientX: number, clientY: number): void {
    this.last = { x: clientX, y: clientY };
    if (this.active) this.place();
  }

  // pan while the pointer rests near an edge of the visible box, so a node can go anywhere
  private edgePan = () => {
    if (!this.active) return;
    const vp = this.ctl.vp;
    if (vp) {
      const r = vp.getBoundingClientRect(), b = this.ctl.box();
      const dx = edgeSpeed(this.last.x - r.left, 0, b.w), dy = edgeSpeed(this.last.y - r.top, b.t, b.h);
      const now = performance.now();
      if (!dx && !dy) this.edgeSince = 0;
      else if (!this.edgeSince) this.edgeSince = now;
      else if (now - this.edgeSince >= EDGE_DELAY_MS) {
        const v = this.ctl.view;
        this.ctl.set({ ...v, x: v.x + dx, y: v.y + dy });
      }
    }
    this.raf = requestAnimationFrame(this.edgePan);
  };

  private place(): void {
    const { model } = this.ctl;
    const w = this.ctl.toWorld(this.last.x, this.last.y);
    const cx = w.x - this.grab.dx, cy = w.y - this.grab.dy;
    this.el.style.left = `${Math.round(cx - 26)}px`;
    this.el.style.top = `${Math.round(cy - 26)}px`;
    const c = cellAt(cx, cy, model.gy, model.minY);
    if (this.cell && this.cell.x === c.x && this.cell.y === c.y) return;
    this.cell = c;
    const t = this.hooks.target();
    if (!t) return;
    const same = c.x === this.from.x && c.y === this.from.y;
    const ok = same || canPlace(model.nodes, this.id, c.x, c.y);
    const box = cellBox(c, model.gy, model.minY);
    t.style.left = `${box.left}px`;
    t.style.top = `${box.top}px`;
    t.classList.toggle('ok', ok);
    t.classList.toggle('bad', !ok);
    t.hidden = false;
  }

  private finish(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
    if (this.ctl.onApply) this.ctl.onApply = null;
    this.el.classList.remove('dragging');
    const t = this.hooks.target();
    if (t) t.hidden = true;
  }

  /** Put the node back where it was, sliding there. */
  cancel(): void {
    if (!this.active) return;
    this.finish();
    const el = this.el;
    el.classList.add('snap');
    el.style.left = `${this.home.left}px`;
    el.style.top = `${this.home.top}px`;
    setTimeout(() => el.classList.remove('snap'), SNAP_MS + 40);
  }

  drop(): void {
    if (!this.active) return;
    const c = this.cell;
    if (!c || (c.x === this.from.x && c.y === this.from.y)) {
      this.cancel();
      return;
    }
    const res = useStore.getState().moveAchievement(this.id, c.x, c.y);
    if (!res.ok) {
      this.cancel();
      this.hooks.message(res.error);
      return;
    }
    this.finish();
    // Land where the next render puts the node. React only writes left/top when they change, and
    // a move above the top row shifts every row, so the moved node's own top may not change.
    const data = useStore.getState().data;
    const area = data.achievements.filter(n => n.areaId === this.ctl.model.areaId);
    const minY = Math.min(...area.map(n => n.y));
    const box = cellBox(c, this.ctl.model.gy, minY);
    this.el.style.left = `${box.left}px`;
    this.el.style.top = `${box.top}px`;
    SFX.click();
  }
}
