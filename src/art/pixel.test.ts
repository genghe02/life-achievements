import { describe, expect, it } from 'vitest';
import { frame, icon, ICON_NAMES, QMARK, texture } from './pixel';

describe('pixel art', () => {
  it('lists every icon from icons.json', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(54);
    expect(ICON_NAMES).toContain('emerald');
  });

  it('falls back to the question mark for unknown icons', () => {
    expect(icon('no_such_icon')).toBe(QMARK);
    expect(icon('constructor')).toBe(QMARK);
  });

  it('returns data URLs without a canvas (jsdom)', () => {
    for (const url of [icon('sapling'), frame('goal', 'done'), texture('dirt')]) expect(url).toMatch(/^data:image\//);
  });
});
