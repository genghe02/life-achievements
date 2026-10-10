// The quest-tree viewport: the current area's nodes and connectors on its block background, with
// pan and zoom, the hover tooltip, the locked-area banner, the zoom controls and arrange mode.
// React renders the tree; the view transform is applied imperatively (see viewport.ts).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BG_DIM, texture } from '../../art/pixel';
import { SFX } from '../../art/sfx';
import { connectorSegments, geometry, GY, GY_SHORT } from '../../domain/layout';
import { areaLocked, displayTitle, statusOf } from '../../domain/rules';
import type { NodeStatus } from '../../domain/types';
import { useStore } from '../../store/store';
import { onCompleted } from '../actions';
import { setToastArea } from '../fx/toastQueue';
import { usePhone, useShortDesktop, useSideways } from '../hooks/media';
import { useZoomSlot } from '../hooks/zoomSlot';
import { useUi } from '../uiStore';
import { ArrangeHint } from './ArrangeHint';
import { Connectors } from './Connectors';
import { LockedBanner } from './LockedBanner';
import { bindPointer, type PointerBinding } from './pointer';
import { hideTip, showTip, Tooltip } from './Tooltip';
import { TreeNode } from './TreeNode';
import { Viewport, type TreeModel } from './viewport';
import { ZoomControls } from './ZoomControls';

const FRESH_MS = 1000;
/** More status changes than this at once is a data swap (import, restart), not progress: no flash. */
const FRESH_MAX = 12;

/** Ids that flash (.fresh) for a second: just done, just opened, just added. */
function useFresh(): [ReadonlySet<string>, (ids: readonly string[]) => void] {
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const add = useCallback((ids: readonly string[]) => {
    if (!ids.length) return;
    setFresh(prev => (ids.every(id => prev.has(id)) ? prev : new Set([...prev, ...ids])));
    const t = setTimeout(() => {
      timers.current.delete(t);
      setFresh(prev => {
        if (!ids.some(id => prev.has(id))) return prev;
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    }, FRESH_MS);
    timers.current.add(t);
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  return [fresh, add];
}

export function TreeView() {
  const data = useStore(s => s.data);
  const storeArea = useStore(s => s.areaId);
  const sel = useUi(s => s.sel);
  const overview = useUi(s => s.overview);
  const arrange = useUi(s => s.arrange);
  const centerReq = useUi(s => s.centerReq);
  const phone = usePhone();
  const sideways = useSideways();
  const short = useShortDesktop();
  const slot = useZoomSlot();

  const area = data.areas.find(a => a.id === storeArea) ?? data.areas[0];
  const aid = area?.id ?? '';
  const bg = area?.bg ?? 'dirt';
  const gy = short ? GY_SHORT : GY;
  const achievements = data.achievements;
  const created = data.createdAt;

  const nodes = useMemo(() => achievements.filter(n => n.areaId === aid), [achievements, aid]);
  const geo = useMemo(() => geometry(nodes, gy), [nodes, gy]);
  const status = useMemo(() => new Map<string, NodeStatus>(nodes.map(n => [n.id, statusOf(data, n.id)])), [data, nodes]);
  const segs = useMemo(() => connectorSegments(data, aid, geo), [data, aid, geo]);
  const model = useMemo<TreeModel>(() => ({
    areaId: aid,
    nodes,
    geo,
    status,
    gy,
    pos: new Map(geo.nodes.map(p => [p.n.id, p])),
    minY: nodes.length ? Math.min(...nodes.map(n => n.y)) : 0,
  }), [aid, nodes, geo, status, gy]);

  const [ctl] = useState(() => new Viewport());
  const vpRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const binding = useRef<PointerBinding | null>(null);
  const [msg, setMsg] = useState('');
  const [fresh, addFresh] = useFresh();

  // ---- keep the imperative viewport in step with the render (runs first, every commit) ----
  useLayoutEffect(() => {
    ctl.vp = vpRef.current;
    ctl.world = worldRef.current;
    ctl.model = model;
  });

  // ---- area switch, row height change, data swap, rows added above ----
  const prev = useRef({ aid: '', gy: 0, minY: 0, created: '' });
  useLayoutEffect(() => {
    const p = prev.current;
    prev.current = { aid, gy, minY: model.minY, created };
    // every pan and zoom remembers its area's view, so switching back finds it; an area never
    // moved opens at its home view, worked out afresh
    if (p.aid && (p.created !== created || p.gy !== gy || p.aid !== aid)) binding.current?.cancelDrag();
    if (p.aid && (p.created !== created || p.gy !== gy)) {
      ctl.views.clear();
      ctl.restore();
    } else if (p.aid !== aid) ctl.restore();
    else if (p.minY !== model.minY) {
      // a node moved above the top row (or the top row emptied): every cell shifted, the view follows
      ctl.stop();
      ctl.view = { ...ctl.view, y: ctl.view.y + (model.minY - p.minY) * gy * ctl.view.k };
      ctl.apply();
      ctl.save();
    }
  }, [ctl, aid, gy, model.minY, created]);

  const labels = data.settings.labels;
  useLayoutEffect(() => {
    worldRef.current?.classList.toggle('nolabels', !labels);
  }, [labels]);

  useLayoutEffect(() => {
    vpRef.current?.classList.toggle('arrange', arrange);
    binding.current?.cancelDrag();
    // a refused drop's message is about this area's tree
    setMsg('');
  }, [arrange, aid]);

  // ---- flash nodes that just became done or open ----
  useEffect(() => onCompleted(r => addFresh([r.id, ...r.unlockedNodes])), [addFresh]);
  const prevStatus = useRef<{ aid: string; created: string; st: ReadonlyMap<string, NodeStatus> } | null>(null);
  useLayoutEffect(() => {
    const p = prevStatus.current;
    prevStatus.current = { aid, created, st: status };
    if (!p || p.aid !== aid || p.created !== created || p.st === status) return;
    const ids: string[] = [];
    for (const [id, s] of status) {
      const was = p.st.get(id);
      if (was === undefined || (was !== s && s !== 'locked')) ids.push(id);
    }
    if (ids.length <= FRESH_MAX) addFresh(ids);
  }, [aid, created, status, addFresh]);

  // ---- pointer, wheel, focus; toast placement; resize ----
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const b = bindPointer(ctl, vp, {
      tapNode: id => {
        SFX.click();
        hideTip();
        useUi.getState().select(id);
      },
      tapEmpty: () => {
        const ui = useUi.getState();
        if (ui.sel || ui.overview) ui.select(null);
      },
      hover: el => (el ? showTip(el) : hideTip()),
      arrange: () => useUi.getState().arrange,
      target: () => targetRef.current,
      message: setMsg,
    });
    binding.current = b;
    return () => {
      b.dispose();
      binding.current = null;
    };
  }, [ctl]);

  useEffect(() => setToastArea(() => ctl.toastArea()), [ctl]);

  useEffect(() => {
    const onResize = () => {
      const id = useUi.getState().sel;
      const held = !!id && ctl.model.pos.has(id);
      ctl.reclamp(held);
      // a shorter screen must not leave the selection under the phone sheet
      if (held && ctl.sheetOpen()) ctl.reveal(id, 40, 40, 60);
    };
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    if (vpRef.current) ro?.observe(vpRef.current);
    return () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [ctl]);

  useEffect(() => () => {
    ctl.stop();
    hideTip();
  }, [ctl]);
  useEffect(() => hideTip(), [aid, arrange]);

  // ---- selection: on phones bring the node out from under the sheet (also when a resize makes
  // this a phone while something is selected) ----
  useEffect(() => {
    hideTip();
    if (!sel || !phone) return;
    const raf = requestAnimationFrame(() => ctl.reveal(sel, 40, 40, 60));
    return () => cancelAnimationFrame(raf);
  }, [ctl, sel, phone]);

  // focusNode() asks for a node in the middle of the visible area
  const [mountSeq] = useState(() => useUi.getState().centerReq?.seq ?? 0);
  useEffect(() => {
    if (!centerReq || centerReq.seq <= mountSeq) return;
    const raf = requestAnimationFrame(() => ctl.centerOn(centerReq.id));
    return () => cancelAnimationFrame(raf);
  }, [ctl, centerReq, mountSeq]);

  // the visible area just grew: ease the tree back if it now sits off-centre
  const sheet = phone && (!!sel || overview);
  const wasSheet = useRef(sheet);
  useEffect(() => {
    const was = wasSheet.current;
    wasSheet.current = sheet;
    if (!was || sheet) return;
    const raf = requestAnimationFrame(() => {
      const t = ctl.clamp();
      if (Math.abs(t.x - ctl.view.x) > 1 || Math.abs(t.y - ctl.view.y) > 1) ctl.animateTo(t);
    });
    return () => cancelAnimationFrame(raf);
  }, [ctl, sheet]);

  // turning the phone: the sheet moves between the bottom and the right, keep the selection in view
  const wasSideways = useRef(sideways);
  useEffect(() => {
    if (wasSideways.current === sideways) return;
    wasSideways.current = sideways;
    const id = useUi.getState().sel;
    if (!id) return;
    const raf = requestAnimationFrame(() => {
      if (ctl.sheetOpen()) ctl.centerOn(id);
    });
    return () => cancelAnimationFrame(raf);
  }, [ctl, sideways]);

  const dim = BG_DIM[bg];
  const locked = aid ? areaLocked(data, aid) : false;
  const controls = <ZoomControls ctl={ctl} />;

  return (
    <div
      className="vp"
      id="vp"
      ref={vpRef}
      tabIndex={-1}
      role="group"
      aria-label="进度树"
      style={{ backgroundImage: `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url(${texture(bg)})` }}
    >
      <div className="world" ref={worldRef} style={{ width: geo.width, height: geo.height }}>
        <Connectors segs={segs} width={geo.width} height={geo.height} />
        <div className="cell-target" ref={targetRef} hidden />
        <div id="nodes">
          {geo.nodes.map(({ n, cx, cy }) => (
            <TreeNode
              key={n.id}
              n={n}
              status={status.get(n.id) ?? 'locked'}
              title={displayTitle(data, n)}
              prog={data.progress[n.id] ?? 0}
              cx={cx}
              cy={cy}
              sel={n.id === sel}
              fresh={fresh.has(n.id)}
            />
          ))}
        </div>
      </div>
      {arrange ? <ArrangeHint msg={msg} /> : locked && <LockedBanner data={data} areaId={aid} />}
      {!phone && !short && <div className="vhint small">拖动平移 · Ctrl/Cmd + 滚轮缩放</div>}
      {phone ? controls : slot && createPortal(controls, slot)}
      <Tooltip />
    </div>
  );
}
