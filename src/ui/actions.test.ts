import { beforeEach, describe, expect, it } from 'vitest';
import { statusOf } from '../domain/rules';
import { useStore } from '../store/store';
import { bumpWithFx, completeWithFx, onCompleted } from './actions';
import { clearToasts, getToasts } from './fx/toastQueue';

const rootOfCurrent = () => {
  const s = useStore.getState();
  return s.data.achievements.find(n => n.areaId === s.areaId && n.x === 0)!;
};

describe('completeWithFx', () => {
  beforeEach(() => {
    useStore.getState().start('starter');
    clearToasts();
  });

  it('completes, toasts the type line and the level-up, and reports the result', () => {
    const root = rootOfCurrent();
    const seen: string[] = [];
    const off = onCompleted(r => seen.push(r.id));
    const r = completeWithFx(root.id);
    off();
    expect(r?.id).toBe(root.id);
    expect(seen).toEqual([root.id]);
    const lines = getToasts().items.map(t => t.l1);
    expect(lines[0]).toMatch(/已达成|已完成/);
    if (r && r.levelAfter > r.levelBefore) expect(lines).toContain('等级提升！');
  });

  it('returns null and stays quiet for a locked achievement', () => {
    const s = useStore.getState();
    const locked = s.data.achievements.find(n => n.parents.length > 0 && n.areaId === s.areaId)!;
    expect(completeWithFx(locked.id)).toBeNull();
    expect(getToasts().items).toEqual([]);
  });

  it('bumps a counter with a click and completes it on the last step', () => {
    // complete open plain nodes until some counter opens up
    const openCounter = () => {
      const d = useStore.getState().data;
      return d.achievements.find(n => n.target && statusOf(d, n.id) === 'open');
    };
    for (let i = 0; i < 40 && !openCounter(); i++) {
      const d = useStore.getState().data;
      const next = d.achievements.find(n => !n.target && statusOf(d, n.id) === 'open');
      if (!next) break;
      completeWithFx(next.id);
    }
    const counter = openCounter();
    expect(counter).toBeDefined();
    clearToasts();
    expect(bumpWithFx(counter!.id, 1)).toBeNull();
    expect(useStore.getState().data.progress[counter!.id]).toBe(1);
    expect(getToasts().items).toEqual([]);
    for (let i = 1; i < counter!.target! - 1; i++) bumpWithFx(counter!.id, 1);
    const r = bumpWithFx(counter!.id, 1);
    expect(r?.id).toBe(counter!.id);
    expect(getToasts().items[0]?.l2).toBe(counter!.title);
  });
});
