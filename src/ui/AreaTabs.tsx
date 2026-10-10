import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { icon, LOCK } from '../art/pixel';
import { SFX } from '../art/sfx';
import { areaLocked, isDone, nodesOfArea } from '../domain/rules';
import { useStore } from '../store/store';
import { useUi } from './uiStore';

/** The area tabs clipped onto the window, plus the final 「+」 tab that creates an area. */
export function AreaTabs() {
  const data = useStore(s => s.data);
  const areaId = useStore(s => s.areaId);
  const cur = data.areas.some(a => a.id === areaId) ? areaId : data.areas[0]?.id;
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const navRef = useRef<HTMLElement>(null);

  const tabs = useMemo(() => data.areas.map(a => {
    const ns = nodesOfArea(data, a.id);
    return { area: a, done: ns.filter(n => isDone(data, n.id)).length, all: ns.length, locked: areaLocked(data, a.id) };
  }), [data]);

  useEffect(() => {
    if (cur) refs.current.get(cur)?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [cur]);

  // The row has no visible scrollbar: a plain mouse wheel over it scrolls it sideways when it
  // overflows (trackpads and shift+wheel already scroll it). Not passive, to keep the page still.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = nav.scrollWidth - nav.clientWidth;
      if (max <= 0) return;
      const step = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? nav.clientWidth : 1;
      const next = Math.max(0, Math.min(max, nav.scrollLeft + e.deltaY * step));
      if (next === nav.scrollLeft) return;
      e.preventDefault();
      nav.scrollLeft = next;
    };
    nav.addEventListener('wheel', onWheel, { passive: false });
    return () => nav.removeEventListener('wheel', onWheel);
  }, []);

  const go = (id: string, focus = false) => {
    SFX.click();
    if (id !== useStore.getState().areaId) {
      useStore.getState().setArea(id);
      useUi.getState().select(null);
    }
    if (focus) refs.current.get(id)?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const ids = data.areas.map(a => a.id);
    const i = ids.indexOf(cur ?? '');
    let j: number;
    if (e.key === 'ArrowRight') j = (i + 1) % ids.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = ids.length - 1;
    else return;
    e.preventDefault();
    go(ids[j], true);
  };

  const addArea = () => {
    SFX.click();
    useUi.getState().openModal({ kind: 'area' });
  };

  return (
    <nav ref={navRef} className="tabs" aria-label="人生领域">
      <div className="tablist" role="tablist" aria-label="人生领域" onKeyDown={onKey}>
        {tabs.map(({ area, done, all, locked }) => {
          const selected = area.id === cur;
          return (
            <button
              key={area.id}
              ref={el => { if (el) refs.current.set(area.id, el); else refs.current.delete(area.id); }}
              className="tab mcp"
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              aria-label={`${area.name}，${locked ? '未解锁' : `已达成 ${done}/${all}`}`}
              title={locked ? `${area.name}（未解锁）` : area.name}
              data-area={area.id}
              onClick={() => go(area.id)}
            >
              <img src={icon(area.icon)} alt="" />
              {locked && <img className="tlk" src={LOCK} alt="" />}
              <span className="tn">{area.name}</span>
              <span className="tc small num">{locked ? '未解锁' : `${done}/${all}`}</span>
            </button>
          );
        })}
      </div>
      <button className="tab mcp tab-add" type="button" aria-label="新建领域" title="新建领域" onClick={addArea}>
        <span className="tplus" aria-hidden="true">+</span>
      </button>
    </nav>
  );
}
