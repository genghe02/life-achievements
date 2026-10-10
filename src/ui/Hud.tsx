import { useEffect, useRef } from 'react';
import { icon, MENU } from '../art/pixel';
import { SFX } from '../art/sfx';
import { levelOf, rankOf } from '../domain/level';
import { useStore } from '../store/store';
import { hudNumbers, useHudFx } from './fx/hudFx';
import { useUi } from './uiStore';

/** Top strip: level, rank, done count, XP bar, emeralds (opens trading) and the menu button. */
export function Hud() {
  const data = useStore(s => s.data);
  const { pending, pop } = useHudFx();
  // live totals minus the gains whose XP orbs are still flying
  const n = hudNumbers(data, pending);
  const lv = levelOf(n.xp);
  const lvRef = useRef<HTMLDivElement>(null);
  const seenPop = useRef(pop);

  useEffect(() => {
    const el = lvRef.current;
    // only a level-up after mount pops, not a remount
    if (pop === seenPop.current || !el) return;
    seenPop.current = pop;
    el.classList.remove('pop');
    void el.offsetWidth; // restart the animation
    el.classList.add('pop');
  }, [pop]);

  const open = (kind: 'trade' | 'menu') => {
    SFX.click();
    useUi.getState().openModal({ kind });
  };

  return (
    <header className="hud">
      <div className="lv" ref={lvRef} title="人生等级">{lv.level}</div>
      <div className="xp">
        <div className="xp-top small">
          <span className="rk"><b>{rankOf(lv.level)}</b><span className="cnt"> · 已达成 {n.done}/{n.all}</span></span>
          <span className="num"><span>{lv.cur}/{lv.need}</span><span className="xpn-long"> 经验</span></span>
        </div>
        <div className="xpbar" aria-hidden="true"><i style={{ width: `${(lv.cur / lv.need * 100).toFixed(1)}%` }} /></div>
      </div>
      <button className="pill" id="btnTrade" type="button" aria-label={`绿宝石 ${n.emeralds}，交易`} onClick={() => open('trade')}>
        <img src={icon('emerald')} alt="" />
        <span className="num">{n.emeralds}</span>
        <span className="pl small">交易</span>
      </button>
      <button className="btn sq" id="btnMenu" type="button" aria-label="菜单" title="菜单" onClick={() => open('menu')}>
        <img src={MENU} alt="" />
      </button>
    </header>
  );
}
