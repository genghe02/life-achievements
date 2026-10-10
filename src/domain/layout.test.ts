import { describe, expect, it } from 'vitest';
import {
  busLanes,
  canPlace,
  conflicts,
  connectorSegments,
  findSlot,
  geometry,
  GRID_MAX,
  GX,
  type GridNode,
  PAD,
  placeNode,
  placeProblem,
} from './layout';
import { nodesOfArea, statusOf } from './rules';
import { starterData } from './templates';
import type { Achievement, LifeData, NodeStatus } from './types';

const NOW = new Date(2026, 9, 10, 12);

function node(id: string, x: number, y: number, parents: string[] = [], areaId = 'a'): Achievement {
  return { id, areaId, title: id, desc: '', type: 'task', icon: 'sapling', parents, x, y, xp: 40, pts: 2 };
}

function lifeData(achievements: Achievement[], done: string[] = []): LifeData {
  return {
    version: 1,
    areas: [{ id: 'a', name: 'A', subtitle: '', icon: 'sapling', bg: 'dirt' }],
    achievements,
    done: Object.fromEntries(done.map(id => [id, { date: '2026-10-01' }])),
    progress: {},
    rewards: [],
    trades: [],
    settings: { sound: true, labels: true },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

// r(0,0) -> a(1,-1), b(1,1); a + b -> c(2,0). The buses of a and b meet end to end at row 0.
const DIAMOND = [node('r', 0, 0), node('a', 1, -1, ['r']), node('b', 1, 1, ['r']), node('c', 2, 0, ['a', 'b'])];

describe('geometry', () => {
  it('places cell centres and computes bounds', () => {
    const g = geometry(DIAMOND, 84);
    const at = (id: string) => g.nodes.find(p => p.n.id === id)!;
    expect(at('r')).toMatchObject({ cx: PAD, cy: PAD + 84 });
    expect(at('a')).toMatchObject({ cx: PAD + GX, cy: PAD });
    expect(at('c')).toMatchObject({ cx: PAD + 2 * GX, cy: PAD + 84 });
    expect(g.width).toBe(PAD * 2 + 2 * GX);
    expect(g.height).toBe(PAD * 2 + 2 * 84 + 20);
    expect(g.bounds).toEqual({ x0: PAD - 60, x1: PAD + 2 * GX + 60, y0: PAD - 50, y1: PAD + 2 * 84 + 70 });
    expect(g.content).toEqual({ x0: PAD - 52, x1: PAD + 2 * GX + 52, y0: PAD - 30, y1: PAD + 2 * 84 + 48 });
  });

  it('uses the given row pitch', () => {
    const g = geometry(DIAMOND, 76);
    expect(g.nodes.find(p => p.n.id === 'b')!.cy).toBe(PAD + 2 * 76);
  });

  it('handles an empty area', () => {
    const g = geometry([], 84);
    expect(g.nodes).toEqual([]);
    expect(g.width).toBeGreaterThan(0);
  });
});

describe('conflicts', () => {
  const starter = starterData(NOW);

  it('is zero for every starter area', () => {
    for (const area of starter.areas) {
      expect(conflicts(nodesOfArea(starter, area.id)), area.id).toBe(0);
    }
  });

  it('accepts buses that touch at a shared child', () => {
    expect(conflicts(DIAMOND)).toBe(0);
  });

  it('counts a shared cell', () => {
    expect(conflicts([...DIAMOND, node('d', 2, 0, ['a'])])).toBeGreaterThan(0);
  });

  it('counts a parent that is not in a smaller column', () => {
    expect(conflicts([node('r', 0, 0), node('a', 1, 0, ['r']), node('b', 1, 1, ['a'])])).toBe(1);
  });

  it('counts overlapping buses in one gap', () => {
    // a's bus spans rows -1..1, b's spans 0..2
    const ns = [
      node('r', 0, 0),
      node('a', 1, -1, ['r']),
      node('b', 1, 2, ['r']),
      node('c', 2, 1, ['a']),
      node('d', 2, 0, ['b']),
    ];
    expect(conflicts(ns)).toBeGreaterThan(0);
  });

  it('counts buses that touch without a shared child', () => {
    // a's bus spans rows -1..0 and b's spans 0..1: they meet at row 0, where only b has a child
    const touching = [node('r', 0, 0), node('a', 1, 0, ['r']), node('b', 1, 1, ['r']), node('c', 2, -1, ['a']), node('d', 2, 0, ['b'])];
    expect(conflicts(touching)).toBe(1);
  });

  it('counts an edge running through another node', () => {
    // r -> c at (2,0) runs along row 0 through a at (1,0)
    expect(conflicts([node('r', 0, 0), node('a', 1, 0, ['r']), node('c', 2, 0, ['r'])])).toBeGreaterThan(0);
  });

  it('counts an edge crossing another parent bus', () => {
    // r -> e at (3,0) crosses column 1's bus of p (rows -1..1)
    const ns = [
      node('r', 0, 0),
      node('p', 1, -1, ['r']),
      node('k', 2, 1, ['p']),
      node('e', 3, 0, ['r']),
    ];
    expect(conflicts(ns)).toBeGreaterThan(0);
  });

  it('ignores parents outside the list', () => {
    expect(conflicts([node('r', 0, 0, ['elsewhere'])])).toBe(0);
  });
});

describe('findSlot', () => {
  const starter = starterData(NOW);

  it('returns a conflict-free cell after every parent, for every single parent and pair in the starter', () => {
    let found = 0;
    const crowded: string[] = [];
    for (const area of starter.areas) {
      const ns = nodesOfArea(starter, area.id);
      const sets: string[][] = [];
      for (let i = 0; i < ns.length; i++) {
        sets.push([ns[i].id]);
        for (let j = i + 1; j < ns.length; j++) sets.push([ns[i].id, ns[j].id]);
      }
      for (const parents of sets) {
        const slot = findSlot(ns, parents);
        if (!slot) continue;
        found++;
        const ps = ns.filter(n => parents.includes(n.id));
        expect(slot.x).toBeGreaterThan(Math.max(...ps.map(p => p.x)));
        expect(conflicts([...ns, { id: '__t', x: slot.x, y: slot.y, parents }]), `${area.id} ${parents}`).toBe(0);
      }
      for (const n of ns) if (!findSlot(ns, [n.id])) crowded.push(n.id);
    }
    expect(found).toBeGreaterThan(350);
    // 新村民入 is boxed in: its gap's neighbours touch rows -2 and 0, and row -1 is taken further right
    expect(crowded).toEqual(['r_new_friends']);
  });

  it('keeps the tree clean while adding many nodes', () => {
    let ns: GridNode[] = nodesOfArea(starter, 'origin');
    for (let i = 0; i < 40; i++) {
      const p = ns[(i * 7) % ns.length];
      const slot = findSlot(ns, [p.id]);
      if (!slot) continue;
      ns = [...ns, { id: `n${i}`, x: slot.x, y: slot.y, parents: [p.id] }];
      expect(conflicts(ns)).toBe(0);
    }
  });

  it('starts next to the parents average row', () => {
    expect(findSlot(DIAMOND, ['c'])).toEqual({ x: 3, y: 0 });
  });

  it('returns null without parents in the area', () => {
    expect(findSlot(DIAMOND, [])).toBeNull();
    expect(findSlot(DIAMOND, ['elsewhere'])).toBeNull();
  });

  it('returns null when every cell would tangle', () => {
    // any child of both a and b needs a bus across c's row in column 1
    const ns = [node('r', 0, 0), node('a', 1, -3, ['r']), node('b', 1, 3, ['r']), node('c', 1, 0, ['r']), node('d', 2, 0, ['c'])];
    expect(conflicts(ns)).toBe(0);
    expect(findSlot(ns, ['a', 'b'])).toBeNull();
  });

  it('re-places an existing node left of its children', () => {
    // move c's prerequisites to r only: it must stay left of its child z
    const ns = [...DIAMOND, node('z', 3, 0, ['c'])];
    const edited = ns.map(n => (n.id === 'c' ? { ...n, parents: ['r'] } : n));
    const slot = findSlot(edited, ['r'], 'c');
    expect(slot).not.toBeNull();
    expect(slot!.x).toBeLessThan(3);
    const placed = edited.map(n => (n.id === 'c' ? { ...n, ...slot! } : n));
    expect(conflicts(placed)).toBe(0);
  });
});

describe('canPlace', () => {
  it('allows a free cell that keeps the tree clean', () => {
    expect(canPlace(DIAMOND, 'c', 3, 0)).toBe(true);
    expect(canPlace(DIAMOND, 'r', 0, 3)).toBe(true);
  });

  it('keeps the root in column 0 and everything else out of it', () => {
    expect(placeProblem(DIAMOND, 'r', 1, 0)).toBe('root');
    expect(placeProblem(DIAMOND, 'a', 0, -1)).toBe('root');
  });

  it('keeps the column order', () => {
    expect(placeProblem(DIAMOND, 'c', 1, 0)).toBe('column');
    expect(placeProblem(DIAMOND, 'a', 2, -1)).toBe('column');
  });

  it('refuses a taken cell', () => {
    expect(placeProblem(DIAMOND, 'b', 1, -1)).toBe('occupied');
  });

  it('refuses a move that tangles connectors', () => {
    expect(placeProblem(DIAMOND, 'b', 1, -2)).toBe('tangle');
    expect(canPlace(DIAMOND, 'b', 1, -2)).toBe(false);
  });

  it('refuses unknown nodes and fractional cells', () => {
    expect(placeProblem(DIAMOND, 'zz', 1, 1)).toBe('missing');
    expect(placeProblem(DIAMOND, 'c', 2.5, 0)).toBe('missing');
  });

  it('accepts the node own cell on a clean tree', () => {
    expect(canPlace(DIAMOND, 'c', 2, 0)).toBe(true);
  });

  // parseBackup rejects cells off this grid, so a node placed there would make the saved data unloadable
  it('keeps nodes on the grid', () => {
    expect(placeProblem(DIAMOND, 'c', 3, GRID_MAX + 1)).toBe('missing');
    expect(placeProblem(DIAMOND, 'c', 3, -GRID_MAX - 1)).toBe('missing');
    expect(placeProblem(DIAMOND, 'c', GRID_MAX + 1, 0)).toBe('missing');
    expect(placeProblem(DIAMOND, 'r', 0, GRID_MAX + 1)).toBe('missing');
    const pair = [node('r', 0, 0), node('a', 1, 0, ['r'])];
    expect(canPlace(pair, 'a', GRID_MAX, -GRID_MAX)).toBe(true);
    expect(placeProblem(pair, 'a', GRID_MAX, -GRID_MAX - 1)).toBe('missing');
  });
});

describe('findSlot on the grid edge', () => {
  it('never returns a cell off the grid', () => {
    const edge = [node('r', 0, 0), node('p', GRID_MAX - 1, 0, ['r']), node('q', GRID_MAX, 0, ['p'])];
    expect(findSlot(edge, ['p'])).toMatchObject({ x: GRID_MAX });
    expect(findSlot(edge, ['q'])).toBeNull();
    const low = [node('r', 0, GRID_MAX), node('p', 1, GRID_MAX, ['r'])];
    for (let i = 0; i < 40; i++) {
      const slot = findSlot(low, ['r']);
      if (!slot) break;
      expect(Math.abs(slot.y)).toBeLessThanOrEqual(GRID_MAX);
      low.push(node(`k${i}`, slot.x, slot.y, ['r']));
    }
  });
});

describe('connectors', () => {
  it('gives buses that meet end to end opposite lanes', () => {
    const lanes = busLanes(DIAMOND);
    expect(lanes.get('a')).toBe(-6);
    expect(lanes.get('b')).toBe(6);
    expect(lanes.get('r')).toBe(0);
    expect(lanes.has('c')).toBe(false);
  });

  it('routes one bus per parent and one stem per edge, coloured by status', () => {
    const data = lifeData(DIAMOND, ['r', 'a']);
    const geo = geometry(DIAMOND, 84);
    const segs = connectorSegments(data, 'a', geo);
    const buses = segs.filter(s => s.kind === 'bus');
    const stems = segs.filter(s => s.kind === 'stem');
    expect(buses).toHaveLength(3);
    expect(stems).toHaveLength(4);
    // r sits between its children: horizontal to the elbow, then one vertical run
    expect(buses.find(s => s.from === 'r')).toEqual({ d: 'M56 140H112M112 56V224', state: 'done', kind: 'bus', from: 'r' });
    expect(buses.find(s => s.from === 'a')).toMatchObject({ d: 'M168 56H218V140', state: 'done' });
    expect(buses.find(s => s.from === 'b')).toMatchObject({ d: 'M168 224H230V140', state: 'locked' });
    expect(stems.find(s => s.from === 'r' && s.to === 'a')).toMatchObject({ d: 'M112 56H168', state: 'done' });
    expect(stems.find(s => s.from === 'r' && s.to === 'b')).toMatchObject({ d: 'M112 224H168', state: 'open' });
    expect(stems.find(s => s.from === 'a' && s.to === 'c')).toMatchObject({ d: 'M218 140H280', state: 'locked' });
    expect(stems.find(s => s.from === 'b' && s.to === 'c')).toMatchObject({ d: 'M230 140H280', state: 'locked' });
    // locked first, done last, so brighter lines draw on top
    const order = { locked: 0, open: 1, done: 2 };
    for (let i = 1; i < segs.length; i++) expect(order[segs[i].state]).toBeGreaterThanOrEqual(order[segs[i - 1].state]);
  });

  it('draws one bus even when a parent has several children in a row', () => {
    const ns = [node('r', 0, 0), node('a', 1, 0, ['r']), node('b', 1, 1, ['r']), node('c', 1, 2, ['r'])];
    const segs = connectorSegments(lifeData(ns), 'a', geometry(ns, 84));
    const buses = segs.filter(s => s.kind === 'bus');
    expect(buses).toHaveLength(1);
    expect(buses[0].d).toBe('M56 56H112V224');
    expect(segs.filter(s => s.kind === 'stem')).toHaveLength(3);
  });

  it('skips parents in other areas', () => {
    const ns = [node('r', 0, 0, ['x1']), node('a', 1, 0, ['r'])];
    const data = lifeData([...ns, node('x1', 0, 0, [], 'other')]);
    const segs = connectorSegments(data, 'a', geometry(ns, 84));
    expect(segs.every(s => s.from === 'r')).toBe(true);
    expect(segs).toHaveLength(2);
  });

  it('routes every starter area', () => {
    const starter = starterData(NOW);
    for (const area of starter.areas) {
      const ns = nodesOfArea(starter, area.id);
      const segs = connectorSegments(starter, area.id, geometry(ns, 84));
      const edges = ns.reduce((a, n) => a + n.parents.filter(p => ns.some(m => m.id === p)).length, 0);
      expect(segs.filter(s => s.kind === 'stem')).toHaveLength(edges);
      expect(segs.every(s => /^M[\d.-]+ [\d.-]+[HVM\d .-]+$/.test(s.d))).toBe(true);
    }
  });
});

describe('connectors match the demo', () => {
  // The demo's renderWorld() routing, ported line for line: one bus path per edge (deduplicated),
  // one stem per edge, sorted into colour groups.
  function demoPaths(data: LifeData, areaId: string, gy: number): Record<NodeStatus, string[]> {
    const ns = nodesOfArea(data, areaId);
    const minY = Math.min(...ns.map(n => n.y));
    const pos = new Map(ns.map(n => [n.id, { cx: PAD + n.x * GX, cy: PAD + (n.y - minY) * gy }]));
    const spans: Record<number, { id: string; lo: number; hi: number }[]> = {};
    for (const p of ns) {
      const ks = ns.filter(c => c.parents.includes(p.id));
      if (!ks.length) continue;
      const ys = [p.y, ...ks.map(c => c.y)];
      (spans[p.x] ||= []).push({ id: p.id, lo: Math.min(...ys), hi: Math.max(...ys) });
    }
    const lane: Record<string, number> = {};
    for (const list of Object.values(spans)) {
      list.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
      list.forEach((s, i) => {
        const prev = list[i - 1], next = list[i + 1];
        const tPrev = prev && prev.hi === s.lo, tNext = next && next.lo === s.hi;
        lane[s.id] = tPrev ? -lane[prev.id] || 6 : tNext ? -6 : 0;
      });
    }
    const segs: Record<NodeStatus, string[]> = { locked: [], open: [], done: [] };
    const drawn = new Set<string>();
    for (const c of ns) {
      for (const pid of c.parents) {
        const p = pos.get(pid);
        if (!p) continue;
        const cc = pos.get(c.id)!;
        const bx = p.cx + GX / 2 + (lane[pid] || 0);
        const bus = `M${p.cx} ${p.cy}H${bx}V${cc.cy}`;
        if (!drawn.has(bus)) {
          drawn.add(bus);
          segs[Object.hasOwn(data.done, pid) ? 'done' : 'locked'].push(bus);
        }
        segs[statusOf(data, c.id)].push(`M${bx} ${cc.cy}H${cc.cx}`);
      }
    }
    return segs;
  }

  /** The pixels a set of M/H/V paths covers, as merged horizontal and vertical runs. */
  function coverage(paths: string[]): string[] {
    const runs = new Map<string, [number, number][]>();
    const add = (key: string, a: number, b: number) => {
      if (a === b) return;
      const list = runs.get(key) ?? [];
      list.push([Math.min(a, b), Math.max(a, b)]);
      runs.set(key, list);
    };
    for (const d of paths) {
      let x = 0, y = 0;
      for (const [, cmd, v] of d.matchAll(/([MHV])([-\d.]+(?: [-\d.]+)?)/g)) {
        if (cmd === 'M') [x, y] = v.split(' ').map(Number);
        else if (cmd === 'H') add(`h${y}`, x, (x = +v));
        else add(`v${x}`, y, (y = +v));
      }
    }
    const out: string[] = [];
    for (const [key, list] of runs) {
      list.sort((a, b) => a[0] - b[0]);
      let [lo, hi] = list[0];
      for (const [a, b] of list.slice(1)) {
        if (a <= hi) hi = Math.max(hi, b);
        else {
          out.push(`${key}:${lo}-${hi}`);
          [lo, hi] = [a, b];
        }
      }
      out.push(`${key}:${lo}-${hi}`);
    }
    return out.sort();
  }

  const starter = starterData(NOW);
  const someDone = {
    ...starter,
    done: Object.fromEntries(
      starter.achievements.filter((n, i) => i % 3 === 0 || n.x <= 1).map(n => [n.id, { date: '2026-10-01' }]),
    ),
  };

  for (const data of [starter, someDone]) {
    for (const area of starter.areas) {
      it(`covers the same lines in the same colours: ${area.id}${data === starter ? '' : ' (part done)'}`, () => {
        for (const gy of [84, 76]) {
          const demo = demoPaths(data, area.id, gy);
          const ours = connectorSegments(data, area.id, geometry(nodesOfArea(data, area.id), gy));
          for (const state of ['locked', 'open', 'done'] as const) {
            expect(coverage(ours.filter(s => s.state === state).map(s => s.d))).toEqual(coverage(demo[state]));
          }
        }
      });
    }
  }
});

describe('placeNode', () => {
  const starter = starterData(new Date('2026-10-10'));

  it('returns the findSlot cell when there is room', () => {
    const ns = nodesOfArea(starter, 'origin');
    expect(placeNode(ns, ['o_start'])).toEqual(findSlot(ns, ['o_start']));
  });

  it('finds a place under every single starter node, keeping the tree clean', () => {
    for (const a of starter.areas) {
      const ns = nodesOfArea(starter, a.id);
      for (const n of ns) {
        const p = placeNode(ns, [n.id]);
        expect(p, `${a.id}/${n.id}`).not.toBeNull();
        const shifted = ns.map(m => (p!.insertRow !== undefined && m.y >= p!.insertRow ? { ...m, y: m.y + 1 } : m));
        const probe = { id: '__new', x: p!.x, y: p!.y, parents: [n.id] };
        expect(conflicts([...shifted, probe]), `${a.id}/${n.id}`).toBe(0);
        expect(p!.x).toBeGreaterThan(n.x);
      }
    }
  });

  it('inserts a row when the crowded cells around a parent are all taken', () => {
    const ns = nodesOfArea(starter, 'bond');
    expect(findSlot(ns, ['r_new_friends'])).toBeNull();
    const p = placeNode(ns, ['r_new_friends']);
    expect(p?.insertRow).toBeTypeOf('number');
  });

  it('re-places an existing node to the left of its children', () => {
    const ns = nodesOfArea(starter, 'origin');
    const kid = ns.find(n => n.parents.length && ns.some(c => c.parents.includes(n.id)))!;
    const p = placeNode(ns, kid.parents, kid.id)!;
    for (const c of ns.filter(c => c.parents.includes(kid.id))) expect(p.x).toBeLessThan(c.x);
  });
});
