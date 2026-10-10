import { useUi } from '../uiStore';
import { AreaEditor } from './AreaEditor';
import { MenuModal } from './MenuModal';
import { NodeEditor } from './NodeEditor';
import { TradeModal } from './TradeModal';

/** Renders the open modal (one at a time). Keys reset a form when the target changes. */
export function ModalHost() {
  const modal = useUi(s => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case 'trade':
      return <TradeModal />;
    case 'menu':
      return <MenuModal />;
    case 'node':
      return (
        <NodeEditor
          key={`node:${modal.id ?? ''}:${modal.areaId}:${modal.parent ?? ''}`}
          id={modal.id}
          areaId={modal.areaId}
          parent={modal.parent}
        />
      );
    case 'area':
      return <AreaEditor key={`area:${modal.id ?? ''}`} id={modal.id} />;
  }
}
