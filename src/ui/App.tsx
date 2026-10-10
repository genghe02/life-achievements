import { useEffect } from 'react';
import { setSound } from '../art/sfx';
import { useStore } from '../store/store';
import { AreaTabs } from './AreaTabs';
import { DetailPanel } from './detail/DetailPanel';
import { Toasts } from './fx/Toasts';
import { Hud } from './Hud';
import { ModalHost } from './modals/ModalHost';
import { Onboarding } from './onboarding/Onboarding';
import { TreeView } from './tree/TreeView';
import { UpdateBar } from './UpdateBar';
import { useUi } from './uiStore';
import { WindowHead } from './WindowHead';

/** Esc with no modal open closes the detail (selection or phone overview). */
function useEscapeToDeselect() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const ui = useUi.getState();
      if (ui.modal) return; // the modal handles its own Esc
      // in the detail panel's date or note field, Esc first leaves the field (which saves it on
      // blur) instead of closing the panel and losing the edit
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
        t.blur();
        return;
      }
      if (ui.sel) ui.select(null);
      else if (ui.overview) ui.showOverview(false);
    };
    // capture phase: run before a modal's own handler closes it, so one Esc never does both
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

export function App() {
  const phase = useStore(s => s.phase);
  const sound = useStore(s => s.data.settings.sound);
  useEffect(() => setSound(sound), [sound]);
  useEscapeToDeselect();

  if (phase === 'loading') {
    return <div className="boot" role="status"><span>加载中…</span></div>;
  }
  if (phase === 'new') {
    return (
      <>
        <Onboarding />
        <Toasts />
        <UpdateBar />
      </>
    );
  }
  return (
    <>
      <div className="app">
        <Hud />
        <AreaTabs />
        <main className="win mcp">
          <WindowHead />
          <div className="wbody">
            <TreeView />
            <DetailPanel />
          </div>
        </main>
      </div>
      <Toasts />
      <ModalHost />
      <UpdateBar />
    </>
  );
}
