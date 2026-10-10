import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store/store';
import { App } from '../App';
import { useUi } from '../uiStore';
import { ONB_LEAD, ONB_NOTE, Onboarding } from './Onboarding';

const s = () => useStore.getState();

beforeEach(() => {
  act(() => useStore.setState({ phase: 'new' }));
  useUi.setState({ sel: null, overview: false, modal: null, arrange: false });
});

afterEach(cleanup);

describe('Onboarding', () => {
  it('shows the title, the two choices and where data is kept', () => {
    render(<Onboarding />);
    expect(screen.getByRole('main', { name: '人生成就系统' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('人生成就系统');
    expect(screen.getByText(ONB_LEAD)).toBeTruthy();
    expect(screen.getByText(ONB_NOTE)).toBeTruthy();
    const group = screen.getByRole('group', { name: '选一个开始方式' });
    const starter = screen.getByRole('button', { name: '示例模板' });
    const blank = screen.getByRole('button', { name: '空白开始' });
    expect(group.contains(starter) && group.contains(blank)).toBe(true);
    expect(starter.getAttribute('aria-describedby')).toBeTruthy();
    const desc = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby')!)!;
    expect(desc(starter).textContent).toBe('7 个领域、97 个进度。把已经做到的勾上。');
    expect(desc(blank).textContent).toBe('每个领域只有一个起点。想做的进度自己加。');
    // one sentence per line
    expect([...desc(starter).children].map(c => c.textContent)).toEqual(['7 个领域、97 个进度。', '把已经做到的勾上。']);
  });

  it('示例模板 loads the 97-achievement template with nothing done', () => {
    render(<Onboarding />);
    fireEvent.click(screen.getByRole('button', { name: '示例模板' }));
    expect(s().phase).toBe('ready');
    expect(s().data.areas).toHaveLength(7);
    expect(s().data.achievements).toHaveLength(97);
    expect(Object.keys(s().data.done)).toHaveLength(0);
    expect(s().areaId).toBe(s().data.areas[0].id);
  });

  it('空白开始 leaves one root per area', () => {
    render(<Onboarding />);
    fireEvent.click(screen.getByRole('button', { name: '空白开始' }));
    expect(s().phase).toBe('ready');
    const { areas, achievements } = s().data;
    expect(areas).toHaveLength(7);
    expect(achievements).toHaveLength(7);
    for (const a of areas) {
      const nodes = achievements.filter(n => n.areaId === a.id);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({ x: 0, parents: [] });
    }
  });

  it('the app shows onboarding on first launch and the tree after a choice', () => {
    render(<App />);
    expect(document.querySelector('.onb')).not.toBeNull();
    expect(document.querySelector('.hud')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '示例模板' }));
    expect(document.querySelector('.onb')).toBeNull();
    expect(document.querySelector('.hud')).not.toBeNull();
  });
});
