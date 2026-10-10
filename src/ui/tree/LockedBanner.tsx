// Shown over a locked area: which achievement in which area unlocks it, with a jump there.

import { LOCK } from '../../art/pixel';
import { SFX } from '../../art/sfx';
import { areaGates, displayTitle, isDone } from '../../domain/rules';
import type { LifeData } from '../../domain/types';
import { useStore } from '../../store/store';
import { useUi } from '../uiStore';

export function LockedBanner({ data, areaId }: { data: LifeData; areaId: string }) {
  const gate = areaGates(data, areaId).find(g => !isDone(data, g.id));
  if (!gate) return null;
  const area = data.areas.find(a => a.id === gate.areaId);
  const go = () => {
    SFX.click();
    useStore.getState().setArea(gate.areaId);
    useUi.getState().focusNode(gate.id);
  };
  return (
    <div className="vbanner small">
      <img src={LOCK} alt="" />
      <span>完成「{area ? `${area.name} · ` : ''}{displayTitle(data, gate)}」后解锁这个领域</span>
      <button className="btn sm" type="button" onClick={go}>去看看</button>
    </div>
  );
}
