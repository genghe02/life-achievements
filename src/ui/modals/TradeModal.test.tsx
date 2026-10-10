import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { today } from '../../domain/dates';
import { MSG, useStore } from '../../store/store';
import { useUi } from '../uiStore';
import { ModalHost } from './ModalHost';

const fx = vi.hoisted(() => ({ toast: vi.fn(), trade: vi.fn(), click: vi.fn() }));
vi.mock('../fx/toastQueue', async orig => ({ ...(await orig<typeof import('../fx/toastQueue')>()), toast: fx.toast }));
vi.mock('../../art/sfx', async orig => {
  const real = await orig<typeof import('../../art/sfx')>();
  return { ...real, SFX: { ...real.SFX, trade: fx.trade, click: fx.click } };
});

const s = () => useStore.getState();
let clock = 0;

beforeEach(() => {
  act(() => s().start('starter'));
  useUi.setState({ sel: null, overview: false, modal: null, arrange: false, centerReq: null });
  clock = 1e6;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  fx.toast.mockClear();
  fx.trade.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const show = () => {
  render(<ModalHost />);
  act(() => useUi.getState().openModal({ kind: 'trade' }));
};
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement;
const btn = (scope: HTMLElement, name: string | RegExp) => within(scope).getByRole('button', { name }) as HTMLButtonElement;
const logHead = () => document.querySelector('.mscroll .dsec h3')?.textContent;
const addForm = () => document.querySelector('.mscroll > form') as HTMLFormElement;
const buyBtn = (name: string) => row(name).querySelector('.tbuy') as HTMLButtonElement;
const earn = (...ids: string[]) => act(() => { for (const id of ids) expect(s().complete(id)).not.toBeNull(); });

describe('TradeModal', () => {
  it('shows the balance, villager rows and an empty log', () => {
    show();
    expect(heading()).toBe('交易 · 你有 0 颗绿宝石');
    const r = row('一杯奶茶');
    expect(r.className).toBe('trade poor');
    expect(r.querySelector('.cost b')?.textContent).toBe('3');
    const b = buyBtn('一杯奶茶');
    expect(b.textContent).toBe('还差 3');
    // read out with the reward it belongs to
    expect(b.getAttribute('aria-label')).toBe('还差 3 颗绿宝石换「一杯奶茶」');
    expect(b.disabled).toBe(true);
    expect(document.querySelector('.tlog')?.textContent).toBe('还没有交易记录。');
    expect(logHead()).toBe('交易记录 · 已花 0 颗');
  });

  it('shows a negative balance as it is', () => {
    act(() => useStore.setState(st => ({ data: { ...st.data, trades: [{ id: 't1', rewardId: null, name: '旧账', cost: 5, icon: 'chest', date: '2026-01-02' }] } })));
    show();
    expect(heading()).toBe('交易 · 你有 -5 颗绿宝石');
  });

  it('buys a reward: emeralds go down, a toast and a log line appear', () => {
    earn('o_start', 'o_sleep', 'o_water');
    show();
    expect(heading()).toBe('交易 · 你有 3 颗绿宝石');
    const r = row('一杯奶茶');
    expect(r.className).toBe('trade');
    expect(buyBtn('一杯奶茶').textContent).toBe('交易');
    fireEvent.click(btn(r, '交易「一杯奶茶」，花 3 颗绿宝石'));
    expect(s().data.trades).toHaveLength(1);
    expect(heading()).toBe('交易 · 你有 0 颗绿宝石');
    expect(fx.trade).toHaveBeenCalledTimes(1);
    expect(fx.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'trade', l1: '交易成功！', l2: '一杯奶茶 · -3 绿宝石' }));
    expect(buyBtn('一杯奶茶').disabled).toBe(true);
    expect(buyBtn('一杯奶茶').textContent).toBe('还差 3');
    expect(logHead()).toBe('交易记录 · 已花 3 颗');
    expect(document.querySelector('.tlog')?.textContent).toBe(`${today()} · 一杯奶茶 · -3`);
    // toasts stay under an open modal: the modal says what was bought itself
    const said = screen.getByRole('status');
    expect(said.textContent).toBe('换到了「一杯奶茶」，花了 3 颗绿宝石。');
    expect(said.className).toBe('mok small');
    // and lets it go once something else happens
    fireEvent.click(btn(row('一杯奶茶'), '编辑「一杯奶茶」'));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('lists every trade, newest first', () => {
    const trades = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, rewardId: null, name: `第${i}次`, cost: 1, icon: 'chest', date: `2026-01-0${i + 1}` }));
    act(() => useStore.setState(st => ({ data: { ...st.data, trades } })));
    show();
    const items = [...document.querySelectorAll('.tlog li')].map(li => li.textContent);
    expect(items).toHaveLength(9);
    expect(items[0]).toBe('2026-01-09 · 第8次 · -1');
    expect(items[8]).toBe('2026-01-01 · 第0次 · -1');
    expect(logHead()).toBe('交易记录 · 已花 9 颗');
  });

  it('adds a reward, showing the store message when it is not valid', () => {
    show();
    const form = addForm();
    const name = within(form).getByPlaceholderText('比如：买一副新耳机') as HTMLInputElement;
    const cost = form.querySelector('input[type=number]') as HTMLInputElement;
    expect(cost.value).toBe('12');
    fireEvent.click(btn(form, '添加奖励'));
    expect(form.querySelector('.ferr')?.textContent).toBe(MSG.rewardEmpty);
    fireEvent.change(name, { target: { value: '新耳机' } });
    fireEvent.change(cost, { target: { value: '' } });
    fireEvent.click(btn(form, '添加奖励'));
    expect(form.querySelector('.ferr')?.textContent).toBe(MSG.cost);
    fireEvent.change(cost, { target: { value: '30' } });
    fireEvent.click(within(form).getByLabelText('钻石'));
    fireEvent.click(btn(form, '添加奖励'));
    expect(s().data.rewards.at(-1)).toMatchObject({ name: '新耳机', cost: 30, icon: 'diamond' });
    expect(form.querySelector('.ferr')?.textContent).toBe('');
    expect(name.value).toBe('');
    expect(cost.value).toBe('12');
    expect(row('新耳机')).toBeTruthy();
  });

  it('edits a reward in place, and cancel leaves it as it was', () => {
    show();
    fireEvent.click(btn(row('一顿火锅'), '编辑「一顿火锅」'));
    let li = document.querySelector('.trade.editing') as HTMLElement;
    const name = li.querySelector('input:not([type])') as HTMLInputElement;
    expect(name.value).toBe('一顿火锅');
    expect(document.activeElement).toBe(name);
    expect((li.querySelector('input[type=number]') as HTMLInputElement).value).toBe('15');
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.click(btn(li, '保存'));
    expect(li.querySelector('.ferr')?.textContent).toBe(MSG.rewardEmpty);
    fireEvent.click(btn(li, '取消'));
    expect(document.querySelector('.trade.editing')).toBeNull();
    expect(s().data.rewards.find(r => r.name === '一顿火锅')?.cost).toBe(15);

    const id = s().data.rewards.find(r => r.name === '一顿火锅')!.id;
    fireEvent.click(btn(row('一顿火锅'), '编辑「一顿火锅」'));
    li = document.querySelector('.trade.editing') as HTMLElement;
    fireEvent.change(li.querySelector('input:not([type])') as HTMLInputElement, { target: { value: '一顿烤肉' } });
    fireEvent.change(li.querySelector('input[type=number]') as HTMLInputElement, { target: { value: '18' } });
    fireEvent.click(within(li).getByLabelText('炖菜'));
    fireEvent.click(btn(li, '保存'));
    expect(document.querySelector('.trade.editing')).toBeNull();
    expect(s().data.rewards.find(r => r.id === id)).toMatchObject({ name: '一顿烤肉', cost: 18, icon: 'stew' });
  });

  it('deletes a reward only on a second click within 4 s', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    show();
    const count = s().data.rewards.length;
    const del = () => btn(row('看一场电影'), /删除「看一场电影」/);
    fireEvent.click(del());
    expect(del().className).toBe('btn sm danger armed');
    expect(del().textContent).toBe('再点一次删除');
    // the tail of a double-click does not confirm
    clock += 100;
    fireEvent.click(del());
    expect(s().data.rewards).toHaveLength(count);
    // after 4 s it disarms
    act(() => { vi.advanceTimersByTime(4000); });
    expect(del().className).toBe('btn sm danger');
    fireEvent.click(del());
    clock += 600;
    fireEvent.click(del());
    expect(s().data.rewards).toHaveLength(count - 1);
    expect(screen.queryByText('看一场电影')).toBeNull();
  });

  it('pays once for a double click, and again for a later click', () => {
    earn('o_start', 'o_sleep', 'o_water', 'o_tidy', 'o_mind', 'o_body', 'o_cook');
    show();
    expect(heading()).toBe('交易 · 你有 10 颗绿宝石');
    fireEvent.click(buyBtn('一杯奶茶'));
    clock += 120;
    fireEvent.click(buyBtn('一杯奶茶'));
    expect(s().data.trades).toHaveLength(1);
    expect(heading()).toBe('交易 · 你有 7 颗绿宝石');
    clock += 600;
    fireEvent.click(buyBtn('一杯奶茶'));
    expect(s().data.trades).toHaveLength(2);
    expect(heading()).toBe('交易 · 你有 4 颗绿宝石');
  });

  it('ignores a second submit right after an add instead of asking for a name', () => {
    show();
    const form = addForm();
    const name = within(form).getByPlaceholderText('比如：买一副新耳机') as HTMLInputElement;
    const count = s().data.rewards.length;
    fireEvent.change(name, { target: { value: '吃顿好的' } });
    fireEvent.submit(form);
    clock += 100;
    fireEvent.submit(form);
    expect(s().data.rewards).toHaveLength(count + 1);
    expect(form.querySelector('.ferr')?.textContent).toBe('');
    // a real empty submit later still says what is missing
    clock += 600;
    fireEvent.submit(form);
    expect(form.querySelector('.ferr')?.textContent).toBe(MSG.rewardEmpty);
  });

  it('cancels a row edit on Esc and keeps the modal open', () => {
    show();
    fireEvent.click(btn(row('一顿火锅'), '编辑「一顿火锅」'));
    const li = document.querySelector('.trade.editing') as HTMLElement;
    const name = li.querySelector('input:not([type])') as HTMLInputElement;
    fireEvent.change(name, { target: { value: '改了一半' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(document.querySelector('.trade.editing')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(useUi.getState().modal).toEqual({ kind: 'trade' });
    expect(s().data.rewards.some(r => r.name === '一顿火锅')).toBe(true);
    // with no row being edited, Esc on a button closes the modal as usual
    fireEvent.keyDown(btn(row('一顿火锅'), '编辑「一顿火锅」'), { key: 'Escape' });
    expect(useUi.getState().modal).toBeNull();
  });

  it('says so when there are no rewards', () => {
    act(() => useStore.setState(st => ({ data: { ...st.data, rewards: [] } })));
    show();
    expect(document.querySelector('.trades')).toBeNull();
    expect(screen.getByText(/还没有奖励/)).toBeTruthy();
  });
});
