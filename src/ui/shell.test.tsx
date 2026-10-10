import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store/store';
import { App } from './App';
import { AreaTabs } from './AreaTabs';
import { Hud } from './Hud';
import { useUi } from './uiStore';
import { WindowHead } from './WindowHead';

afterEach(cleanup);

beforeEach(() => {
  act(() => useStore.getState().start('starter'));
  useUi.setState({ sel: null, overview: false, modal: null, arrange: false });
});

describe('AreaTabs', () => {
  it('lists every area as a tab, then the + tab', () => {
    render(<AreaTabs />);
    const areas = useStore.getState().data.areas;
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(areas.length);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].textContent).toContain('未解锁');
    fireEvent.click(screen.getByRole('button', { name: '新建领域' }));
    expect(useUi.getState().modal).toEqual({ kind: 'area' });
  });

  it('moves between areas with the arrow keys and clears the selection', () => {
    render(<AreaTabs />);
    const areas = useStore.getState().data.areas;
    useUi.setState({ sel: 'x' });
    act(() => { fireEvent.keyDown(screen.getAllByRole('tab')[0], { key: 'ArrowRight' }); });
    expect(useStore.getState().areaId).toBe(areas[1].id);
    expect(useUi.getState().sel).toBeNull();
    act(() => { fireEvent.keyDown(screen.getAllByRole('tab')[1], { key: 'ArrowLeft' }); });
    act(() => { fireEvent.keyDown(screen.getAllByRole('tab')[0], { key: 'ArrowLeft' }); });
    expect(useStore.getState().areaId).toBe(areas[areas.length - 1].id);
  });
});

describe('WindowHead', () => {
  it('shows the area and opens the editors', () => {
    render(<WindowHead />);
    const area = useStore.getState().data.areas[0];
    expect(screen.getByRole('heading').textContent).toBe(area.name);
    expect(document.querySelector('.wprog')?.textContent).toMatch(/^已达成 0\/\d+$/);
    fireEvent.click(screen.getByRole('button', { name: '领域设置' }));
    expect(useUi.getState().modal).toEqual({ kind: 'area', id: area.id });
    fireEvent.click(screen.getByRole('button', { name: '整理' }));
    expect(useUi.getState().arrange).toBe(true);
    const root = useStore.getState().data.achievements.find(n => n.areaId === area.id && n.x === 0)!;
    useUi.setState({ sel: root.id });
    fireEvent.click(screen.getByRole('button', { name: '+ 新建' }));
    expect(useUi.getState().modal).toEqual({ kind: 'node', areaId: area.id, parent: root.id });
  });
});

describe('Hud', () => {
  it('shows level, done count and emeralds', () => {
    render(<Hud />);
    expect(document.querySelector('.lv')?.textContent).toBe('0');
    const all = useStore.getState().data.achievements.length;
    expect(screen.getByText(`· 已达成 0/${all}`, { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '菜单' }));
    expect(useUi.getState().modal).toEqual({ kind: 'menu' });
  });
});

describe('App', () => {
  it('closes the detail on Esc, but Esc in a text field only leaves the field', () => {
    render(<App />);
    const input = document.createElement('textarea');
    document.body.append(input);
    try {
      useUi.setState({ sel: 'x' });
      input.focus();
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(useUi.getState().sel).toBe('x');
      expect(document.activeElement).not.toBe(input);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(useUi.getState().sel).toBeNull();
      useUi.setState({ sel: 'x', modal: { kind: 'menu' } });
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(useUi.getState().sel).toBe('x');
    } finally {
      input.remove();
    }
  });
});
