// One achievement on the tree: frame, icon (??? while hidden and locked), lock badge, counter bar
// and label. Positioned by its cell centre; the viewport moves the whole world, not the nodes.

import { memo } from 'react';
import { frame, icon, LOCK, QMARK } from '../../art/pixel';
import { TYPE_NAME } from '../../domain/rules';
import type { Achievement, NodeStatus } from '../../domain/types';

interface Props {
  n: Achievement;
  status: NodeStatus;
  /** displayTitle: ??? while hidden and locked. */
  title: string;
  /** Counter value (0 without a counter). */
  prog: number;
  cx: number;
  cy: number;
  sel: boolean;
  fresh: boolean;
}

/** The screen-reader label, e.g. 「晨跑，任务，进行中 3/7」. */
export function nodeLabel(title: string, type: Achievement['type'], status: NodeStatus, prog: number, target?: number): string {
  const state = status === 'done' ? '已达成'
    : status === 'open' ? (target && prog > 0 ? `进行中 ${prog}/${target}` : '可以开始')
      : '未解锁';
  return `${title}，${TYPE_NAME[type]}，${state}`;
}

export const TreeNode = memo(function TreeNode({ n, status, title, prog, cx, cy, sel, fresh }: Props) {
  const myst = !!n.hidden && status === 'locked';
  const p = n.target && status !== 'done' ? Math.min(1, prog / n.target) : 0;
  let cls = `node ${status} t-${n.type}`;
  if (sel) cls += ' sel';
  if (fresh) cls += ' fresh';
  return (
    <button
      className={cls}
      type="button"
      data-id={n.id}
      style={{ left: cx - 26, top: cy - 26 }}
      aria-label={nodeLabel(title, n.type, status, prog, n.target)}
    >
      <img className="fr" src={frame(n.type, status)} alt="" />
      <img className="ic" src={myst ? QMARK : icon(n.icon)} alt="" />
      {status === 'locked' && <img className="lk" src={LOCK} alt="" />}
      {p > 0 && (
        <span className="dur">
          <i style={{ width: Math.max(2, Math.round(p * 12) * 2), background: `hsl(${Math.round(p * 120)},100%,48%)` }} />
        </span>
      )}
      <span className="lb">{title}</span>
    </button>
  );
});
