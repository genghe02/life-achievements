// STUB (shell): replaced by the tree module (viewport, nodes, connectors, zoom, arrange mode).
import { BG_DIM, texture } from '../../art/pixel';
import { useStore } from '../../store/store';

export function TreeView() {
  const bg = useStore(s => s.data.areas.find(a => a.id === s.areaId)?.bg ?? 'dirt');
  const dim = BG_DIM[bg];
  return (
    <div
      className="vp"
      id="vp"
      tabIndex={-1}
      style={{ backgroundImage: `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url(${texture(bg)})`, backgroundSize: 'auto, 32px 32px' }}
    >
      <div className="vhint small">拖动平移 · Ctrl/Cmd + 滚轮缩放</div>
    </div>
  );
}
