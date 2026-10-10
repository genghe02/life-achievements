import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geometry, GY } from '../../domain/layout';
import { nodesOfArea } from '../../domain/rules';
import { starterData } from '../../domain/templates';
import { bindPointer, type PointerBinding, type PointerHooks } from './pointer';
import { Viewport } from './viewport';

let vp: HTMLDivElement;
let ctl: Viewport;
let hooks: { [K in keyof PointerHooks]: ReturnType<typeof vi.fn> };
let binding: PointerBinding;

beforeEach(() => {
  vp = document.createElement('div');
  vp.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  const node = document.createElement('button');
  node.className = 'node';
  node.dataset.id = 'o_start';
  vp.append(node);
  document.body.append(vp);

  const nodes = nodesOfArea(starterData(new Date(2026, 0, 1)), 'origin');
  const geo = geometry(nodes, GY);
  ctl = new Viewport();
  ctl.vp = vp;
  ctl.model = {
    areaId: 'origin', nodes, geo, gy: GY, status: new Map(),
    pos: new Map(geo.nodes.map(p => [p.n.id, p])),
    minY: Math.min(...nodes.map(n => n.y)),
  };
  ctl.view = { x: 0, y: 0, k: 1 };
  hooks = { tapNode: vi.fn(), tapEmpty: vi.fn(), hover: vi.fn(), arrange: vi.fn(() => false), target: vi.fn(() => null), message: vi.fn() };
  binding = bindPointer(ctl, vp, hooks as unknown as PointerHooks);
});

afterEach(() => {
  binding.dispose();
  vp.remove();
});

type Init = { x: number; y: number; buttons?: number; id?: number; type?: string };
function fire(target: Element, kind: 'pointerdown' | 'pointermove' | 'pointerup', { x, y, buttons, id = 1, type = 'mouse' }: Init): void {
  target.dispatchEvent(new PointerEvent(kind, {
    bubbles: true, cancelable: true, pointerId: id, pointerType: type, button: 0,
    buttons: buttons ?? (kind === 'pointerup' ? 0 : 1), clientX: x, clientY: y,
  }));
}
const click = (target: Element) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
const view = () => ({ x: ctl.view.x, y: ctl.view.y });

describe('bindPointer', () => {
  it('pans only past the 6px threshold, and a drag is not a tap', () => {
    fire(vp, 'pointerdown', { x: 100, y: 100 });
    fire(vp, 'pointermove', { x: 104, y: 103 });
    expect(view()).toEqual({ x: 0, y: 0 });
    fire(vp, 'pointermove', { x: 160, y: 140 });
    expect(view()).toEqual({ x: 60, y: 40 });
    fire(vp, 'pointerup', { x: 160, y: 140 });
    click(vp);
    expect(hooks.tapEmpty).not.toHaveBeenCalled();
    // the view is remembered for the area
    expect(ctl.views.get('origin')).toEqual({ x: 60, y: 40, k: 1 });
  });

  it('taps a node or empty space when the pointer did not move', () => {
    const node = vp.querySelector('.node')!;
    fire(node, 'pointerdown', { x: 10, y: 10 });
    fire(node, 'pointerup', { x: 10, y: 10 });
    click(node);
    expect(hooks.tapNode).toHaveBeenCalledWith('o_start');
    fire(vp, 'pointerdown', { x: 300, y: 300 });
    fire(vp, 'pointerup', { x: 300, y: 300 });
    click(vp);
    expect(hooks.tapEmpty).toHaveBeenCalledTimes(1);
  });

  it('forgets a mouse released outside the tree before the threshold, so hovering back does not pan', () => {
    fire(vp, 'pointerdown', { x: 795, y: 300 });
    // the pointerup went to another element; the next move here has no button pressed
    fire(vp, 'pointermove', { x: 700, y: 250, buttons: 0 });
    fire(vp, 'pointermove', { x: 400, y: 150, buttons: 0 });
    expect(view()).toEqual({ x: 0, y: 0 });
    expect(vp.classList.contains('grabbing')).toBe(false);
    // a fresh drag still pans from its own start
    fire(vp, 'pointerdown', { x: 400, y: 150 });
    fire(vp, 'pointermove', { x: 420, y: 170 });
    expect(view()).toEqual({ x: 20, y: 20 });
  });

  it('keeps a touch drag going (touch moves report the contact as a pressed button)', () => {
    fire(vp, 'pointerdown', { x: 100, y: 100, type: 'touch' });
    fire(vp, 'pointermove', { x: 130, y: 100, type: 'touch' });
    expect(view()).toEqual({ x: 30, y: 0 });
  });

  it('remembers the view where a touch stopped an animation', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => frames.push(cb));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    try {
      ctl.animateTo({ k: 1, x: -200, y: -100 });
      frames.shift()!(performance.now() + 100);
      const mid = { ...ctl.view };
      expect(mid.x).toBeLessThan(0);
      expect(mid.x).toBeGreaterThan(-200);
      expect(ctl.views.has('origin')).toBe(false);
      fire(vp, 'pointerdown', { x: 10, y: 10 });
      fire(vp, 'pointerup', { x: 10, y: 10 });
      expect(ctl.views.get('origin')).toEqual(mid);
      expect(ctl.view).toEqual(mid);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('stops listening after dispose', () => {
    binding.dispose();
    fire(vp, 'pointerdown', { x: 100, y: 100 });
    fire(vp, 'pointermove', { x: 200, y: 200 });
    expect(view()).toEqual({ x: 0, y: 0 });
    binding = bindPointer(ctl, vp, hooks as unknown as PointerHooks);
  });
});
