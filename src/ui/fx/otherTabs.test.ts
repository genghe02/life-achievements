import { afterEach, describe, expect, it, vi } from 'vitest';
import { starterData } from '../../domain/templates';
import { holdHud, hudNumbers } from './hudFx';
import { LOST_TOAST, watchOtherTabs } from './otherTabs';
import { clearToasts, getToasts } from './toastQueue';

const heard = vi.hoisted(() => ({ listeners: new Set<(lost: boolean) => void>() }));

vi.mock('../../store/store', () => ({
  onExternalData: (l: (lost: boolean) => void) => {
    heard.listeners.add(l);
    return () => heard.listeners.delete(l);
  },
}));

const otherTabSaved = (lost: boolean) => heard.listeners.forEach(l => l(lost));

afterEach(() => {
  clearToasts();
});

describe('data saved in another tab', () => {
  it('says so only when changes made here were not saved', () => {
    const stop = watchOtherTabs();
    otherTabSaved(false);
    expect(getToasts().items).toHaveLength(0);
    otherTabSaved(true);
    expect(getToasts().items).toMatchObject([{ kind: 'error', ...LOST_TOAST }]);
    stop();
    expect(heard.listeners.size).toBe(0);
  });

  it('lets the HUD show the new data at once', () => {
    const stop = watchOtherTabs();
    holdHud('o_start', 20, 1);
    otherTabSaved(false);
    // the orbs of a completion made here are still flying when the other tab's data arrives
    const data = { ...starterData(new Date(2026, 9, 10)), done: { o_start: { date: '2026-10-10' } } };
    expect(hudNumbers(data).xp).toBe(20);
    stop();
  });
});
