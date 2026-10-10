import { useSyncExternalStore } from 'react';

// WindowHead hands its #zoomSlot element over through a ref callback, so the tree always portals
// into the slot that is on screen, even if the head remounts.

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** Ref callback for the slot element (WindowHead's `<div id="zoomSlot">`). */
export function setZoomSlot(el: HTMLElement | null): void {
  if (slot === el) return;
  slot = el;
  listeners.forEach(l => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const get = () => slot;

/**
 * The #zoomSlot element in the window head, where the tree portals its zoom controls on desktop.
 * Null until the head has mounted, then the element.
 */
export function useZoomSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, get, () => null);
}
