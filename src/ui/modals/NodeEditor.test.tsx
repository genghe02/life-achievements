import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { totals } from '../../domain/level';
import { byId } from '../../domain/rules';
import { MSG, useStore } from '../../store/store';
import { useUi, type ModalState } from '../uiStore';
import { ModalHost } from './ModalHost';

const fx = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../fx/toastQueue', async orig => ({ ...(await orig<typeof import('../fx/toastQueue')>()), toast: fx.toast }));

const s = () => useStore.getState();
const node = (id: string) => byId(s().data).get(id);
let clock = 0;

beforeEach(() => {
  act(() => s().start('starter'));
  useUi.setState({ sel: null, overview: false, modal: null, arrange: false, centerReq: null });
  clock = 1e6;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  fx.toast.mockClear();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  // let focus moves the editors scheduled for the next frame run before the next test
  await new Promise<void>(res => requestAnimationFrame(() => res()));
});

const show = (m: Exclude<ModalState, null>) => {
  render(<ModalHost />);
  act(() => useUi.getState().openModal(m));
};
const dialog = () => screen.getByRole('dialog');
const field = (label: RegExp) => within(dialog()).getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
const parentBox = (id: string) => dialog().querySelector(`input[type=checkbox][value="${id}"]`) as HTMLInputElement;
const checkedParents = () => [...dialog().querySelectorAll<HTMLInputElement>('input[type=checkbox][value]:checked')].map(i => i.value);
const advanced = () => [...dialog().querySelectorAll<HTMLInputElement>('.adv input')].map(i => i.value);
const submit = () => fireEvent.click(within(dialog()).getByRole('button', { name: /^(添加到进度树|保存)$/ }));
const err = () => dialog().querySelector('.dact .ferr')?.textContent;
const frame = () => act(() => new Promise<void>(res => requestAnimationFrame(() => res())));
/** Stand-ins for the tree's node buttons, which the editors focus when their opener is gone. */
const fakeTree = (...ids: string[]) => {
  const vp = document.createElement('div');
  vp.id = 'vp';
  vp.tabIndex = -1;
  for (const id of ids) {
    const b = document.createElement('button');
    b.className = 'node';
    b.dataset.id = id;
    vp.append(b);
  }
  document.body.append(vp);
  return vp;
};
const pickType = (name: '任务' | '目标' | '挑战') =>
  fireEvent.click(within(dialog()).getByText(name).closest('label')!.querySelector('input')!);

describe('NodeEditor: new', () => {
  it('preselects the parent from the modal state and adds the achievement', () => {
    show({ kind: 'node', areaId: 'origin', parent: 'o_water' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('新建进度 · 起源');
    expect(checkedParents()).toEqual(['o_water']);
    expect(document.activeElement).toBe(field(/^名称/));
    expect(field(/^名称/).maxLength).toBe(12);
    expect(advanced()).toEqual(['40', '2']);

    type(/^名称/, '学会游泳');
    type(/^完成条件/, '不用浮板游完25米');
    type(/^小提示/, '先练憋气');
    type(/^累计目标/, '');
    submit();

    const added = s().data.achievements.find(n => n.title === '学会游泳');
    expect(added).toMatchObject({ areaId: 'origin', desc: '不用浮板游完25米', tip: '先练憋气', parents: ['o_water'], type: 'task', xp: 40, pts: 2 });
    expect(added?.target).toBeUndefined();
    expect(useUi.getState().modal).toBeNull();
    expect(useUi.getState().sel).toBe(added?.id);
    expect(useUi.getState().centerReq?.id).toBe(added?.id);
    expect(fx.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'task', l1: '新进度已添加', l2: '学会游泳' }));
  });

  it("defaults to the area's root, switches to the area and keeps every field", () => {
    expect(s().areaId).toBe('origin');
    show({ kind: 'node', areaId: 'mind' });
    expect(checkedParents()).toEqual(['m_bookshelf']);
    fireEvent.click(parentBox('m_quill'));
    type(/^名称/, '读完十本书');
    type(/^完成条件/, '一年里读完十本书');
    pickType('目标');
    type(/^累计目标/, '10');
    type(/^单位/, '本');
    type(/^现实奖励/, '一个新书架');
    fireEvent.click(within(dialog()).getByText('隐藏进度').closest('label')!.querySelector('input')!);
    fireEvent.click(within(dialog()).getByLabelText('书'));
    submit();
    const added = s().data.achievements.find(n => n.title === '读完十本书');
    expect(added).toMatchObject({
      areaId: 'mind', parents: ['m_bookshelf', 'm_quill'], type: 'goal', xp: 120, pts: 6,
      target: 10, unit: '本', reward: '一个新书架', hidden: true, icon: 'book',
    });
    expect(s().areaId).toBe('mind');
  });

  it('follows the type with XP and emeralds until the user types in them', () => {
    show({ kind: 'node', areaId: 'origin' });
    pickType('挑战');
    expect(advanced()).toEqual(['300', '15']);
    fireEvent.change(dialog().querySelectorAll('.adv input')[0], { target: { value: '77' } });
    pickType('目标');
    expect(advanced()).toEqual(['77', '6']);
    type(/^名称/, '自定');
    type(/^完成条件/, '自定经验');
    // an emptied number field is "not given": the store uses the type's default
    fireEvent.change(dialog().querySelectorAll('.adv input')[1], { target: { value: '' } });
    submit();
    expect(s().data.achievements.find(n => n.title === '自定')).toMatchObject({ type: 'goal', xp: 77, pts: 6 });
  });

  it('says so when a number field holds text that is not a number', () => {
    show({ kind: 'node', areaId: 'origin' });
    type(/^名称/, '计数');
    type(/^完成条件/, '做三次');
    // the browser reports "3-" as an empty value with validity.badInput
    const target = field(/^累计目标/);
    Object.defineProperty(target, 'validity', { value: { badInput: true } });
    submit();
    expect(err()).toBe(MSG.target);
    expect(s().data.achievements.some(n => n.title === '计数')).toBe(false);
    expect(useUi.getState().modal).not.toBeNull();
  });

  it('opens the 「高级」 fold when the message is about XP or emeralds', () => {
    show({ kind: 'node', areaId: 'origin' });
    type(/^名称/, '经验太多');
    type(/^完成条件/, '试试');
    const adv = dialog().querySelector('details.adv') as HTMLDetailsElement;
    expect(adv.open).toBe(false);
    fireEvent.change(dialog().querySelectorAll('.adv input')[0], { target: { value: '99999' } });
    submit();
    expect(err()).toBe(MSG.xp);
    expect(adv.open).toBe(true);
  });

  it('focuses the new achievement on the tree when the opener is gone', async () => {
    const vp = fakeTree('o_start');
    show({ kind: 'node', areaId: 'origin', parent: 'o_water' });
    type(/^名称/, '学会游泳');
    type(/^完成条件/, '游完25米');
    submit();
    const id = useUi.getState().sel!;
    const b = document.createElement('button');
    b.className = 'node';
    b.dataset.id = id;
    vp.append(b);
    // the dialog's own button had focus and went with it
    expect(document.activeElement).toBe(document.body);
    await frame();
    expect(document.activeElement).toBe(b);
    vp.remove();
  });

  it('shows the store message and stays open when the input is not valid', () => {
    show({ kind: 'node', areaId: 'origin', parent: 'o_start' });
    submit();
    expect(err()).toBe(MSG.titleEmpty);
    type(/^名称/, '没有前置');
    type(/^完成条件/, '试试');
    fireEvent.click(parentBox('o_start'));
    submit();
    expect(err()).toBe(MSG.parentNone);
    fireEvent.click(parentBox('o_start'));
    type(/^累计目标/, '1');
    submit();
    expect(err()).toBe(MSG.target);
    expect(useUi.getState().modal).not.toBeNull();
  });
});

describe('NodeEditor: edit', () => {
  it('prefills the form and keeps XP and emeralds when they are not touched', () => {
    show({ kind: 'node', id: 'o_body', areaId: 'origin' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('编辑进度');
    expect(field(/^名称/).value).toBe('掉一格鸡腿');
    expect(checkedParents().sort()).toEqual(['o_sleep', 'o_water']);
    expect(advanced()).toEqual(['30', '2']);
    expect((dialog().querySelector('details.adv') as HTMLDetailsElement).open).toBe(true);
    type(/^名称/, '鸡腿掉了');
    submit();
    expect(node('o_body')).toMatchObject({ title: '鸡腿掉了', xp: 30, pts: 2, type: 'task', parents: ['o_sleep', 'o_water'] });
    expect(useUi.getState().modal).toBeNull();
    expect(useUi.getState().sel).toBe('o_body');
    expect(fx.toast).not.toHaveBeenCalled();
  });

  it('keeps a custom XP when the type changes', () => {
    show({ kind: 'node', id: 'o_body', areaId: 'origin' });
    pickType('挑战');
    // xp 30 is custom (task default is 40) and stays; emeralds were on the default and follow
    expect(advanced()).toEqual(['30', '15']);
    submit();
    expect(node('o_body')).toMatchObject({ type: 'challenge', xp: 30, pts: 15 });
  });

  it('keeps what a done achievement paid out when its type changes', () => {
    show({ kind: 'node', areaId: 'origin', parent: 'o_start' });
    type(/^名称/, '默认值');
    type(/^完成条件/, '经验没改过');
    submit();
    const id = useUi.getState().sel!;
    cleanup();
    act(() => { s().complete('o_start'); s().complete(id); });
    const before = totals(s().data);

    show({ kind: 'node', id, areaId: 'origin' });
    expect((dialog().querySelector('details.adv') as HTMLDetailsElement).open).toBe(false);
    expect(within(dialog()).getByText(/换类型不会改变它给过的经验和绿宝石/)).toBeTruthy();
    pickType('挑战');
    expect(advanced()).toEqual(['40', '2']);
    submit();
    expect(node(id)).toMatchObject({ type: 'challenge', xp: 40, pts: 2 });
    const after = totals(s().data);
    expect([after.xp, after.emeralds]).toEqual([before.xp, before.emeralds]);

    // typed values still count
    act(() => useUi.getState().openModal({ kind: 'node', id, areaId: 'origin' }));
    fireEvent.change(dialog().querySelectorAll('.adv input')[0], { target: { value: '300' } });
    submit();
    expect(node(id)?.xp).toBe(300);
  });

  it('disables prerequisites that would loop or leave no column before its followers', () => {
    show({ kind: 'node', id: 'o_body', areaId: 'origin' });
    // not offered as its own prerequisite
    expect(parentBox('o_body')).toBeNull();
    // o_offline and o_home come after o_body; o_mind sits in o_body's column, next to its follower o_offline
    for (const id of ['o_offline', 'o_home', 'o_tree', 'o_mind', 'o_cook', 'o_craft']) expect(parentBox(id).disabled).toBe(true);
    expect(parentBox('o_offline').closest('label')?.getAttribute('title')).toMatch(/绕成一个圈/);
    expect(parentBox('o_mind').closest('label')?.getAttribute('title')).toMatch(/挨得太近/);
    for (const id of ['o_start', 'o_sleep', 'o_water', 'o_tidy']) expect(parentBox(id).disabled).toBe(false);
    expect(screen.getByText(/灰色的进度/)).toBeTruthy();
    // allowed, but too far apart to fit: the store says so and the form stays open
    fireEvent.click(parentBox('o_tidy'));
    submit();
    expect(err()).toBe(MSG.noRoom);
    expect(useUi.getState().modal).not.toBeNull();
    fireEvent.click(parentBox('o_tidy'));
    fireEvent.click(parentBox('o_water'));
    submit();
    expect(node('o_body')?.parents).toEqual(['o_sleep']);
    expect(useUi.getState().modal).toBeNull();
  });

  it('offers achievements of other areas, grouped by area, as gateways of an area root', () => {
    show({ kind: 'node', id: 'b_warm_up', areaId: 'body' });
    expect(within(dialog()).getByText('通往这个领域的前置进度（可不选）')).toBeTruthy();
    const groups = [...dialog().querySelectorAll<HTMLDetailsElement>('details.pgrp')];
    expect(groups.map(g => g.querySelector('.pgn')?.textContent)).toEqual(['起源', '学识', '技艺', '财富', '羁绊', '远行']);
    expect(groups[0].open).toBe(true);
    expect(groups[0].querySelector('.pgc')?.textContent).toBe('已选 1 个');
    expect(groups[1].open).toBe(false);
    expect(checkedParents()).toEqual(['o_body']);
    // nothing of its own area
    expect(parentBox('b_first_5k')).toBeNull();
    // the gateway may be dropped: a root needs no prerequisite
    fireEvent.click(parentBox('o_body'));
    fireEvent.click(parentBox('m_bookshelf'));
    submit();
    expect(node('b_warm_up')?.parents).toEqual(['m_bookshelf']);
  });

  it('disables gateways that depend on the area itself', () => {
    show({ kind: 'node', id: 'o_start', areaId: 'origin' });
    // every body achievement comes after o_start (body is gated by o_body)
    expect(parentBox('b_warm_up').disabled).toBe(true);
    expect(parentBox('b_swim').disabled).toBe(true);
  });

  it('deletes with a second click, and not on the tail of a double-click', () => {
    show({ kind: 'node', id: 'o_tree', areaId: 'origin' });
    const del = () => within(dialog()).getByRole('button', { name: /删除这个进度|再点一次删除/ });
    fireEvent.click(del());
    expect(del().className).toBe('btn danger armed');
    expect(del().textContent).toBe('再点一次删除');
    clock += 100;
    fireEvent.click(del());
    expect(node('o_tree')).toBeDefined();
    clock += 600;
    fireEvent.click(del());
    expect(node('o_tree')).toBeUndefined();
    expect(useUi.getState().modal).toBeNull();
  });

  it('after a delete, gives focus to a prerequisite on the tree', async () => {
    const vp = fakeTree('o_home', 'o_start');
    show({ kind: 'node', id: 'o_tree', areaId: 'origin' });
    const del = () => within(dialog()).getByRole('button', { name: /删除这个进度|再点一次删除/ });
    fireEvent.click(del());
    clock += 600;
    fireEvent.click(del());
    expect(node('o_tree')).toBeUndefined();
    await frame();
    expect(document.activeElement).toBe(vp.querySelector('[data-id="o_home"]'));
    vp.remove();
  });

  it('answers a blocked delete on the first click with the store message', () => {
    show({ kind: 'node', id: 'o_home', areaId: 'origin' });
    const del = within(dialog()).getByRole('button', { name: '删除这个进度' });
    fireEvent.click(del);
    expect(del.className).toBe('btn danger');
    expect(dialog().querySelector('form .ferr')?.textContent).toBe(MSG.deleteDeps('「那棵树长大了」'));
    expect(node('o_home')).toBeDefined();
    cleanup();

    show({ kind: 'node', id: 'o_start', areaId: 'origin' });
    fireEvent.click(within(dialog()).getByRole('button', { name: '删除这个进度' }));
    expect(dialog().querySelector('form .ferr')?.textContent).toBe(MSG.deleteRoot);
    cleanup();

    act(() => { s().complete('o_start'); s().complete('o_tidy'); });
    show({ kind: 'node', id: 'o_tidy', areaId: 'origin' });
    fireEvent.click(within(dialog()).getByRole('button', { name: '删除这个进度' }));
    expect(dialog().querySelector('form .ferr')?.textContent).toBe(MSG.deleteDeps('「熔炉点火」「清点库存」'));
    cleanup();

    // a done achievement nothing depends on: undo first
    act(() => { s().complete('o_water'); s().complete('o_sleep'); s().complete('o_body'); s().complete('o_offline'); });
    act(() => { s().complete('o_cook'); s().complete('o_craft'); s().complete('o_home'); s().complete('o_tree'); });
    expect(s().data.done.o_tree).toBeDefined();
    show({ kind: 'node', id: 'o_tree', areaId: 'origin' });
    fireEvent.click(within(dialog()).getByRole('button', { name: '删除这个进度' }));
    expect(dialog().querySelector('form .ferr')?.textContent).toBe(MSG.deleteDone);
    expect(node('o_tree')).toBeDefined();
  });

  it('says so when the achievement is gone', () => {
    show({ kind: 'node', id: 'nope', areaId: 'origin' });
    expect(within(dialog()).getByText('找不到这个进度，刷新后再试。')).toBeTruthy();
  });
});
