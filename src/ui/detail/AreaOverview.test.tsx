import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store/store';
import { useUi } from '../uiStore';
import { AreaOverview, EMPTY_PROMPT, OVERVIEW_HINT, recentOfArea } from './AreaOverview';

const s = () => useStore.getState();
const sectionRows = (title: string) => {
  const sec = [...document.querySelectorAll('.dsec')].find(d => d.querySelector('h3')?.textContent === title);
  return sec ? [...sec.querySelectorAll('.lk-list button')].map(b => b.textContent) : null;
};
const tiles = () => [...document.querySelectorAll('.ov-stats div')].map(d => d.textContent);

beforeEach(() => {
  act(() => s().start('starter'));
  useUi.setState({ sel: null, overview: false, modal: null, arrange: false, centerReq: null });
});

afterEach(cleanup);

describe('AreaOverview', () => {
  it('sums up an area: progress, what to do now and what was done last', () => {
    act(() => {
      s().complete('o_start', { date: '2026-09-01' });
      s().complete('o_sleep', { date: '2026-09-03' });
      s().complete('o_tidy', { date: '2026-09-03' });
      s().complete('o_water', { date: '2026-09-02' });
    });
    render(<AreaOverview areaId="origin" />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('起源');
    expect(document.querySelector('.dmeta')?.textContent).toBe('虚空之上，从一棵树开始');
    expect((document.querySelector('.ov-bar i') as HTMLElement).style.width).toBe(`${((4 / 14) * 100).toFixed(1)}%`);
    // 4 done; open: o_mind (2,-3), o_body (2,-1), o_cook (2,1), o_wealth (2,3)
    expect(tiles()).toEqual(['4已达成', '4可以开始', '6未解锁']);
    expect(sectionRows('现在可以做')).toEqual(['知识之书', '掉一格鸡腿', '熔炉点火', '清点库存']);
    // newest date first; on the same day the later completion first
    expect(sectionRows('最近达成')).toEqual(['基地大扫除✓已达成', '甜蜜的梦✓已达成', '无限水源✓已达成', '开局一棵树✓已达成']);
    expect(sectionRows('解锁条件')).toBeNull();
    expect(screen.queryByText(EMPTY_PROMPT)).toBeNull();
    expect(screen.getByText(OVERVIEW_HINT)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '熔炉点火' }));
    expect(useUi.getState().sel).toBe('o_cook');
    expect(useUi.getState().centerReq?.id).toBe('o_cook');
  });

  it('shows what unlocks a locked area and jumps there', () => {
    render(<AreaOverview areaId="craft" />);
    expect(tiles()).toEqual(['0已达成', '0可以开始', '14未解锁']);
    expect(sectionRows('解锁条件')).toEqual(['起源 · 亲手合成✗ 未达成']);
    expect(sectionRows('现在可以做')).toBeNull();
    expect(sectionRows('最近达成')).toBeNull();

    act(() => s().setArea('craft'));
    fireEvent.click(screen.getByRole('button', { name: /亲手合成/ }));
    expect(s().areaId).toBe('origin');
    expect(useUi.getState().sel).toBe('o_craft');
  });

  it('points at 「+ 新建」 in an empty area', () => {
    act(() => s().start('blank'));
    const areaId = s().data.areas[0].id;
    render(<AreaOverview areaId={areaId} />);
    expect(tiles()).toEqual(['0已达成', '1可以开始', '0未解锁']);
    expect(screen.getByText(EMPTY_PROMPT)).toBeTruthy();
    expect(sectionRows('现在可以做')).toHaveLength(1);
  });

  it('keeps at most four recent achievements', () => {
    act(() => { for (const id of ['o_start', 'o_sleep', 'o_water', 'o_tidy', 'o_mind']) s().complete(id); });
    expect(recentOfArea(s().data, 'origin')).toEqual(['o_mind', 'o_tidy', 'o_water', 'o_sleep']);
  });
});
