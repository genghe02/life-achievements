import { beforeEach, describe, expect, it, vi } from 'vitest';
import { geometry, GY } from '../../domain/layout';
import { nodesOfArea, statusOf } from '../../domain/rules';
import { starterData } from '../../domain/templates';
import { Viewport } from './viewport';

let size = { w: 800, h: 600 };
let ctl: Viewport;

beforeEach(() => {
  size = { w: 800, h: 600 };
  const vp = document.createElement('div');
  vp.getBoundingClientRect = () => ({ left: 0, top: 0, right: size.w, bottom: size.h, width: size.w, height: size.h, x: 0, y: 0, toJSON: () => ({}) });
  const world = document.createElement('div');
  vp.append(world);
  const data = starterData(new Date(2026, 0, 1));
  const nodes = nodesOfArea(data, 'origin');
  const geo = geometry(nodes, GY);
  ctl = new Viewport();
  ctl.vp = vp;
  ctl.world = world;
  ctl.model = {
    areaId: 'origin', nodes, geo, gy: GY,
    status: new Map(nodes.map(n => [n.id, statusOf(data, n.id)])),
    pos: new Map(geo.nodes.map(p => [p.n.id, p])),
    minY: Math.min(...nodes.map(n => n.y)),
  };
  ctl.restore();
});

describe('Viewport', () => {
  it('opens an area at its home view and applies it to the world', () => {
    expect(ctl.view).toEqual(ctl.clamp(ctl.home()));
    expect(ctl.world?.style.transform).toBe(`translate(${ctl.view.x}px, ${ctl.view.y}px) scale(1)`);
    expect(ctl.views.has('origin')).toBe(false);
  });

  it('re-homes an untouched view on resize', () => {
    const before = { ...ctl.view };
    size = { w: 360, h: 500 };
    ctl.reclamp();
    expect(ctl.view).toEqual(ctl.clamp(ctl.home()));
    expect(ctl.view).not.toEqual(before);
  });

  it('only re-clamps an untouched view while something is selected', () => {
    const before = { ...ctl.view };
    size = { w: 360, h: 500 };
    ctl.reclamp(true);
    expect(ctl.view).toEqual(ctl.clamp(before));
  });

  it('moves the tree down from under a bar at the top, as far as the room below allows', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      const { y0, y1 } = ctl.model.geo.content;
      // the tree's top 30px sit under a bar whose visible box starts at 50px; plenty of room below
      size = { w: 800, h: 800 };
      ctl.set({ k: 1, x: ctl.view.x, y: 20 - y0 });
      const bar = document.createElement('div');
      bar.className = 'arr-hint';
      bar.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 46, width: 300, height: 46, x: 0, y: 0, toJSON: () => ({}) });
      ctl.vp!.append(bar);
      ctl.clearTop();
      vi.advanceTimersByTime(1000);
      expect(ctl.view.y + y0).toBe(50);

      // too little room: it moves only as far as the bottom allows
      size = { w: 800, h: 50 + (y1 - y0) - 10 };
      ctl.set({ k: 1, x: ctl.view.x, y: 20 - y0 });
      ctl.clearTop();
      vi.advanceTimersByTime(1000);
      expect(ctl.view.y + y1).toBe(size.h);
      expect(ctl.view.y + y0).toBe(40);
    } finally {
      vi.useRealTimers();
    }
  });

  it('only re-clamps a view the user moved, and remembers it for the area', () => {
    ctl.set({ k: 1, x: ctl.view.x - 40, y: ctl.view.y - 30 });
    const moved = { ...ctl.view };
    expect(ctl.views.get('origin')).toEqual(moved);
    size = { w: 700, h: 560 };
    ctl.reclamp();
    expect(ctl.view).toEqual(ctl.clamp(moved));
    // 「定位」 forgets it
    ctl.goHome();
    expect(ctl.views.has('origin')).toBe(false);
  });
});
