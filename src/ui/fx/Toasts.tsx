import { useSyncExternalStore } from 'react';
import { getToasts, subscribeToasts } from './toastQueue';

/** Renders the toast queue (see toastQueue.ts). Mounted once by App. */
export function Toasts() {
  const { items, pos } = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  return (
    <div className="toasts" role="status" aria-live="polite" style={pos ?? undefined}>
      {items.map(t => (
        <div key={t.id} className={`toast k-${t.kind}${t.out ? ' out' : ''}`}>
          <span className="slot"><img src={t.icon} alt="" /></span>
          <span><b>{t.l1}</b><span className="l2">{t.l2}</span></span>
        </div>
      ))}
    </div>
  );
}
