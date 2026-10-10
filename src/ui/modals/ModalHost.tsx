// STUB (shell): replaced by the modals module (shell with focus trap, trade, node and area editors, menu).
import { useUi } from '../uiStore';
import { MenuModal } from './MenuModal';

const TITLE = { trade: '交易', menu: '菜单', node: '进度', area: '领域' } as const;

export function ModalHost() {
  const modal = useUi(s => s.modal);
  if (!modal) return null;
  const close = () => useUi.getState().closeModal();
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="mbox mcp" role="dialog" aria-modal="true" aria-labelledby="mStubT">
        <div className="mhead">
          <h2 id="mStubT">{TITLE[modal.kind]}</h2>
          <button className="btn sm sq" type="button" aria-label="关闭" onClick={close}>×</button>
        </div>
        <div className="mscroll">{modal.kind === 'menu' ? <MenuModal /> : <p className="mnote small">还在准备中。</p>}</div>
      </div>
    </div>
  );
}
