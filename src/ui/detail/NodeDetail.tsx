import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { frame, icon, QMARK, XPORB } from '../../art/pixel';
import { SFX } from '../../art/sfx';
import { byId, childrenOf, isDone, statusOf, TYPE_NAME } from '../../domain/rules';
import type { Achievement, NodeStatus } from '../../domain/types';
import { useStore } from '../../store/store';
import { bumpWithFx, completeWithFx } from '../actions';
import { useUi } from '../uiStore';
import { CloseButton } from './CloseButton';
import { DoneFields } from './DoneFields';
import { LinkRow } from './LinkRow';

export const HIDDEN_DESC = '这是一个隐藏进度。完成它的前置进度后，就能看到具体内容。';

/**
 * When the last completion or undo happened here. Each swaps the complete and undo buttons in
 * place (the sticky action row keeps them there in a long panel), so the second click of a
 * double-click or a quick extra click would undo the completion, or complete it again with today's
 * date and without its note.
 */
let lastDone = -Infinity;
let lastUndo = -Infinity;
const GUARD_MS = 900;
/** Two-step undo when a note would be lost: the second click must come after 450 ms and within 4 s. */
const ARM_GUARD_MS = 450;
const ARM_MS = 4000;

type Act = 'complete' | 'inc' | 'dec' | 'undo';
/** Where focus goes after an action removed or disabled the focused button. */
const REFOCUS: Record<Act, Act[]> = {
  complete: ['undo'],
  inc: ['inc', 'undo'],
  dec: ['dec', 'inc'],
  undo: ['undo', 'complete'],
};

function chipFor(st: NodeStatus, n: Achievement, date: string | undefined, prog: number, missing: number) {
  if (st === 'done') return <span className="chip done small">✓ 已达成 · {date}</span>;
  if (st === 'open') {
    return (
      <span className="chip open small">
        {n.target && prog ? `进行中 · ${prog}/${n.target} ${n.unit ?? ''}` : '可以开始'}
      </span>
    );
  }
  return <span className="chip locked small">未解锁 · 还差 {missing} 个前置</span>;
}

/** The selected achievement: status, rewards, prerequisites, what it unlocks and the actions. */
export function NodeDetail({ id }: { id: string }) {
  const node = useStore(s => byId(s.data).get(id));
  const st = useStore(s => statusOf(s.data, id));
  const info = useStore(s => (Object.hasOwn(s.data.done, id) ? s.data.done[id] : undefined));
  const prog = useStore(s => s.data.progress[id] ?? 0);
  const areaName = useStore(s => {
    const n = byId(s.data).get(id);
    return s.data.areas.find(a => a.id === n?.areaId)?.name ?? '';
  });
  const parents = useStore(useShallow(s => {
    const map = byId(s.data);
    return (map.get(id)?.parents ?? []).filter(p => map.has(p));
  }));
  const missing = useStore(s => {
    const map = byId(s.data);
    return (map.get(id)?.parents ?? []).filter(p => map.has(p) && !isDone(s.data, p)).length;
  });
  const kids = useStore(useShallow(s => childrenOf(s.data, id).map(k => k.id)));

  const [msg, setMsg] = useState('');
  const [armedAt, setArmedAt] = useState(0);
  useEffect(() => {
    if (!armedAt) return;
    const t = setTimeout(() => setArmedAt(0), ARM_MS);
    return () => clearTimeout(t);
  }, [armedAt]);
  const [refocus, setRefocus] = useState<{ act: Act; seq: number } | null>(null);
  const actRef = useRef<HTMLDivElement>(null);

  // after an action re-rendered the buttons, put focus back on a sensible one (unless it is still
  // on an enabled control in the panel)
  useLayoutEffect(() => {
    if (!refocus) return;
    const box = actRef.current?.closest('.dscroll');
    if (!box) return;
    const a = document.activeElement;
    if (a instanceof HTMLElement && box.contains(a) && !(a instanceof HTMLButtonElement && a.disabled)) return;
    const pick = (sel: string) => box.querySelector<HTMLElement>(sel);
    const target =
      REFOCUS[refocus.act].map(act => pick(`[data-act="${act}"]:not([disabled])`)).find(Boolean) ??
      pick('.dact button:not([disabled])') ??
      pick('.dprog button:not([disabled])');
    target?.focus({ preventScroll: true });
  }, [refocus]);

  if (!node) return null;

  const myst = !!node.hidden && st === 'locked';
  const after = (act: Act) => setRefocus(r => ({ act, seq: (r?.seq ?? 0) + 1 }));

  const complete = (e: MouseEvent) => {
    if (e.detail > 1 || performance.now() - lastUndo < GUARD_MS) return;
    if (completeWithFx(id)) lastDone = performance.now();
    setMsg('');
    after('complete');
  };
  const bump = (delta: 1 | -1) => {
    if (bumpWithFx(id, delta)) lastDone = performance.now();
    setMsg('');
    after(delta > 0 ? 'inc' : 'dec');
  };
  const undo = (e: MouseEvent) => {
    if (e.detail > 1 || performance.now() - lastDone < GUARD_MS) return;
    // undo drops the done record, so a written note would be gone for good: ask twice
    if (info?.note && !armedAt) {
      setArmedAt(performance.now());
      SFX.click();
      return;
    }
    if (armedAt && performance.now() - armedAt < ARM_GUARD_MS) return;
    setArmedAt(0);
    const r = useStore.getState().undo(id);
    if (r.ok) {
      lastUndo = performance.now();
      SFX.click();
      setMsg('');
    } else {
      setMsg(r.error);
    }
    after('undo');
  };
  const edit = () => {
    SFX.click();
    useUi.getState().openModal({ kind: 'node', id, areaId: node.areaId });
  };
  const follow = () => {
    SFX.click();
    useUi.getState().openModal({ kind: 'node', areaId: node.areaId, parent: id });
  };

  const target = node.target;
  const shown = target ? (st === 'done' ? target : Math.min(prog, target)) : 0;

  return (
    <>
      <div className="dh">
        <div className={`badge ${st}`}>
          <img className="fr" src={frame(node.type, st)} alt="" />
          <img className="ic" src={myst ? QMARK : icon(node.icon)} alt="" />
        </div>
        <div>
          <h2 tabIndex={-1}>{myst ? '???' : node.title}</h2>
          <div className="dmeta small">
            <span className={node.type === 'challenge' ? 'ch' : undefined}>{TYPE_NAME[node.type]}</span> · {areaName}
          </div>
        </div>
        <CloseButton />
      </div>
      {chipFor(st, node, info?.date, prog, missing)}
      <p className="ddesc">{myst ? HIDDEN_DESC : node.desc}</p>
      {node.tip && !myst && <p className="dtip small">{node.tip}</p>}
      {!!target && !myst && (
        <div className="dprog">
          <div className="pbar">
            <i style={{ width: `calc(${((shown / target) * 100).toFixed(1)}% - 4px)` }} />
            <span className="num">{shown}/{target} {node.unit ?? ''}</span>
          </div>
          {st === 'open' && (
            <>
              <button className="btn sq" type="button" data-act="dec" aria-label="减一" disabled={!prog} onClick={() => bump(-1)}>-</button>
              <button className="btn go" type="button" data-act="inc" onClick={() => bump(1)}>+1</button>
            </>
          )}
        </div>
      )}
      {st === 'done' && info && <DoneFields id={id} date={info.date} note={info.note ?? ''} />}
      <div className="dsec">
        <h3>奖励</h3>
        <ul className="rw">
          <li>
            <span className="slot mini"><img src={XPORB} alt="" /></span>
            <span className="val xpv">+{myst ? '???' : node.xp} 经验</span>
          </li>
          <li>
            <span className="slot mini"><img src={icon('emerald')} alt="" /></span>
            <span className="val emv">+{myst ? '???' : node.pts} 绿宝石</span>
          </li>
          {node.reward && !myst && (
            <li>
              <span className="slot mini"><img src={icon('chest')} alt="" /></span>
              <span className="val">现实奖励：{node.reward}</span>
            </li>
          )}
        </ul>
      </div>
      {parents.length > 0 && (
        <div className="dsec">
          <h3>前置进度</h3>
          <ul className="lk-list">
            {parents.map(p => <LinkRow key={p} id={p} here={node.areaId} mark />)}
          </ul>
        </div>
      )}
      {kids.length > 0 && (
        <div className="dsec">
          <h3>完成后解锁</h3>
          <ul className="lk-list">
            {kids.map(k => <LinkRow key={k} id={k} here={node.areaId} />)}
          </ul>
        </div>
      )}
      <div className="dact" ref={actRef}>
        <p className="dmsg small" role="alert">{msg}</p>
        {st === 'open' && !target && <button className="btn go" type="button" data-act="complete" onClick={complete}>完成进度</button>}
        {st === 'open' && !!target && <button className="btn" type="button" data-act="complete" onClick={complete}>直接标记完成</button>}
        {st === 'locked' && <button className="btn go" type="button" disabled>先完成前置进度</button>}
        {st === 'done' && (
          <button className={armedAt ? 'btn danger armed' : 'btn'} type="button" data-act="undo" onClick={undo}>
            {armedAt ? '再点一次撤销（感想会删掉）' : '撤销完成'}
          </button>
        )}
        <button className="btn sm" type="button" onClick={edit}>编辑</button>
        {!myst && <button className="btn sm" type="button" onClick={follow}>+ 后续进度</button>}
      </div>
    </>
  );
}
