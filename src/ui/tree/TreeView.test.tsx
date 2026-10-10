import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { areaGates, nodesOfArea } from '../../domain/rules';
import { useStore } from '../../store/store';
import { takeTitleFocus } from '../detail/nav';
import { clearToasts, getToasts, toast } from '../fx/toastQueue';
import { useUi } from '../uiStore';
import { TreeView } from './TreeView';

afterEach(cleanup);

beforeEach(() => {
  act(() => useStore.getState().start('starter'));
  useUi.setState({ sel: null, overview: false, modal: null, arrange: false, centerReq: null });
});

const first = () => useStore.getState().data.areas[0];
const nodeEl = (id: string) => document.querySelector<HTMLButtonElement>(`.node[data-id="${id}"]`)!;

describe('TreeView', () => {
  it('draws every node of the area with its status, label and connectors', () => {
    render(<TreeView />);
    const data = useStore.getState().data;
    const ns = nodesOfArea(data, first().id);
    expect(document.querySelectorAll('.node')).toHaveLength(ns.length);
    const root = ns.find(n => n.x === 0)!;
    const el = nodeEl(root.id);
    expect(el.className).toBe('node open t-' + root.type);
    expect(el.querySelector('.lb')?.textContent).toBe(root.title);
    expect(el.getAttribute('aria-label')).toBe(`${root.title}，${{ task: '任务', goal: '目标', challenge: '挑战' }[root.type]}，可以开始`);
    // children of the root are locked and show the padlock
    const kid = ns.find(n => n.parents.includes(root.id))!;
    expect(nodeEl(kid.id).classList.contains('locked')).toBe(true);
    expect(nodeEl(kid.id).querySelector('.lk')).not.toBeNull();
    // outline group with every path, then one coloured group per state
    const lo = document.querySelectorAll('.links .lo path').length;
    const li = document.querySelectorAll('.links .li path').length;
    expect(lo).toBeGreaterThan(0);
    expect(li).toBe(lo);
    expect(document.querySelector('.links')?.getAttribute('shape-rendering')).toBe('crispEdges');
  });

  it('hides the names of hidden locked nodes', () => {
    render(<TreeView />);
    const hidden = nodesOfArea(useStore.getState().data, first().id).find(n => n.hidden);
    expect(hidden).toBeDefined();
    expect(nodeEl(hidden!.id).querySelector('.lb')?.textContent).toBe('???');
  });

  it('selects a node on click and clears the selection on empty space', () => {
    render(<TreeView />);
    const root = nodesOfArea(useStore.getState().data, first().id).find(n => n.x === 0)!;
    act(() => { fireEvent.click(nodeEl(root.id)); });
    expect(useUi.getState().sel).toBe(root.id);
    expect(nodeEl(root.id).classList.contains('sel')).toBe(true);
    act(() => { fireEvent.click(document.querySelector('.vp')!); });
    expect(useUi.getState().sel).toBeNull();
  });

  it('flashes the node just completed and the ones it opened', () => {
    render(<TreeView />);
    const data = useStore.getState().data;
    const root = nodesOfArea(data, first().id).find(n => n.x === 0)!;
    act(() => { useStore.getState().complete(root.id); });
    expect(nodeEl(root.id).className).toContain('done');
    expect(nodeEl(root.id).classList.contains('fresh')).toBe(true);
    const kid = nodesOfArea(data, first().id).find(n => n.parents.includes(root.id))!;
    expect(nodeEl(kid.id).classList.contains('fresh')).toBe(true);
  });

  it('names the gate of a locked area and goes there', () => {
    const data = useStore.getState().data;
    const locked = data.areas[1];
    act(() => useStore.getState().setArea(locked.id));
    render(<TreeView />);
    const gate = areaGates(useStore.getState().data, locked.id)[0];
    const gateArea = data.areas.find(a => a.id === gate.areaId)!;
    expect(document.querySelector('.vbanner span')?.textContent).toBe(`完成「${gateArea.name} · ${gate.title}」后解锁这个领域`);
    act(() => { fireEvent.click(screen.getByRole('button', { name: '去看看' })); });
    expect(useStore.getState().areaId).toBe(gate.areaId);
    expect(useUi.getState().sel).toBe(gate.id);
    expect(useUi.getState().centerReq?.id).toBe(gate.id);
    expect(document.querySelector('.vbanner')).toBeNull();
    // the detail panel then focuses the gate's heading, as after a jump from one of its own rows
    expect(takeTitleFocus(gate.id)).toBe(true);
  });

  it('shows the arrange hint and turns arrange mode off with 「完成」', () => {
    // the window head's 「整理」 button, which started arrange mode
    render(<><button className="btn sm btn-arrange" type="button">整理</button><TreeView /></>);
    expect(document.querySelector('.arr-hint')).toBeNull();
    act(() => useUi.getState().setArrange(true));
    expect(document.querySelector('.vp')?.classList.contains('arrange')).toBe(true);
    expect(document.querySelector('.arr-hint span')?.textContent).toBe('拖动进度换个位置。');
    const done = screen.getByRole('button', { name: '完成' });
    done.focus();
    act(() => { fireEvent.click(done); });
    expect(useUi.getState().arrange).toBe(false);
    expect(document.querySelector('.vp')?.classList.contains('arrange')).toBe(false);
    // focus does not fall back to the page
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '整理' }));
  });

  it('drops a node through pointer events: a refused cell explains why, and the message goes with the area', () => {
    render(<TreeView />);
    act(() => useUi.getState().setArrange(true));
    const ns = nodesOfArea(useStore.getState().data, first().id);
    const root = ns.find(n => n.x === 0)!;
    const kid = ns.find(n => n.parents.includes(root.id))!;
    const at = (id: string) => { const st = nodeEl(id).style; return [parseFloat(st.left) + 26, parseFloat(st.top) + 26]; };
    const [kx, ky] = at(kid.id), [rx, ry] = at(root.id);
    const ev = (type: string, x: number, y: number) => new PointerEvent(type, {
      bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
    });
    // drag the child onto the root's cell (view scale is 1 at home)
    act(() => {
      nodeEl(kid.id).dispatchEvent(ev('pointerdown', 300, 300));
      nodeEl(kid.id).dispatchEvent(ev('pointermove', 300 + (rx - kx) / 2, 300 + (ry - ky) / 2));
      nodeEl(kid.id).dispatchEvent(ev('pointermove', 300 + rx - kx, 300 + ry - ky));
    });
    expect(nodeEl(kid.id).classList.contains('dragging')).toBe(true);
    expect(document.querySelector('.cell-target')?.classList.contains('bad')).toBe(true);
    act(() => { nodeEl(kid.id).dispatchEvent(ev('pointerup', 300 + rx - kx, 300 + ry - ky)); });
    const after = useStore.getState().data.achievements.find(n => n.id === kid.id)!;
    expect([after.x, after.y]).toEqual([kid.x, kid.y]);
    expect(nodeEl(kid.id).classList.contains('dragging')).toBe(false);
    expect(at(kid.id)).toEqual([kx, ky]);
    const msg = document.querySelector('.arr-hint span')!;
    expect(msg.textContent).not.toBe('拖动进度换个位置。');
    expect(msg.classList.contains('bad')).toBe(true);
    act(() => useStore.getState().setArea(useStore.getState().data.areas[1].id));
    expect(document.querySelector('.arr-hint span')?.textContent).toBe('拖动进度换个位置。');
  });

  it('hides labels when the setting is off', () => {
    render(<TreeView />);
    expect(document.querySelector('.world')?.classList.contains('nolabels')).toBe(false);
    act(() => useStore.getState().setSettings({ labels: false }));
    expect(document.querySelector('.world')?.classList.contains('nolabels')).toBe(true);
  });

  it('places toasts below the bar at the top of the tree and lets go of everything when unmounted', () => {
    vi.useFakeTimers();
    try {
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      const { unmount } = render(<TreeView />);
      act(() => useUi.getState().setArrange(true));
      const rect = (left: number, top: number, width: number, height: number) => () =>
        ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
      document.querySelector<HTMLElement>('.vp')!.getBoundingClientRect = rect(100, 50, 600, 400);
      document.querySelector<HTMLElement>('.arr-hint')!.getBoundingClientRect = rect(200, 64, 300, 26);
      clearToasts();
      toast({ icon: '', kind: 'info', l1: 'a', l2: 'b' });
      // 10px inside the top-right corner of the part below the hint bar (bottom 90, +4 gap)
      expect(getToasts().pos).toEqual({ right: window.innerWidth - 700 + 10, top: 94 + 10, width: 320 });

      const added = add.mock.calls.map(([type, fn]) => [type, fn]);
      expect(added.length).toBeGreaterThan(0);
      unmount();
      const removed = remove.mock.calls.map(([type, fn]) => [type, fn]);
      for (const [type, fn] of added) expect(removed).toContainEqual([type, fn]);
      // the toast area is unregistered: with no tree on screen the stylesheet position is kept
      clearToasts();
      toast({ icon: '', kind: 'info', l1: 'a', l2: 'b' });
      expect(getToasts().pos).toBeNull();
    } finally {
      clearToasts();
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});
