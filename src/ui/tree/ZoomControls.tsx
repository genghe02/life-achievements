// 「+」「-」「全览」「定位」. On desktop they sit in the window head (#zoomSlot); on phones they
// float over the tree's bottom-right corner.

import type { Viewport } from './viewport';

export function ZoomControls({ ctl }: { ctl: Viewport }) {
  return (
    <div className="vctl">
      <button className="btn sm sq" type="button" aria-label="放大" onClick={() => ctl.zoomStep(1)}>+</button>
      <button className="btn sm sq" type="button" aria-label="缩小" onClick={() => ctl.zoomStep(-1)}>-</button>
      <button className="btn sm" type="button" onClick={() => ctl.fit()}>全览</button>
      <button className="btn sm" type="button" onClick={() => ctl.goHome()}>定位</button>
    </div>
  );
}
