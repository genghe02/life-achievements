import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { frame, icon, QMARK } from '../../art/pixel';
import { SFX } from '../../art/sfx';
import { ICON_NAMES, NODE_TYPES } from '../../domain/catalog';
import { DEF_PTS, DEF_XP } from '../../domain/level';
import { byId, childrenOf, displayTitle, isDone, nodesOfArea, statusOf, TYPE_NAME, wouldCycle } from '../../domain/rules';
import type { Achievement, IconName, LifeData, NodeType } from '../../domain/types';
import { LIMITS, type AchievementInput } from '../../store/inputs';
import { MSG, useStore } from '../../store/store';
import { toast } from '../fx/toastQueue';
import { useUi } from '../uiStore';
import { IconGrid } from './fields';
import { Modal } from './Modal';
import { refocusAfterClose, treeNode, treeView } from './refocus';
import { numOrUndef, useArm } from './useArm';

const close = () => useUi.getState().closeModal();

interface Props {
  /** Edit this achievement; omit to create one. */
  id?: string;
  areaId: string;
  /** New: the prerequisite to preselect (defaults to the area's root). */
  parent?: string;
}

const byGrid = (a: Achievement, b: Achievement) => a.x - b.x || a.y - b.y;

/** Number fields, named by data-num; text the browser can't read as a number shows this message. */
const BAD_NUM = { target: MSG.target, xp: MSG.xp, pts: MSG.pts } as const;
type NumField = keyof typeof BAD_NUM;

/** Why a candidate prerequisite can't be picked, or '' when it can. */
type Block = '' | 'cycle' | 'column';

function blockOf(data: LifeData, node: Achievement | undefined, p: Achievement, minKidX: number): Block {
  if (!node) return '';
  if (wouldCycle(data, node.id, [p.id])) return 'cycle';
  // the node has to fit in a column between its prerequisites and its (same-area) followers
  if (p.areaId === node.areaId && p.x >= minKidX - 1) return 'column';
  return '';
}

const BLOCK_TITLE: Record<Exclude<Block, ''>, string> = {
  cycle: '它排在这个进度后面，选它会绕成一个圈。',
  column: '它和这个进度的后续进度挨得太近，放不下。',
};

function ParentChip({ data, n, checked, block, onToggle }: {
  data: LifeData; n: Achievement; checked: boolean; block: Block; onToggle: (id: string, on: boolean) => void;
}) {
  const myst = !!n.hidden && statusOf(data, n.id) === 'locked';
  return (
    <label className="small" title={block ? BLOCK_TITLE[block] : undefined}>
      <input type="checkbox" value={n.id} checked={checked} disabled={!!block && !checked} onChange={e => onToggle(n.id, e.target.checked)} />
      <span className="slot mini"><img src={myst ? QMARK : icon(n.icon)} alt="" /></span>
      {displayTitle(data, n)}
    </label>
  );
}

/** 新建进度 / 编辑进度: one form for a new achievement and for editing one (incl. delete). */
export function NodeEditor({ id, areaId, parent }: Props) {
  const data = useStore(s => s.data);
  const area = data.areas.find(a => a.id === areaId);
  const node = id ? byId(data).get(id) : undefined;
  // the form keeps working on the state it opened with; a vanished node shows a message instead
  const [init] = useState(() => {
    const d = useStore.getState().data;
    const n = id ? byId(d).get(id) : undefined;
    const root = nodesOfArea(d, areaId).find(m => m.x === 0);
    const pre = parent && byId(d).get(parent)?.areaId === areaId ? parent : root?.id;
    return {
      node: n,
      done: !!n && isDone(d, n.id),
      parents: n ? n.parents.filter(p => byId(d).has(p)) : pre ? [pre] : [],
    };
  });
  const n0 = init.node;
  const isNew = !id;
  const isRoot = !!n0 && n0.x === 0;

  const [title, setTitle] = useState(n0?.title ?? '');
  const [desc, setDesc] = useState(n0?.desc ?? '');
  const [tip, setTip] = useState(n0?.tip ?? '');
  const [type, setType] = useState<NodeType>(n0?.type ?? 'task');
  const [ic, setIc] = useState<IconName>(n0?.icon ?? ICON_NAMES[0]);
  const [parents, setParents] = useState<string[]>(init.parents);
  const [target, setTarget] = useState(n0?.target ? String(n0.target) : '');
  const [unit, setUnit] = useState(n0?.unit ?? '');
  const [reward, setReward] = useState(n0?.reward ?? '');
  const [hidden, setHidden] = useState(!!n0?.hidden);
  const [xp, setXp] = useState(String(n0 ? n0.xp : DEF_XP.task));
  const [pts, setPts] = useState(String(n0 ? n0.pts : DEF_PTS.task));
  // XP and emeralds follow the type while they still hold the type's defaults and the user has
  // not typed in them; on edit a custom value is kept whatever the type, and a done achievement
  // keeps what it paid out (the HUD totals must not move because its type changed)
  const [xpAuto, setXpAuto] = useState(!n0 || (!init.done && n0.xp === DEF_XP[n0.type]));
  const [ptsAuto, setPtsAuto] = useState(!n0 || (!init.done && n0.pts === DEF_PTS[n0.type]));
  const [advOpen] = useState(!!n0 && (n0.xp !== DEF_XP[n0.type] || n0.pts !== DEF_PTS[n0.type]));
  const advRef = useRef<HTMLDetailsElement>(null);
  const [err, setErr] = useState('');
  const [delErr, setDelErr] = useState('');
  const { armed, press } = useArm();
  const formId = useId();

  const kidsMinX = useMemo(() => {
    if (!n0) return Infinity;
    const xs = childrenOf(data, n0.id).filter(k => k.areaId === n0.areaId).map(k => k.x);
    return xs.length ? Math.min(...xs) : Infinity;
  }, [data, n0]);

  const sameArea = useMemo(() => nodesOfArea(data, areaId).filter(m => m.id !== id).sort(byGrid), [data, areaId, id]);
  const otherAreas = useMemo(
    () => (isRoot ? data.areas.filter(a => a.id !== areaId).map(a => ({ area: a, nodes: nodesOfArea(data, a.id).sort(byGrid) })) : []),
    [data, areaId, isRoot],
  );
  const [openGroups] = useState(() => new Set(init.parents.map(p => byId(useStore.getState().data).get(p)?.areaId)));

  if (!area || (id && !node)) {
    return (
      <Modal title="编辑进度" onClose={close}>
        <p className="mnote">{!area ? '找不到这个领域，刷新后再试。' : '找不到这个进度，刷新后再试。'}</p>
      </Modal>
    );
  }

  const toggle = (pid: string, on: boolean) => setParents(ps => (on ? [...ps.filter(p => p !== pid), pid] : ps.filter(p => p !== pid)));
  const pickType = (t: NodeType) => {
    setType(t);
    if (xpAuto) setXp(String(DEF_XP[t]));
    if (ptsAuto) setPts(String(DEF_PTS[t]));
  };

  const fail = (msg: string) => {
    setErr(msg);
    // the field the message is about may sit in the folded 「高级」 part
    if ((msg === MSG.xp || msg === MSG.pts) && advRef.current) advRef.current.open = true;
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // text a number field can't parse reads as '' (the same as empty): say so instead of dropping it
    const bad = [...e.currentTarget.querySelectorAll<HTMLInputElement>('input[data-num]')].find(i => i.validity?.badInput);
    if (bad) {
      fail(BAD_NUM[bad.dataset.num as NumField]);
      return;
    }
    const input: AchievementInput = {
      areaId,
      title,
      desc,
      tip,
      type,
      icon: ic,
      parents,
      xp: numOrUndef(xp),
      pts: numOrUndef(pts),
      target: numOrUndef(target),
      unit,
      reward,
      hidden,
    };
    const st = useStore.getState();
    const r = st.saveAchievement(input, id);
    if (!r.ok) {
      fail(r.error);
      return;
    }
    close();
    if (useStore.getState().areaId !== areaId) useStore.getState().setArea(areaId);
    useUi.getState().focusNode(r.id);
    refocusAfterClose(treeNode(r.id), treeView);
    if (isNew) {
      SFX.task();
      toast({ icon: icon(ic), kind: 'task', l1: '新进度已添加', l2: title.trim() });
    } else {
      SFX.click();
    }
  };

  // the 「编辑」 that opened the editor went with the achievement: land on a prerequisite on the tree
  const closeDeleted = () => {
    close();
    refocusAfterClose(...(node?.parents ?? []).map(treeNode), treeView);
  };

  const remove = () => {
    if (!node) return;
    const st = useStore.getState();
    // blocked deletes (root, others depend on it, done) answer on the first click
    if (node.x === 0 || childrenOf(st.data, node.id).length || isDone(st.data, node.id)) {
      const r = st.deleteAchievement(node.id);
      setDelErr(r.ok ? '' : r.error);
      if (r.ok) closeDeleted();
      return;
    }
    setDelErr('');
    if (!press('del')) {
      SFX.click();
      return;
    }
    const r = st.deleteAchievement(node.id);
    if (!r.ok) {
      setDelErr(r.error);
      return;
    }
    SFX.click();
    closeDeleted();
  };

  const anyBlocked = !isRoot && !!n0 && sameArea.some(p => blockOf(data, n0, p, kidsMinX));

  const footer = (
    <>
      <p className="ferr dmsg small" role="alert">{err}</p>
      <button className="btn go" type="submit" form={formId}>{isNew ? '添加到进度树' : '保存'}</button>
      <button className="btn" type="button" onClick={close}>取消</button>
    </>
  );

  return (
    <Modal title={isNew ? `新建进度 · ${area.name}` : '编辑进度'} onClose={close} footer={footer}>
      <form className="form" id={formId} noValidate onSubmit={submit}>
        {isNew && <p className="mnote small">把你自己的目标加进这棵树。选好前置进度，新进度会挂在它们后面，前置完成后才会解锁。</p>}
        {isRoot && <p className="mnote small">这是「{area.name}」的起点进度。可以选其他领域的进度作为通往这里的前置：它们完成前，整个领域都锁着。</p>}
        <label className="field">
          <span className="small">名称（最多 {LIMITS.title} 个字）</span>
          <input className="inp" maxLength={LIMITS.title} placeholder="比如：第一次登山" value={title} onChange={e => setTitle(e.target.value)} data-autofocus="" />
        </label>
        <label className="field">
          <span className="small">完成条件</span>
          <input className="inp" maxLength={LIMITS.desc} placeholder="比如：登上一座海拔1000米以上的山" value={desc} onChange={e => setDesc(e.target.value)} />
        </label>
        <label className="field">
          <span className="small">小提示（可不填）</span>
          <input className="inp" maxLength={LIMITS.tip} placeholder="比如：先从近郊的小山开始" value={tip} onChange={e => setTip(e.target.value)} />
        </label>
        <fieldset className="field">
          <legend className="small">类型</legend>
          <div className="seg">
            {NODE_TYPES.map(t => (
              <label key={t}>
                <input type="radio" name={`${formId}-type`} value={t} checked={type === t} onChange={() => pickType(t)} />
                <img src={frame(t, 'open')} alt="" />
                {TYPE_NAME[t]}
                <span className="small">+{DEF_XP[t]} 经验</span>
              </label>
            ))}
          </div>
        </fieldset>
        {isRoot ? (
          <fieldset className="field">
            <legend className="small">通往这个领域的前置进度（可不选）</legend>
            {otherAreas.length ? (
              <div className="pgroups">
                {otherAreas.map(({ area: a, nodes }) => {
                  const picked = nodes.filter(m => parents.includes(m.id)).length;
                  return (
                    <details key={a.id} className="pgrp" open={openGroups.has(a.id)}>
                      <summary>
                        <span className="slot mini"><img src={icon(a.icon)} alt="" /></span>
                        <span className="pgn">{a.name}</span>
                        {picked > 0 && <span className="small pgc">已选 {picked} 个</span>}
                      </summary>
                      <div className="seg">
                        {nodes.map(m => (
                          <ParentChip key={m.id} data={data} n={m} checked={parents.includes(m.id)} block={blockOf(data, n0, m, Infinity)} onToggle={toggle} />
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : (
              <p className="mnote small">还没有其他领域。</p>
            )}
          </fieldset>
        ) : (
          <fieldset className="field">
            <legend className="small">前置进度（可多选）</legend>
            <div className="seg">
              {sameArea.map(m => (
                <ParentChip key={m.id} data={data} n={m} checked={parents.includes(m.id)} block={blockOf(data, n0, m, kidsMinX)} onToggle={toggle} />
              ))}
            </div>
            {anyBlocked && <p className="mnote small">灰色的进度不能当作它的前置：选了会绕成一个圈，或者树上放不下。</p>}
          </fieldset>
        )}
        <div className="row">
          <label className="field">
            <span className="small">累计目标（可不填）</span>
            <input
              className="inp num"
              type="number"
              inputMode="numeric"
              min={LIMITS.targetMin}
              max={LIMITS.targetMax}
              placeholder="比如：30"
              data-num="target"
              value={target}
              onChange={e => setTarget(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="small">单位</span>
            <input className="inp" maxLength={LIMITS.unit} placeholder="天 / 次 / 本" value={unit} onChange={e => setUnit(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="small">现实奖励（可不填）</span>
          <input className="inp" maxLength={LIMITS.reward} placeholder="比如：一双新登山鞋" value={reward} onChange={e => setReward(e.target.value)} />
        </label>
        <div className="seg">
          <label>
            <input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} />
            <span>隐藏进度</span>
            <span className="small">解锁前显示为 ???</span>
          </label>
        </div>
        <IconGrid value={ic} onChange={setIc} />
        <details className="adv" open={advOpen} ref={advRef}>
          <summary className="small">高级</summary>
          <div className="row">
            <label className="field">
              <span className="small">经验</span>
              <input
                className="inp num"
                type="number"
                inputMode="numeric"
                min={0}
                max={LIMITS.xpMax}
                data-num="xp"
                value={xp}
                onChange={e => { setXp(e.target.value); setXpAuto(false); }}
              />
            </label>
            <label className="field">
              <span className="small">绿宝石</span>
              <input
                className="inp num"
                type="number"
                inputMode="numeric"
                min={0}
                max={LIMITS.ptsMax}
                data-num="pts"
                value={pts}
                onChange={e => { setPts(e.target.value); setPtsAuto(false); }}
              />
            </label>
          </div>
          <p className="mnote small">
            {init.done ? '这个进度已经完成，换类型不会改变它给过的经验和绿宝石。要改就在这里改。' : '完成后得到的经验和绿宝石。没改过时跟着类型走。'}
          </p>
        </details>
        {node && (
          <div className="dsec">
            <h3>删除</h3>
            <div className="mrow">
              <button className={armed === 'del' ? 'btn danger armed' : 'btn danger'} type="button" onClick={remove}>
                {armed === 'del' ? '再点一次删除' : '删除这个进度'}
              </button>
            </div>
            <p className="ferr small" role="alert">{delErr}</p>
          </div>
        )}
      </form>
    </Modal>
  );
}
