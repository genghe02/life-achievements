import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetPwaForTests, setUpdateSWForTests, usePwa } from '../pwa';
import { UpdateBar } from './UpdateBar';

afterEach(() => {
  cleanup();
  resetPwaForTests();
  vi.useRealTimers();
});

describe('UpdateBar', () => {
  it('stays hidden until a new version waits, and × hides it again', () => {
    render(<UpdateBar />);
    expect(document.querySelector('.updbar')).toBeNull();
    act(() => usePwa.setState({ needRefresh: true }));
    const bar = document.querySelector('.updbar');
    expect(bar?.textContent).toContain('有新版本');
    expect(bar?.textContent).toContain('点「更新」就能用上。');
    // no space inside the Chinese text
    expect(bar?.querySelector('.ut')?.textContent).toBe('有新版本点「更新」就能用上。');
    fireEvent.click(screen.getByRole('button', { name: '先不更新' }));
    expect(document.querySelector('.updbar')).toBeNull();
    expect(usePwa.getState().needRefresh).toBe(false);
  });

  it('× hands keyboard focus back to where it came from, not to <body>', () => {
    render(<><button type="button">之前</button><button type="button" id="btnMenu">菜单</button><UpdateBar /></>);
    act(() => usePwa.setState({ needRefresh: true }));
    const before = screen.getByRole('button', { name: '之前' });
    before.focus();
    const x = screen.getByRole('button', { name: '先不更新' });
    x.focus();
    expect(document.activeElement).toBe(x);
    fireEvent.click(x);
    expect(document.querySelector('.updbar')).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('× falls back to the menu button when focus came from nowhere', () => {
    render(<><button type="button" id="btnMenu">菜单</button><UpdateBar /></>);
    act(() => usePwa.setState({ needRefresh: true }));
    const x = screen.getByRole('button', { name: '先不更新' });
    x.focus();
    fireEvent.click(x);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '菜单' }));
  });

  it('× leaves focus alone when it was not in the bar (a mouse or touch press)', () => {
    render(<><input aria-label="笔记" /><button type="button" id="btnMenu">菜单</button><UpdateBar /></>);
    act(() => usePwa.setState({ needRefresh: true }));
    const note = screen.getByRole('textbox', { name: '笔记' });
    note.focus();
    fireEvent.click(screen.getByRole('button', { name: '先不更新' }));
    expect(document.activeElement).toBe(note);
  });

  it('announces itself through a live region that exists before the text arrives', () => {
    render(<UpdateBar />);
    const live = screen.getByRole('status');
    expect(live.textContent).toBe('');
    act(() => usePwa.setState({ needRefresh: true }));
    expect(screen.getByRole('status')).toBe(live);
    expect(live.textContent).toBe('有新版本，点「更新」就能用上。');
    expect(screen.getByRole('group', { name: '有新版本' })).toBeTruthy();
  });

  it('更新 activates the waiting version once', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const update = vi.fn(async () => {});
    setUpdateSWForTests(update);
    act(() => usePwa.setState({ needRefresh: true }));
    render(<UpdateBar />);
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(update).toHaveBeenCalledWith(true);
    const busy = screen.getByRole('button', { name: '正在更新…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
