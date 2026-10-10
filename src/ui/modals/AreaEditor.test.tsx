import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodesOfArea } from '../../domain/rules';
import { MSG, useStore } from '../../store/store';
import { useUi, type ModalState } from '../uiStore';
import { ModalHost } from './ModalHost';

const s = () => useStore.getState();
let clock = 0;

beforeEach(() => {
  act(() => s().start('starter'));
  useUi.setState({ sel: null, overview: false, modal: null, arrange: false, centerReq: null });
  clock = 1e6;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const show = (m: Exclude<ModalState, null>) => {
  render(<ModalHost />);
  act(() => useUi.getState().openModal(m));
};
const dialog = () => screen.getByRole('dialog');
const field = (label: RegExp) => within(dialog()).getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
const button = (name: string | RegExp) => within(dialog()).getByRole('button', { name }) as HTMLButtonElement;
const names = () => s().data.areas.map(a => a.name);

describe('AreaEditor', () => {
  it('creates an area with a root and switches to it', () => {
    act(() => useUi.getState().select('o_start'));
    show({ kind: 'area' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('新建领域');
    expect(document.activeElement).toBe(field(/^名称/));
    expect(field(/^名称/).maxLength).toBe(6);
    expect(screen.queryByRole('button', { name: /删除这个领域/ })).toBeNull();
    fireEvent.click(button('创建领域'));
    expect(dialog().querySelector('.dact .ferr')?.textContent).toBe(MSG.areaEmpty);

    type(/^名称/, '音乐');
    type(/^副标题/, '学会一样乐器');
    fireEvent.click(within(dialog()).getByLabelText('唱片'));
    fireEvent.click(within(dialog()).getByText('木板').closest('label')!.querySelector('input')!);
    // the background chips preview the texture
    expect(dialog().querySelector('.seg .swatch')?.getAttribute('style')).toMatch(/background-image: url\(/);
    fireEvent.click(button('创建领域'));

    const a = s().data.areas.at(-1)!;
    expect(a).toMatchObject({ name: '音乐', subtitle: '学会一样乐器', icon: 'music_disc', bg: 'planks' });
    expect(s().areaId).toBe(a.id);
    expect(nodesOfArea(s().data, a.id).map(n => n.title)).toEqual(['新的开始']);
    expect(useUi.getState().modal).toBeNull();
    expect(useUi.getState().sel).toBeNull();
  });

  it('edits name, subtitle, icon and background', () => {
    show({ kind: 'area', id: 'body' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('领域设置');
    expect(field(/^名称/).value).toBe('体魄');
    type(/^名称/, '身体');
    fireEvent.click(within(dialog()).getByText('圆石').closest('label')!.querySelector('input')!);
    fireEvent.click(button('保存'));
    expect(s().data.areas.find(a => a.id === 'body')).toMatchObject({ name: '身体', bg: 'cobblestone' });
    expect(useUi.getState().modal).toBeNull();
    expect(s().areaId).toBe('origin');
  });

  it('moves the tab left and right', () => {
    show({ kind: 'area', id: 'body' });
    expect(within(dialog()).getByText(/第 2 个/).textContent).toBe('第 2 个，共 7 个');
    fireEvent.click(button('← 左移'));
    expect(names().slice(0, 2)).toEqual(['体魄', '起源']);
    expect(button('← 左移').disabled).toBe(true);
    fireEvent.click(button('右移 →'));
    fireEvent.click(button('右移 →'));
    expect(names().slice(0, 3)).toEqual(['起源', '学识', '体魄']);
    expect(useUi.getState().modal).not.toBeNull();
    cleanup();
    show({ kind: 'area', id: 'road' });
    expect(button('右移 →').disabled).toBe(true);
  });

  it('deletes an area on a second click, saying how many achievements go with it', () => {
    const count = nodesOfArea(s().data, 'road').length;
    act(() => s().setArea('road'));
    show({ kind: 'area', id: 'road' });
    expect(within(dialog()).getByText(/删除后/).textContent).toBe(`删除后，这个领域的 ${count} 个进度和完成记录都会一起删掉。`);
    const del = () => button(/删除这个领域|再点一次删除/);
    fireEvent.click(del());
    expect(del().className).toBe('btn danger armed');
    expect(del().textContent).toBe(`再点一次删除（${count} 个进度会删掉）`);
    clock += 100;
    fireEvent.click(del());
    expect(names()).toContain('远行');
    clock += 600;
    fireEvent.click(del());
    expect(names()).not.toContain('远行');
    expect(nodesOfArea(s().data, 'road')).toHaveLength(0);
    expect(useUi.getState().modal).toBeNull();
    expect(s().areaId).toBe('origin');
  });

  it('blocks deleting the last area on the first click', () => {
    act(() => useStore.setState(st => ({ data: { ...st.data, areas: st.data.areas.filter(a => a.id === 'origin') } })));
    show({ kind: 'area', id: 'origin' });
    expect(button('← 左移').disabled).toBe(true);
    expect(button('右移 →').disabled).toBe(true);
    fireEvent.click(button('删除这个领域'));
    expect(button('删除这个领域').className).toBe('btn danger');
    expect(dialog().querySelector('form .ferr')?.textContent).toBe(MSG.lastArea);
    expect(names()).toEqual(['起源']);
  });
});
