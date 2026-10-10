// Media-query hooks for the layout breakpoints, plus plain getters for imperative code.
// Without matchMedia (jsdom) every query reads as false, i.e. a desktop with a fine pointer off.

import { useSyncExternalStore } from 'react';

export const MEDIA = {
  /** ≤859px wide: bottom sheet, icon-only tabs. */
  phone: '(max-width: 859px)',
  /** Phone held sideways: the sheet docks on the right. */
  sideways: '(max-width: 859px) and (max-height: 500px)',
  /** Laptop with little height: compact chrome, row height 76. */
  shortDesktop: '(min-width: 860px) and (max-height: 780px)',
  /** Mouse or trackpad: tooltips on hover. */
  finePointer: '(hover: hover) and (pointer: fine)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
} as const;

type MediaKey = keyof typeof MEDIA;

const lists = new Map<string, MediaQueryList | null>();

function list(query: string): MediaQueryList | null {
  let m = lists.get(query);
  if (m === undefined) {
    m = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
    lists.set(query, m);
  }
  return m;
}

export function matches(query: string): boolean {
  return list(query)?.matches ?? false;
}

// One stable subscribe function per query, so useSyncExternalStore never resubscribes.
const subscribers = new Map<string, (cb: () => void) => () => void>();

function subscriber(query: string): (cb: () => void) => () => void {
  let s = subscribers.get(query);
  if (!s) {
    s = cb => {
      const m = list(query);
      if (!m) return () => {};
      if (typeof m.addEventListener === 'function') {
        m.addEventListener('change', cb);
        return () => m.removeEventListener('change', cb);
      }
      // Safari before 14
      m.addListener(cb);
      return () => m.removeListener(cb);
    };
    subscribers.set(query, s);
  }
  return s;
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(subscriber(query), () => matches(query), () => false);
}

export function usePhone(): boolean { return useMedia(MEDIA.phone); }
export function useSideways(): boolean { return useMedia(MEDIA.sideways); }
export function useShortDesktop(): boolean { return useMedia(MEDIA.shortDesktop); }
export function useFinePointer(): boolean { return useMedia(MEDIA.finePointer); }
export function useReducedMotion(): boolean { return useMedia(MEDIA.reducedMotion); }

const getter = (key: MediaKey) => () => matches(MEDIA[key]);

export const isPhone = getter('phone');
export const isSideways = getter('sideways');
export const isShortDesktop = getter('shortDesktop');
export const isFinePointer = getter('finePointer');
export const prefersReducedMotion = getter('reducedMotion');
