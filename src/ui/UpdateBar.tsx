import { applyUpdate, dismissUpdate, usePwa } from '../pwa';

export const UPDATE_TITLE = '有新版本';
/** A plain browser refresh keeps the old version (it waits until every tab closes), so point at 「更新」. */
export const UPDATE_HINT = '点「更新」就能用上。';

/** 「有新版本」 bar, shown while a new version waits (see pwa.ts). */
export function UpdateBar() {
  const show = usePwa(s => s.needRefresh);
  const updating = usePwa(s => s.updating);
  return (
    <>
      {/* the live region stays mounted so screen readers announce the bar when it appears */}
      <p className="sr-only" role="status">{show ? `${UPDATE_TITLE}，${UPDATE_HINT}` : ''}</p>
      {show && (
        <div className="updbar" role="group" aria-label={UPDATE_TITLE}>
          <span className="ut" aria-hidden="true">
            <b>{UPDATE_TITLE}</b>
            <span className="ul2">{UPDATE_HINT}</span>
          </span>
          <button className="btn sm go" type="button" disabled={updating} onClick={applyUpdate}>
            {updating ? '正在更新…' : '更新'}
          </button>
          <button className="btn sm sq" type="button" aria-label="先不更新" title="先不更新" onClick={dismissUpdate}>×</button>
        </div>
      )}
    </>
  );
}
