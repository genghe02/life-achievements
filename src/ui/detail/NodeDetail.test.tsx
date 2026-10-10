import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { today } from '../../domain/dates';
import { MSG, useStore } from '../../store/store';
import { useUi } from '../uiStore';
import { HIDDEN_DESC, NodeDetail } from './NodeDetail';

const s = () => useStore.getState();
const done = (...ids: string[]) => act(() => { for (const id of ids) expect(s().complete(id)).not.toBeNull(); });
/** NodeDetail lives inside .dscroll in the app; focus handling looks for it. */
const show = (id: string) => render(<div className="dscroll"><NodeDetail id={id} /></div>);
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const chip = () => document.querySelector('.chip')?.textContent;

// a clock that jumps ahead for every test, so a completion in one test never trips the
// double-click guard on undo in the next
let clock = 0;

beforeEach(() => {
  act(() => s().start('starter'));
  useUi.setState({ sel: null, overview: false, modal: null, arrange: false, centerReq: null });
  clock += 1e6;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NodeDetail', () => {
  it('shows an open achievement and completes it', () => {
    show('o_start');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('开局一棵树');
    expect(document.querySelector('.dmeta')?.textContent).toBe('任务 · 起源');
    expect(chip()).toBe('可以开始');
    expect(document.querySelector('.dtip')).not.toBeNull();
    expect(document.querySelector('.xpv')?.textContent).toBe('+20 经验');
    expect(document.querySelector('.emv')?.textContent).toBe('+1 绿宝石');
    // nothing before the root; its children are still locked
    expect(screen.queryByText('前置进度')).toBeNull();
    expect(screen.getByText('完成后解锁')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^甜蜜的梦/ }).textContent).toBe('甜蜜的梦');
    expect(document.querySelector('.dinfo')).toBeNull();

    const go = button('完成进度');
    expect(go.className).toBe('btn go');
    go.focus();
    fireEvent.click(go);
    expect(s().data.done.o_start?.date).toBe(today());
    expect(chip()).toBe(`✓ 已达成 · ${today()}`);
    expect(screen.queryByRole('button', { name: '完成进度' })).toBeNull();
    // the complete button is gone: focus moves to its replacement
    expect(document.activeElement).toBe(button('撤销完成'));
    expect(screen.getByRole('button', { name: /^甜蜜的梦/ }).textContent).toBe('甜蜜的梦可以开始');
    expect(document.querySelector('.dinfo')).not.toBeNull();
  });

  it('counts a counter up and down, and completes it on the last step', () => {
    done('o_start', 'o_sleep', 'o_water', 'o_body');
    show('o_offline');
    expect(chip()).toBe('可以开始');
    expect(document.querySelector('.pbar')?.textContent).toBe('0/7 天');
    expect(button('减一').disabled).toBe(true);
    expect(button('直接标记完成').className).toBe('btn');

    fireEvent.click(button('+1'));
    fireEvent.click(button('+1'));
    expect(s().data.progress.o_offline).toBe(2);
    expect(chip()).toBe('进行中 · 2/7 天');
    expect(document.querySelector('.pbar')?.textContent).toBe('2/7 天');
    fireEvent.click(button('减一'));
    expect(s().data.progress.o_offline).toBe(1);

    act(() => { for (let i = 0; i < 5; i++) s().bump('o_offline', 1); });
    const inc = button('+1');
    inc.focus();
    fireEvent.click(inc);
    expect(s().data.done.o_offline).toBeDefined();
    expect(document.querySelector('.pbar')?.textContent).toBe('7/7 天');
    expect(screen.queryByRole('button', { name: '+1' })).toBeNull();
    expect(document.activeElement).toBe(button('撤销完成'));
  });

  it('shows a locked achievement with its missing prerequisites', () => {
    show('o_mind');
    expect(chip()).toBe('未解锁 · 还差 1 个前置');
    expect(button('先完成前置进度').disabled).toBe(true);
    expect(screen.getByRole('button', { name: /^甜蜜的梦/ }).textContent).toBe('甜蜜的梦✗ 未达成');
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ 后续进度' })).toBeTruthy();
  });

  it('keeps a hidden achievement secret while it is locked', () => {
    const real = s().data.achievements.find(n => n.id === 'o_tree')!;
    show('o_tree');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('???');
    expect(document.querySelector('.dmeta')?.textContent).toBe('挑战 · 起源');
    expect(document.querySelector('.dmeta .ch')).not.toBeNull();
    expect(document.querySelector('.ddesc')?.textContent).toBe(HIDDEN_DESC);
    expect(document.body.textContent).not.toContain(real.title);
    expect(document.body.textContent).not.toContain(real.desc);
    expect(document.querySelector('.dtip')).toBeNull();
    expect(document.querySelector('.xpv')?.textContent).toBe('+??? 经验');
    expect(document.querySelector('.emv')?.textContent).toBe('+??? 绿宝石');
    expect(screen.queryByText(/现实奖励/)).toBeNull();
    expect(screen.queryByRole('button', { name: '+ 后续进度' })).toBeNull();
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy();
  });

  it('edits the date and the note of a done achievement', () => {
    act(() => { s().complete('o_start', { date: '2026-09-01', note: '种下了' }); });
    show('o_start');
    const date = screen.getByLabelText('达成日期') as HTMLInputElement;
    const note = screen.getByLabelText(/感想/) as HTMLTextAreaElement;
    expect(date.value).toBe('2026-09-01');
    expect(date.max).toBe(today());
    expect(note.value).toBe('种下了');
    expect(note.maxLength).toBe(200);
    expect(document.querySelector('.fcount')?.textContent).toBe('3/200');

    // a valid date is saved as soon as it is picked
    fireEvent.change(date, { target: { value: '2026-08-20' } });
    expect(s().data.done.o_start.date).toBe('2026-08-20');
    expect(chip()).toBe('✓ 已达成 · 2026-08-20');

    // a future date waits for the blur, then is reported and reverted
    fireEvent.change(date, { target: { value: '2999-01-01' } });
    expect(s().data.done.o_start.date).toBe('2026-08-20');
    fireEvent.blur(date);
    expect(document.querySelector('.dinfo .ferr')?.textContent).toBe(MSG.futureDate);
    expect(date.value).toBe('2026-08-20');

    // the note is saved on blur, trimmed
    fireEvent.change(note, { target: { value: '  第一棵树  ' } });
    expect(s().data.done.o_start.note).toBe('种下了');
    expect(document.querySelector('.fcount')?.textContent).toBe('8/200');
    fireEvent.blur(note);
    expect(s().data.done.o_start.note).toBe('第一棵树');
    expect(document.querySelector('.dinfo .ferr')?.textContent).toBe('');
    expect(document.querySelector('.dnote-saved')?.textContent).toBe('感想已保存。');
    expect(note.value).toBe('  第一棵树  ');

    // clearing the note removes it
    fireEvent.change(note, { target: { value: '' } });
    fireEvent.blur(note);
    expect(s().data.done.o_start.note).toBeUndefined();
  });

  it('saves an unsaved note when the panel goes away', () => {
    done('o_start');
    const view = show('o_start');
    fireEvent.change(screen.getByLabelText(/感想/), { target: { value: '没来得及失焦' } });
    view.unmount();
    expect(s().data.done.o_start.note).toBe('没来得及失焦');
  });

  it('saves an unsaved note before the persistence layer flushes on hide', () => {
    done('o_start');
    // registered first, the way the persistence layer does at startup
    const flushed: (string | undefined)[] = [];
    const persistFlush = () => flushed.push(s().data.done.o_start.note);
    document.addEventListener('visibilitychange', persistFlush);
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      show('o_start');
      fireEvent.change(screen.getByLabelText(/感想/), { target: { value: '切到后台' } });
      act(() => { document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
      expect(flushed).toEqual(['切到后台']);
    } finally {
      document.removeEventListener('visibilitychange', persistFlush);
      state.mockRestore();
    }
  });

  it('shows why undo failed', () => {
    done('o_start', 'o_sleep');
    show('o_start');
    fireEvent.click(button('撤销完成'));
    expect(document.querySelector('.dmsg')?.textContent).toBe(MSG.undoBlocked('「甜蜜的梦」'));
    expect(s().data.done.o_start).toBeDefined();
  });

  it('undoes, but not on the second click of a double-click or right after completing', () => {
    show('o_start');
    fireEvent.click(button('完成进度'));
    // the second click of the double-click lands on the undo button
    fireEvent.click(button('撤销完成'), { detail: 2 });
    expect(s().data.done.o_start).toBeDefined();
    // a quick extra click right after completing
    fireEvent.click(button('撤销完成'), { detail: 1 });
    expect(s().data.done.o_start).toBeDefined();

    clock += 1000;
    const undo = button('撤销完成');
    undo.focus();
    fireEvent.click(undo, { detail: 1 });
    expect(s().data.done.o_start).toBeUndefined();
    expect(chip()).toBe('可以开始');
    expect(document.activeElement).toBe(button('完成进度'));
  });

  it('asks twice before an undo that would delete the note', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      act(() => { s().complete('o_start', { date: '2026-09-01', note: '种下了' }); });
      show('o_start');
      fireEvent.click(button('撤销完成'), { detail: 1 });
      const armed = button('再点一次撤销（感想会删掉）');
      expect(armed.className).toBe('btn danger armed');
      expect(s().data.done.o_start).toBeDefined();
      // too soon after arming: ignored
      clock += 200;
      fireEvent.click(armed, { detail: 1 });
      expect(s().data.done.o_start).toBeDefined();
      // disarms after 4 s
      act(() => { vi.advanceTimersByTime(4000); });
      expect(button('撤销完成').className).toBe('btn');
      // arm again and confirm
      clock += 5000;
      fireEvent.click(button('撤销完成'), { detail: 1 });
      clock += 500;
      fireEvent.click(button(/^再点一次撤销/), { detail: 1 });
      expect(s().data.done.o_start).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not complete again on the second click of a double-click on 撤销完成', () => {
    act(() => { s().complete('o_start', { date: '2026-09-01', note: '种下了' }); });
    show('o_start');
    // a note makes undo two-step; the complete button then takes the undo button's place (a long
    // panel keeps the row where it is)
    fireEvent.click(button('撤销完成'), { detail: 1 });
    clock += 500;
    fireEvent.click(button(/^再点一次撤销/), { detail: 1 });
    expect(s().data.done.o_start).toBeUndefined();
    fireEvent.click(button('完成进度'), { detail: 2 });
    expect(s().data.done.o_start).toBeUndefined();
    // nor on a quick extra click
    clock += 300;
    fireEvent.click(button('完成进度'), { detail: 1 });
    expect(s().data.done.o_start).toBeUndefined();

    clock += 1000;
    fireEvent.click(button('完成进度'), { detail: 1 });
    expect(s().data.done.o_start).toBeDefined();
  });

  it('jumps to a prerequisite or an unlocked achievement in another area', () => {
    done('o_start', 'o_sleep', 'o_water');
    show('o_body');
    const rows = [...document.querySelectorAll('.lk-list button')].map(b => b.textContent);
    expect(rows).toEqual(['甜蜜的梦✓ 已达成', '无限水源✓ 已达成', '离线模式', '体魄 · 热身完毕']);

    fireEvent.click(screen.getByRole('button', { name: /热身完毕/ }));
    expect(s().areaId).toBe('body');
    expect(useUi.getState().sel).toBe('b_warm_up');
    expect(useUi.getState().centerReq?.id).toBe('b_warm_up');

    fireEvent.click(screen.getByRole('button', { name: /^甜蜜的梦/ }));
    expect(s().areaId).toBe('origin');
    expect(useUi.getState().sel).toBe('o_sleep');
  });

  it('guards each achievement on its own: a quick click on another one still counts', () => {
    let view = show('o_start');
    fireEvent.click(button('完成进度'), { detail: 1 });
    view.unmount();
    clock += 1000;
    view = show('o_water');
    fireEvent.click(button('完成进度'), { detail: 1 });
    view.unmount();
    // within the guard of o_water's completion: undoing o_start is refused with the reason
    clock += 300;
    view = show('o_start');
    fireEvent.click(button('撤销完成'), { detail: 1 });
    expect(document.querySelector('.dmsg')?.textContent).toBe(MSG.undoBlocked('「无限水源」'));
    view.unmount();
    // and right after undoing o_water, another achievement can be completed
    clock += 1000;
    view = show('o_water');
    fireEvent.click(button('撤销完成'), { detail: 1 });
    expect(s().data.done.o_water).toBeUndefined();
    view.unmount();
    clock += 300;
    show('o_tidy');
    fireEvent.click(button('完成进度'), { detail: 1 });
    expect(s().data.done.o_tidy).toBeDefined();
  });

  it('counts a note still being typed: undo saves it and asks twice', () => {
    done('o_start');
    show('o_start');
    // typed, no blur (iOS keeps the field focused when a button is tapped)
    fireEvent.change(screen.getByLabelText(/感想/), { target: { value: '刚写的感想' } });
    fireEvent.click(button('撤销完成'), { detail: 1 });
    expect(button('再点一次撤销（感想会删掉）')).toBeTruthy();
    expect(s().data.done.o_start).toEqual({ date: today(), note: '刚写的感想' });
    clock += 500;
    fireEvent.click(button(/^再点一次撤销/), { detail: 1 });
    expect(s().data.done.o_start).toBeUndefined();
  });

  it('says at once why undo is refused, even when the note would make it ask twice', () => {
    act(() => { s().complete('o_start', { note: '种下了' }); });
    done('o_sleep');
    show('o_start');
    fireEvent.click(button('撤销完成'), { detail: 1 });
    expect(document.querySelector('.dmsg')?.textContent).toBe(MSG.undoBlocked('「甜蜜的梦」'));
    expect(button('撤销完成').className).toBe('btn');
    expect(s().data.done.o_start.note).toBe('种下了');
  });

  it('lets an import replace the note shown in the panel', () => {
    act(() => { s().complete('o_start', { note: '设备A的感想' }); });
    const file = s().exportBackup();
    file.data = { ...file.data, done: { ...file.data.done, o_start: { ...file.data.done.o_start, note: '设备B的感想' } } };
    const view = show('o_start');
    // the menu imports and clears the selection in one go, so the panel never shows the new note
    act(() => {
      expect(s().importBackup(file)).toEqual({ ok: true });
      view.unmount();
    });
    expect(s().data.done.o_start.note).toBe('设备B的感想');
  });

  it('drops a draft whose note was replaced by an import', () => {
    act(() => { s().complete('o_start', { note: '设备A的感想' }); });
    const file = s().exportBackup();
    file.data = { ...file.data, done: { ...file.data.done, o_start: { ...file.data.done.o_start, note: '设备B的感想' } } };
    const view = show('o_start');
    fireEvent.change(screen.getByLabelText(/感想/), { target: { value: '没写完' } });
    act(() => {
      s().importBackup(file);
      view.unmount();
    });
    expect(s().data.done.o_start.note).toBe('设备B的感想');
  });

  it('opens the editor for this achievement or a new one after it', () => {
    show('o_start');
    fireEvent.click(button('编辑'));
    expect(useUi.getState().modal).toEqual({ kind: 'node', id: 'o_start', areaId: 'origin' });
    fireEvent.click(button('+ 后续进度'));
    expect(useUi.getState().modal).toEqual({ kind: 'node', areaId: 'origin', parent: 'o_start' });
  });
});
