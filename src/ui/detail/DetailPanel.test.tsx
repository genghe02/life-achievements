import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store/store';
import { MEDIA } from '../hooks/media';
import { useUi } from '../uiStore';
import { DetailPanel } from './DetailPanel';

// jsdom has no matchMedia: a fake one whose phone query follows `phone`
let phone = false;
const listeners = new Set<() => void>();
const setPhone = (on: boolean) => act(() => {
  phone = on;
  listeners.forEach(fn => fn());
});
const realMatchMedia = window.matchMedia;

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    get matches() { return query === MEDIA.phone && phone; },
    media: query,
    onchange: null,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    addListener: (fn: () => void) => listeners.add(fn),
    removeListener: (fn: () => void) => listeners.delete(fn),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterAll(() => {
  window.matchMedia = realMatchMedia;
});

const s = () => useStore.getState();
const panel = () => document.getElementById('detail') as HTMLElement;
const title = () => panel().querySelector('.dh h2')?.textContent;
const ui = (fn: () => void) => act(fn);

beforeEach(() => {
  act(() => s().start('starter'));
  useUi.setState({ sel: null, overview: false, modal: null, arrange: false, centerReq: null });
  setPhone(false);
});

afterEach(cleanup);

describe('DetailPanel on a desktop', () => {
  it('shows the area overview, or the selected achievement', () => {
    render(<DetailPanel />);
    expect(panel().tagName).toBe('ASIDE');
    expect(panel().className).toBe('detail mcp');
    expect(panel().getAttribute('aria-live')).toBe('polite');
    expect(panel().querySelector(':scope > .dscroll')).not.toBeNull();
    expect(title()).toBe('起源');

    ui(() => useUi.getState().select('o_start'));
    expect(title()).toBe('开局一棵树');
    expect(panel().className).toBe('detail mcp');

    // a selection that no longer exists falls back to the overview
    ui(() => useUi.getState().select('gone'));
    expect(title()).toBe('起源');

    ui(() => useUi.getState().select(null));
    ui(() => s().setArea('body'));
    expect(title()).toBe('体魄');
  });

  it('drops a selection that went stale', () => {
    render(<DetailPanel />);

    // the selected achievement was deleted (from the node editor)
    ui(() => useUi.getState().select('o_tree'));
    expect(title()).toBe('???');
    ui(() => { expect(s().deleteAchievement('o_tree').ok).toBe(true); });
    expect(useUi.getState().sel).toBeNull();
    expect(title()).toBe('起源');

    // the area holding the selection was deleted
    ui(() => { s().setArea('body'); useUi.getState().focusNode('b_warm_up'); });
    expect(title()).toBe('热身完毕');
    ui(() => { expect(s().deleteArea('body').ok).toBe(true); });
    expect(useUi.getState().sel).toBeNull();
    expect(title()).toBe('起源');

    // the area changed without the selection following it
    ui(() => useUi.getState().select('o_start'));
    ui(() => s().setArea('mind'));
    expect(useUi.getState().sel).toBeNull();
    expect(title()).toBe('学识');

    // a jump to another area switches area and selection together, and keeps the selection
    ui(() => { s().setArea('origin'); useUi.getState().focusNode('o_start'); });
    expect(useUi.getState().sel).toBe('o_start');
    expect(title()).toBe('开局一棵树');
  });

  it('moves focus to the heading of the achievement a row jumped to', () => {
    render(<DetailPanel />);
    fireEvent.click(screen.getByRole('button', { name: /开局一棵树/ }));
    expect(title()).toBe('开局一棵树');
    expect(document.activeElement).toBe(panel().querySelector('.dh h2'));
  });
});

describe('DetailPanel on a phone', () => {
  it('opens as a sheet for a selection or the overview, and the × closes it', () => {
    setPhone(true);
    render(<DetailPanel />);
    expect(panel().classList.contains('open')).toBe(false);

    ui(() => useUi.getState().select('o_start'));
    expect(panel().classList.contains('open')).toBe(true);
    expect(title()).toBe('开局一棵树');

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(useUi.getState().sel).toBeNull();
    expect(panel().classList.contains('open')).toBe(false);
    // the closing sheet keeps its content instead of flashing the overview
    expect(title()).toBe('开局一棵树');

    ui(() => useUi.getState().showOverview(true));
    expect(panel().classList.contains('open')).toBe(true);
    expect(title()).toBe('起源');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(useUi.getState().overview).toBe(false);
    expect(panel().classList.contains('open')).toBe(false);
    expect(title()).toBe('起源');

    // back on a wide screen the panel is a column again
    setPhone(false);
    expect(panel().classList.contains('open')).toBe(false);
    expect(title()).toBe('起源');
  });

  it('closes the sheet when the selected achievement is deleted', () => {
    setPhone(true);
    render(<DetailPanel />);
    ui(() => useUi.getState().select('o_tree'));
    expect(panel().classList.contains('open')).toBe(true);
    ui(() => { s().deleteAchievement('o_tree'); });
    expect(useUi.getState().sel).toBeNull();
    expect(useUi.getState().overview).toBe(false);
    expect(panel().classList.contains('open')).toBe(false);
  });

  it('hands focus back to the achievement on the tree when the sheet closes', () => {
    setPhone(true);
    const onTree = document.createElement('button');
    onTree.className = 'node';
    onTree.dataset.id = 'o_start';
    document.body.append(onTree);
    try {
      render(<DetailPanel />);
      ui(() => useUi.getState().select('o_start'));
      const go = screen.getByRole('button', { name: '完成进度' });
      go.focus();
      ui(() => useUi.getState().select(null));
      expect(document.activeElement).toBe(onTree);
    } finally {
      onTree.remove();
    }
  });

  it('hands focus to the 概览 button, or to the tree when the achievement is not on it', () => {
    setPhone(true);
    const head = document.createElement('div');
    head.className = 'whead';
    head.innerHTML = '<button class="btn-info">概览</button>';
    const tree = document.createElement('div');
    tree.id = 'vp';
    tree.tabIndex = -1;
    document.body.append(head, tree);
    try {
      render(<DetailPanel />);
      ui(() => useUi.getState().showOverview(true));
      screen.getByRole('button', { name: '关闭' }).focus();
      fireEvent.click(screen.getByRole('button', { name: '关闭' }));
      expect(document.activeElement).toBe(head.firstChild);

      // no .node[data-id="o_start"] in this document
      ui(() => useUi.getState().select('o_start'));
      screen.getByRole('button', { name: '编辑' }).focus();
      ui(() => useUi.getState().select(null));
      expect(document.activeElement).toBe(tree);
    } finally {
      head.remove();
      tree.remove();
    }
  });

  it('keeps focus in the panel when the sheet becomes the desktop column', () => {
    setPhone(true);
    render(<DetailPanel />);
    ui(() => useUi.getState().select('o_start'));
    const go = screen.getByRole('button', { name: '完成进度' });
    go.focus();
    setPhone(false);
    expect(panel().classList.contains('open')).toBe(false);
    expect(document.activeElement).toBe(go);
  });
});
