// The hover tooltip for tree nodes (desktop, fine pointer only). The viewport's pointer code calls
// showTip / hideTip; <Tooltip/> renders into <body> and positions itself beside the node.

import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { icon, QMARK } from '../../art/pixel';
import { byId, displayTitle, statusOf, TYPE_NAME } from '../../domain/rules';
import { useStore } from '../../store/store';

let anchor: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit(next: HTMLElement | null): void {
  if (anchor === next) return;
  anchor = next;
  listeners.forEach(l => l());
}

/** Show the tooltip for a node button (its data-id names the achievement). */
export function showTip(el: HTMLElement): void {
  emit(el);
}

export function hideTip(): void {
  emit(null);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const get = () => anchor;

/** Beside the node: right of it, or left when there is no room; never off screen. */
export function tipPosition(r: { left: number; right: number; top: number }, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  let x = r.right + 10, y = r.top - 2;
  if (x + w > vw - 8) x = r.left - w - 10;
  if (y + h > vh - 8) y = vh - h - 8;
  return { left: Math.max(8, Math.round(x)), top: Math.max(8, Math.round(y)) };
}

export function Tooltip() {
  const el = useSyncExternalStore(subscribe, get, () => null);
  const data = useStore(s => s.data);
  const ref = useRef<HTMLDivElement>(null);
  const id = el?.dataset.id;
  const n = id ? byId(data).get(id) : undefined;

  useLayoutEffect(() => {
    const tt = ref.current;
    if (!tt || !el) return;
    const p = tipPosition(el.getBoundingClientRect(), tt.offsetWidth, tt.offsetHeight, window.innerWidth, window.innerHeight);
    tt.style.left = `${p.left}px`;
    tt.style.top = `${p.top}px`;
  });

  if (!el || !n || !el.isConnected) return null;
  const st = statusOf(data, n.id);
  const myst = !!n.hidden && st === 'locked';
  const stTxt = st === 'done'
    ? `已达成 · ${data.done[n.id]?.date ?? ''}`
    : st === 'open'
      ? (n.target ? `进行中 ${data.progress[n.id] ?? 0}/${n.target}${n.unit ? ` ${n.unit}` : ''}` : '可以开始')
      : '未解锁';

  return createPortal(
    <div className={st === 'done' ? 'tt small done' : 'tt small'} ref={ref} role="tooltip">
      <div className="tt-h">
        <img src={myst ? QMARK : icon(n.icon)} alt="" />
        <span>{displayTitle(data, n)}</span>
      </div>
      <div className={n.type === 'challenge' ? 'tt-d ch' : 'tt-d'}>
        {myst ? '隐藏进度：完成前置后揭晓' : n.desc}
        <div className="tt-m">{TYPE_NAME[n.type]} · {stTxt} · +{myst ? '???' : n.xp} 经验</div>
      </div>
    </div>,
    document.body,
  );
}
