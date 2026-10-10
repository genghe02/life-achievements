import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

afterEach(cleanup);

/** An opener button that shows the modal, like the app's HUD and panel buttons. */
function Harness({ onClose, autofocus = true, details = false }: { onClose?: () => void; autofocus?: boolean; details?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => { onClose?.(); setOpen(false); };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开</button>
      {open && (
        <Modal title="测试" onClose={close} footer={<button type="button">保存</button>}>
          <input aria-label="名称" data-autofocus={autofocus ? '' : undefined} />
          {details && (
            <details>
              <summary>高级</summary>
              <input aria-label="藏起来的" />
            </details>
          )}
          <input type="checkbox" aria-label="勾选" />
        </Modal>
      )}
    </>
  );
}

const openIt = () => {
  const opener = screen.getByRole('button', { name: '打开' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
};
const key = (k: string, opts: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key: k, ...opts });

describe('Modal', () => {
  it('renders the dialog shell with a labelled heading and the sticky footer', () => {
    render(<Harness />);
    openIt();
    const dlg = screen.getByRole('dialog');
    expect(dlg.className).toBe('mbox mcp');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const h = dlg.querySelector('.mhead h2') as HTMLElement;
    expect(h.textContent).toBe('测试');
    expect(dlg.getAttribute('aria-labelledby')).toBe(h.id);
    expect(dlg.parentElement?.className).toBe('modal');
    expect(dlg.querySelector('.mscroll > .dact')?.textContent).toBe('保存');
  });

  it('focuses the [data-autofocus] field, or else the close button', () => {
    render(<Harness />);
    openIt();
    expect(document.activeElement).toBe(screen.getByLabelText('名称'));
    cleanup();
    render(<Harness autofocus={false} />);
    openIt();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }));
  });

  it('closes on Esc, but a first Esc inside a text field only leaves the field', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    openIt();
    expect(document.activeElement).toBe(screen.getByLabelText('名称'));
    // Esc during a pinyin composition belongs to the IME
    key('Escape', { isComposing: true });
    expect(document.activeElement).toBe(screen.getByLabelText('名称'));
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps Tab inside the dialog in both directions', () => {
    render(<Harness autofocus={false} details />);
    openIt();
    const close = screen.getByRole('button', { name: '关闭' });
    const save = screen.getByRole('button', { name: '保存' });
    expect(document.activeElement).toBe(close);
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(save);
    key('Tab');
    expect(document.activeElement).toBe(close);
    // focus that escaped the dialog is pulled back in
    screen.getByRole('button', { name: '打开' }).focus();
    key('Tab');
    expect(document.activeElement).toBe(close);
  });

  it('skips fields inside a closed <details> when finding the ends', () => {
    function Tail() {
      return (
        <Modal title="尾巴" onClose={() => {}}>
          <input aria-label="第一个" data-autofocus="" />
          <details>
            <summary>高级</summary>
            <input aria-label="藏起来的" />
          </details>
        </Modal>
      );
    }
    render(<Tail />);
    const summary = screen.getByText('高级');
    summary.focus();
    key('Tab');
    // the summary is the last tabbable stop while the fold is closed
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }));
  });

  it('gives focus back to the opener when it closes', () => {
    render(<Harness />);
    const opener = openIt();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on a backdrop click only when the press started and ended on the backdrop', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    openIt();
    const backdrop = document.querySelector('.modal') as HTMLElement;
    const field = screen.getByLabelText('名称');
    // pressed inside (selecting text), released outside: the click lands on the backdrop
    fireEvent.pointerDown(field);
    fireEvent.pointerUp(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    // pressed on the backdrop, released inside the box
    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(field);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    act(() => { fireEvent.click(backdrop); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
