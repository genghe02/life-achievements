import { useRef, type FocusEvent } from 'react';
import { applyUpdate, dismissUpdate, usePwa } from '../pwa';

export const UPDATE_TITLE = '有新版本';
/** A plain browser refresh keeps the old version (it waits until every tab closes), so point at 「更新」. */
export const UPDATE_HINT = '点「更新」就能用上。';

/** Where focus goes when × hides the bar and focus came from nowhere useful: ≡, or a start choice. */
const FALLBACK_FOCUS = '#btnMenu, .onb-choice';

/** 「有新版本」 bar, shown while a new version waits (see pwa.ts). */
export function UpdateBar() {
  const show = usePwa(s => s.needRefresh);
  const updating = usePwa(s => s.updating);
  const barRef = useRef<HTMLDivElement>(null);
  // the element focus came from when it entered the bar, so × can hand it back instead of to <body>
  const cameFrom = useRef<HTMLElement | null>(null);

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const from = e.relatedTarget;
    if (from instanceof HTMLElement && !e.currentTarget.contains(from)) cameFrom.current = from;
  };

  const dismiss = () => {
    const bar = barRef.current;
    const hadFocus = !!bar && bar.contains(document.activeElement);
    dismissUpdate();
    if (!hadFocus) return;
    const back = cameFrom.current;
    const target = back && back.isConnected && back !== document.body ? back : document.querySelector<HTMLElement>(FALLBACK_FOCUS);
    target?.focus({ preventScroll: true });
  };

  return (
    <>
      {/* the live region stays mounted so screen readers announce the bar when it appears */}
      <p className="sr-only" role="status">{show ? `${UPDATE_TITLE}，${UPDATE_HINT}` : ''}</p>
      {show && (
        <div ref={barRef} className="updbar" role="group" aria-label={UPDATE_TITLE} onFocus={onFocus}>
          <span className="ut" aria-hidden="true">
            <b>{UPDATE_TITLE}</b>
            <span className="ul2">{UPDATE_HINT}</span>
          </span>
          <button className="btn sm go" type="button" disabled={updating} onClick={applyUpdate}>
            {updating ? '正在更新…' : '更新'}
          </button>
          <button className="btn sm sq" type="button" aria-label="先不更新" title="先不更新" onClick={dismiss}>×</button>
        </div>
      )}
    </>
  );
}
