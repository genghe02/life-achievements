import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, getToasts, setToastArea, toast, TOAST_LIFE } from './toastQueue';

const t = (l2: string) => ({ icon: 'x.png', kind: 'task' as const, l1: '进度已达成！', l2 });

describe('toast queue', () => {
  beforeEach(() => { vi.useFakeTimers(); clearToasts(); });
  afterEach(() => { vi.useRealTimers(); setToastArea(null); });

  it('shows at most 3 on desktop and queues the rest', () => {
    for (let i = 0; i < 5; i++) toast(t(`n${i}`));
    expect(getToasts().items.map(i => i.l2)).toEqual(['n0', 'n1', 'n2']);
    vi.advanceTimersByTime(TOAST_LIFE.desktop);
    // the first three slide out, the next two come in
    const items = getToasts().items;
    expect(items.filter(i => i.out).map(i => i.l2)).toEqual(['n0', 'n1', 'n2']);
    expect(items.filter(i => !i.out).map(i => i.l2)).toEqual(['n3', 'n4']);
    vi.advanceTimersByTime(400);
    expect(getToasts().items.map(i => i.l2)).toEqual(['n3', 'n4']);
    vi.advanceTimersByTime(TOAST_LIFE.desktop + 400);
    expect(getToasts().items).toEqual([]);
  });

  it('positions the stack inside the registered tree area', () => {
    const off = setToastArea(() => ({ top: 100, right: window.innerWidth - 50, width: 600 }));
    toast(t('a'));
    expect(getToasts().pos).toEqual({ top: 110, right: 60, width: 320 });
    off();
    clearToasts();
    toast(t('b'));
    expect(getToasts().pos).toBeNull();
  });

  it('falls back to the tree viewport until the tree registers its area', () => {
    const vp = document.createElement('div');
    vp.className = 'vp';
    vp.getBoundingClientRect = () => ({ left: 28, top: 146, right: 986, bottom: 748, width: 958, height: 602, x: 28, y: 146, toJSON: () => ({}) });
    document.body.append(vp);
    try {
      toast(t('a'));
      expect(getToasts().pos).toEqual({ top: 156, right: window.innerWidth - 986 + 10, width: 320 });
    } finally {
      vp.remove();
    }
  });

  it('keeps toasts at least 200px wide in a narrow area', () => {
    setToastArea(() => ({ top: 0, right: 300, width: 150 }));
    toast(t('a'));
    expect(getToasts().pos?.width).toBe(200);
  });
});
