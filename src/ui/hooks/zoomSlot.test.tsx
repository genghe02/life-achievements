import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setZoomSlot, useZoomSlot } from './zoomSlot';

afterEach(cleanup);

describe('useZoomSlot', () => {
  it('follows the slot element the window head hands over', () => {
    const hook = renderHook(() => useZoomSlot());
    expect(hook.result.current).toBeNull();
    const head = render(<div id="zoomSlot" ref={setZoomSlot} />);
    expect(hook.result.current?.id).toBe('zoomSlot');
    const first = hook.result.current;
    // a remounted head hands over its new element
    act(() => head.unmount());
    expect(hook.result.current).toBeNull();
    render(<div id="zoomSlot" ref={setZoomSlot} />);
    expect(hook.result.current).not.toBeNull();
    expect(hook.result.current).not.toBe(first);
  });
});
