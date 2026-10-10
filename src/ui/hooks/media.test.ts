import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isPhone, usePhone, useSideways } from './media';

describe('media hooks', () => {
  it('read as false where matchMedia is missing', () => {
    expect(isPhone()).toBe(false);
    expect(renderHook(() => usePhone()).result.current).toBe(false);
    expect(renderHook(() => useSideways()).result.current).toBe(false);
  });
});
