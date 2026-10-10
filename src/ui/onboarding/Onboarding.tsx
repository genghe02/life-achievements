// STUB (shell): replaced by the onboarding module. Uses the shell's .onb* classes.
import { frame, icon } from '../../art/pixel';
import { useStore } from '../../store/store';

export function Onboarding() {
  const start = (kind: 'starter' | 'blank') => useStore.getState().start(kind);
  return (
    <main className="onb">
      <div className="onb-box mcp">
        <div className="onb-head">
          <div className="badge"><img className="fr" src={frame('goal', 'done')} alt="" /><img className="ic" src={icon('sapling')} alt="" /></div>
          <div><h1>人生成就系统</h1></div>
        </div>
        <p className="onb-lead">把人生里想做的事变成一棵棵进度树。先选一个开始方式：</p>
        <div className="onb-choices">
          <button className="onb-choice" type="button" onClick={() => start('starter')}>
            <span className="oc-h"><span className="slot"><img src={icon('map')} alt="" /></span><b>示例模板</b></span>
            <span className="oc-d small">7 个领域、97 个进度，都还没完成。把你已经做到的勾上就好。</span>
          </button>
          <button className="onb-choice" type="button" onClick={() => start('blank')}>
            <span className="oc-h"><span className="slot"><img src={icon('sapling')} alt="" /></span><b>空白开始</b></span>
            <span className="oc-d small">每个领域只有一个起点，进度全由你自己添加。</span>
          </button>
        </div>
        <p className="onb-note small">数据只保存在这台设备上，可以随时在菜单里备份。</p>
      </div>
    </main>
  );
}
