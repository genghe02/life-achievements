import { icon, QMARK } from '../../art/pixel';
import { SFX } from '../../art/sfx';
import { byId, displayTitle, statusOf } from '../../domain/rules';
import { useStore } from '../../store/store';
import { goTo } from './nav';

interface Props {
  id: string;
  /** The area the panel is about: rows from other areas get a 「领域 · 」 prefix. */
  here: string;
  /** Prerequisite style: ✓ 已达成 / ✗ 未达成. Otherwise ✓ for done and 可以开始 for open. */
  mark?: boolean;
  /** Leave out 可以开始 (in a list that only holds open achievements). */
  hideOpen?: boolean;
}

/** One achievement in a detail list; clicking it jumps there. */
export function LinkRow({ id, here, mark = false, hideOpen = false }: Props) {
  const node = useStore(s => byId(s.data).get(id));
  const st = useStore(s => statusOf(s.data, id));
  const name = useStore(s => {
    const n = byId(s.data).get(id);
    return n ? displayTitle(s.data, n) : '';
  });
  const areaName = useStore(s => {
    const n = byId(s.data).get(id);
    return n && n.areaId !== here ? (s.data.areas.find(a => a.id === n.areaId)?.name ?? '') : '';
  });
  if (!node) return null;

  const myst = !!node.hidden && st === 'locked';
  let state;
  if (mark) {
    state = <span className={st === 'done' ? 'st ok' : 'st no'}>{st === 'done' ? '✓ 已达成' : '✗ 未达成'}</span>;
  } else if (st === 'done') {
    state = <span className="st">✓<span className="sr-only">已达成</span></span>;
  } else {
    state = <span className="st">{st === 'open' && !hideOpen ? '可以开始' : ''}</span>;
  }

  return (
    <li>
      <button type="button" data-goto={id} onClick={() => { SFX.click(); goTo(id); }}>
        <span className="slot mini"><img src={myst ? QMARK : icon(node.icon)} alt="" /></span>
        <span className="nm">{areaName && <span className="xt">{areaName} · </span>}{name}</span>
        {state}
      </button>
    </li>
  );
}
