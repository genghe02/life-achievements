import { GEAR } from '../art/pixel';
import { SFX } from '../art/sfx';
import { areaLocked, isDone, nodesOfArea } from '../domain/rules';
import { useStore } from '../store/store';
import { setZoomSlot } from './hooks/zoomSlot';
import { useUi } from './uiStore';

/**
 * Title row of the advancement window. On desktop the tree portals its zoom controls into
 * #zoomSlot; on phones they float over the tree and the slot stays empty.
 */
export function WindowHead() {
  const data = useStore(s => s.data);
  const areaId = useStore(s => s.areaId);
  const arrange = useUi(s => s.arrange);
  const area = data.areas.find(a => a.id === areaId) ?? data.areas[0];
  if (!area) return null;

  const ns = nodesOfArea(data, area.id);
  const done = ns.filter(n => isDone(data, n.id)).length;
  const locked = areaLocked(data, area.id);

  const overview = () => {
    SFX.click();
    useUi.getState().showOverview(true);
  };
  const toggleArrange = () => {
    SFX.click();
    useUi.getState().setArrange(!useUi.getState().arrange);
  };
  const editArea = () => {
    SFX.click();
    useUi.getState().openModal({ kind: 'area', id: area.id });
  };
  const create = () => {
    SFX.click();
    const sel = useUi.getState().sel;
    const parent = sel && data.achievements.some(n => n.id === sel && n.areaId === area.id) ? sel : undefined;
    useUi.getState().openModal({ kind: 'node', areaId: area.id, parent });
  };

  return (
    // long names: narrow phones drop the 「已达成」 prefix so the name has room (styles/responsive.css)
    <div className={[...area.name].length > 3 ? 'whead long' : 'whead'}>
      <h1>{area.name}</h1>
      <span className="sub small">{area.subtitle}</span>
      <span className="spacer" />
      <span className="wprog small num">{locked ? '未解锁' : <><span className="wlbl">已达成 </span>{done}/{ns.length}</>}</span>
      <button className="btn sm btn-info" type="button" onClick={overview}>概览</button>
      <div id="zoomSlot" ref={setZoomSlot} />
      <button className="btn sm btn-arrange" type="button" aria-pressed={arrange} onClick={toggleArrange}>整理</button>
      <button className="btn sm btn-area" type="button" aria-label="领域设置" title="领域设置" onClick={editArea}>
        <img src={GEAR} alt="" />
        <span className="lbl">领域设置</span>
      </button>
      <button className="btn sm" id="btnNew" type="button" onClick={create}>+ 新建</button>
    </div>
  );
}
