// The arrange-mode bar at the top of the tree: the hint (or why the last drop was refused) and 「完成」.

import { SFX } from '../../art/sfx';
import { useUi } from '../uiStore';

export function ArrangeHint({ msg }: { msg: string }) {
  const done = () => {
    SFX.click();
    useUi.getState().setArrange(false);
    // this bar goes away with the mode: focus moves to the 「整理」 button that started it
    document.querySelector<HTMLElement>('.btn-arrange')?.focus({ preventScroll: true });
  };
  return (
    <div className="arr-hint small">
      <span className={msg ? 'bad' : undefined} role="status">{msg || '拖动进度换个位置。'}</span>
      <button className="btn sm go" type="button" onClick={done}>完成</button>
    </div>
  );
}
