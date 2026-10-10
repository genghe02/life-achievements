import { beforeEach, describe, expect, it } from 'vitest';
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
