import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { byId } from '../../domain/rules';
import { useStore } from '../../store/store';
import { repositionToasts } from '../fx/toastQueue';
import { usePhone } from '../hooks/media';
import { useUi } from '../uiStore';
import { AreaOverview } from './AreaOverview';
import { NodeDetail } from './NodeDetail';
import { takeTitleFocus } from './nav';

/** What the panel shows: 'n:<achievement id>' or 'a:<area id>' (overview). */
type Shown = `n:${string}` | `a:${string}`;

const nodeOf = (k: Shown) => (k.startsWith('n:') ? k.slice(2) : null);

/**
 * The detail panel. Desktop: the right column, showing the selected achievement or else the
 * current area's overview. Phone: a bottom sheet (docked right when sideways) that is open while
 * something is selected or the overview was asked for.
 */
export function DetailPanel() {
  const sel = useUi(s => s.sel);
  const overview = useUi(s => s.overview);
  const phone = usePhone();
  const areaId = useStore(s => s.areaId);
  const selArea = useStore(s => (sel === null ? null : (byId(s.data).get(sel)?.areaId ?? null)));
  // The selection always belongs to the area on screen (callers switch area before selecting). One
  // whose achievement was deleted, or left behind by an area change that kept it (an area deleted, a
  // backup imported), is stale: show the overview and clear it, so the tree and the phone sheet agree.
  const selOk = sel !== null && selArea === areaId;
  useEffect(() => {
    if (sel !== null && !selOk) useUi.getState().select(null);
  }, [sel, selOk]);

  const live: Shown = selOk && sel !== null ? `n:${sel}` : `a:${areaId}`;
  const open = phone && (selOk || overview);

  // While the phone sheet slides away (and stays hidden) it keeps what it last showed, instead of
  // flashing the overview.
  const [kept, setKept] = useState<Shown>(live);
  if ((open || !phone) && kept !== live) setKept(live);
  const keptOk = useStore(s => {
    const id = nodeOf(kept);
    return id ? byId(s.data).has(id) : s.data.areas.some(a => a.id === kept.slice(2));
  });
  const shown: Shown = phone && !open && keptOk ? kept : live;

  // each opening of the sheet starts fresh (scrolled to the top, no old message), like a new selection
  const [sheet, setSheet] = useState({ open, n: 0 });
  if (sheet.open !== open) setSheet({ open, n: open ? sheet.n + 1 : sheet.n });
  const key = `${shown}#${sheet.n}`;

  const asideRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    box.scrollTop = 0;
    if (takeTitleFocus(nodeOf(shown))) box.querySelector<HTMLElement>('.dh h2')?.focus({ preventScroll: true });
  }, [key, shown]);

  // toasts already showing keep clear of the sheet or dock that just opened (and move back after)
  useLayoutEffect(() => {
    if (phone) repositionToasts();
  }, [open, phone]);

  // The sheet closed while focus was inside it: hand focus back to the achievement on the tree (or
  // the 概览 button), else to the tree itself. Not when it "closed" by turning into the desktop column.
  const wasOpen = useRef(open);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (!was || open || !phone) return;
    const a = document.activeElement;
    if (!(a instanceof HTMLElement) || !asideRef.current?.contains(a)) return;
    const id = nodeOf(kept);
    const back = id
      ? document.querySelector<HTMLElement>(`.node[data-id="${id.replace(/["\\]/g, '\\$&')}"]`)
      : document.querySelector<HTMLElement>('.whead .btn-info');
    for (const el of [back, document.getElementById('vp')]) {
      el?.focus({ preventScroll: true });
      if (document.activeElement !== a) return;
    }
    a.blur();
  }, [open, kept, phone]);

  const node = nodeOf(shown);
  return (
    <aside ref={asideRef} id="detail" className={open ? 'detail mcp open' : 'detail mcp'} aria-live="polite" aria-label={node ? '进度详情' : '领域概览'}>
      <div className="dscroll" ref={scrollRef}>
        {node ? <NodeDetail key={key} id={node} /> : <AreaOverview key={key} areaId={shown.slice(2)} />}
      </div>
    </aside>
  );
}
