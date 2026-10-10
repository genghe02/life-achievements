import { useShallow } from 'zustand/react/shallow';
import { frame, icon } from '../../art/pixel';
import { areaGates, areaLocked, isDone, nodesOfArea, statusOf } from '../../domain/rules';
import type { LifeData } from '../../domain/types';
import { useStore } from '../../store/store';
import { CloseButton } from './CloseButton';
import { LinkRow } from './LinkRow';

export const OVERVIEW_HINT = '点任意一个进度查看详情。前置全部完成，后面的进度才会解锁。';
export const EMPTY_PROMPT = '这棵树还很空。点上方的「+ 新建」，把你想做到的事挂到树上。';
/** Up to this many achievements, the overview suggests adding more. */
const NEARLY_EMPTY = 2;
const RECENT_MAX = 4;

/** Open achievements of the area, left to right, then top to bottom. */
export function openOfArea(data: LifeData, areaId: string): string[] {
  return nodesOfArea(data, areaId)
    .filter(n => statusOf(data, n.id) === 'open')
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map(n => n.id);
}

/** Done achievements of the area, newest date first; same-day ones by completion order (newest first). */
export function recentOfArea(data: LifeData, areaId: string, max = RECENT_MAX): string[] {
  const order = new Map(Object.keys(data.done).map((k, i) => [k, i]));
  return nodesOfArea(data, areaId)
    .filter(n => isDone(data, n.id))
    .sort((a, b) => {
      const da = data.done[a.id].date, db = data.done[b.id].date;
      if (da !== db) return da < db ? 1 : -1;
      return (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0);
    })
    .slice(0, max)
    .map(n => n.id);
}

/** What the panel shows with nothing selected: the current area at a glance. */
export function AreaOverview({ areaId }: { areaId: string }) {
  const area = useStore(s => s.data.areas.find(a => a.id === areaId));
  const stats = useStore(useShallow(s => {
    const ns = nodesOfArea(s.data, areaId);
    let done = 0, open = 0;
    for (const n of ns) {
      const st = statusOf(s.data, n.id);
      if (st === 'done') done++;
      else if (st === 'open') open++;
    }
    return { all: ns.length, done, open, locked: areaLocked(s.data, areaId) };
  }));
  const gates = useStore(useShallow(s => (areaLocked(s.data, areaId) ? areaGates(s.data, areaId).map(g => g.id) : [])));
  const open = useStore(useShallow(s => openOfArea(s.data, areaId)));
  const recent = useStore(useShallow(s => recentOfArea(s.data, areaId)));
  if (!area) return null;

  const pct = stats.all ? (stats.done / stats.all) * 100 : 0;
  return (
    <>
      <div className="dh">
        <div className="badge">
          <img className="fr" src={frame('goal', stats.locked ? 'locked' : 'open')} alt="" />
          <img className="ic" src={icon(area.icon)} alt="" />
        </div>
        <div>
          <h2>{area.name}</h2>
          <div className="dmeta small">{area.subtitle}</div>
        </div>
        <CloseButton />
      </div>
      <div className="ov-bar" aria-hidden="true"><i style={{ width: `${pct.toFixed(1)}%` }} /></div>
      <div className="ov-stats small">
        <div><b className="num">{stats.done}</b><span>已达成</span></div>
        <div><b className="num">{stats.open}</b><span>可以开始</span></div>
        <div><b className="num">{stats.all - stats.done - stats.open}</b><span>未解锁</span></div>
      </div>
      {gates.length > 0 && (
        <div className="dsec">
          <h3>解锁条件</h3>
          <ul className="lk-list">
            {gates.map(g => <LinkRow key={g} id={g} here={areaId} mark />)}
          </ul>
        </div>
      )}
      {open.length > 0 && (
        <div className="dsec">
          <h3>现在可以做</h3>
          <ul className="lk-list">
            {open.map(n => <LinkRow key={n} id={n} here={areaId} hideOpen />)}
          </ul>
        </div>
      )}
      {recent.length > 0 && (
        <div className="dsec">
          <h3>最近达成</h3>
          <ul className="lk-list">
            {recent.map(n => <LinkRow key={n} id={n} here={areaId} />)}
          </ul>
        </div>
      )}
      {stats.all <= NEARLY_EMPTY && <p className="ddesc">{EMPTY_PROMPT}</p>}
      <p className="empty-note small">{OVERVIEW_HINT}</p>
    </>
  );
}
