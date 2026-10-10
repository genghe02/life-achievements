// Minecraft queues its toasts: at most 3 on screen (1 on phones), the rest wait their turn.
// The queue lives outside React so effects code can call toast() from anywhere; <Toasts/> renders it.

import type { CSSProperties } from 'react';
import type { NodeType } from '../../domain/types';
import { isPhone, isSideways } from '../hooks/media';

/** Toast kinds; the kind is the class suffix k-<kind> (challenge is pink, level is green). */
export type ToastKind = NodeType | 'level' | 'tab' | 'trade' | 'info' | 'error';

export interface ToastInput {
  /** Image URL for the slot (an icon() data URL). */
  icon: string;
  kind: ToastKind;
  /** First line, coloured by kind, e.g. 「目标已达成！」. */
  l1: string;
  /** Second line, white, cut to one line. */
  l2: string;
}

export interface ToastItem extends ToastInput {
  id: number;
  /** Sliding out; removed shortly after. */
  out: boolean;
}

/**
 * The visible part of the tree in viewport coordinates: the top edge, the right edge and the width.
 * Toasts sit 10px inside its top-right corner, clear of the HUD, the tabs and the detail panel.
 */
export interface ToastArea {
  top: number;
  right: number;
  width: number;
}

export interface ToastSnapshot {
  items: readonly ToastItem[];
  /** Container position from the last pump; null (no tree on screen) keeps the stylesheet default. */
  pos: CSSProperties | null;
}

export const TOAST_LIFE = { desktop: 4200, phone: 2600 } as const;
const OUT_MS = 400;

let snap: ToastSnapshot = { items: [], pos: null };
const listeners = new Set<() => void>();
const queue: ToastInput[] = [];
let seq = 0;
let area: (() => ToastArea | null) | null = null;

function emit(next: ToastSnapshot): void {
  snap = next;
  listeners.forEach(l => l());
}

export function subscribeToasts(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getToasts(): ToastSnapshot {
  return snap;
}

/**
 * The tree registers a function returning its visible box (see ToastArea). Returns an unregister
 * function; passing null clears it.
 */
export function setToastArea(fn: (() => ToastArea | null) | null): () => void {
  area = fn;
  return () => { if (area === fn) area = null; };
}

/**
 * Used until the tree registers its own box: the tree viewport, minus the detail sheet when it is
 * docked on the right of a sideways phone.
 */
function viewportArea(): ToastArea | null {
  if (typeof document === 'undefined') return null;
  const vp = document.querySelector('.vp')?.getBoundingClientRect();
  if (!vp || !(vp.width > 0)) return null;
  let right = vp.right;
  const sheet = isSideways() ? document.querySelector('.detail.open')?.getBoundingClientRect() : undefined;
  if (sheet && sheet.width > 0) right = Math.max(vp.left + 160, Math.min(right, sheet.left - 8));
  return { top: vp.top, right, width: right - vp.left };
}

function position(): CSSProperties | null {
  const a = area?.() ?? viewportArea();
  if (!a || !(a.width > 0) || typeof window === 'undefined') return null;
  return {
    right: Math.round(window.innerWidth - a.right + 10),
    top: Math.round(a.top + 10),
    width: Math.round(Math.max(200, Math.min(320, a.width - 20))),
  };
}

function pump(): void {
  const max = isPhone() ? 1 : 3;
  while (queue.length && snap.items.filter(i => !i.out).length < max) {
    const item: ToastItem = { ...queue.shift()!, id: ++seq, out: false };
    emit({ items: [...snap.items, item], pos: position() ?? snap.pos });
    const life = isPhone() ? TOAST_LIFE.phone : TOAST_LIFE.desktop;
    setTimeout(() => {
      emit({ ...snap, items: snap.items.map(i => (i.id === item.id ? { ...i, out: true } : i)) });
      pump();
    }, life);
    setTimeout(() => emit({ ...snap, items: snap.items.filter(i => i.id !== item.id) }), life + OUT_MS);
  }
}

/**
 * Move the toasts on screen to the visible tree area as it is now. The detail panel calls this when
 * the phone sheet or sideways dock opens or closes, so a toast shown before stays clear of it.
 */
export function repositionToasts(): void {
  if (!snap.items.length) return;
  const pos = position();
  if (pos) emit({ ...snap, pos });
}

/** Queue a toast. */
export function toast(t: ToastInput): void {
  queue.push(t);
  pump();
}

/** Drop everything (tests, data reset). */
export function clearToasts(): void {
  queue.length = 0;
  emit({ items: [], pos: null });
}
