import { useId, useMemo } from 'react';
import { frame, icon } from '../../art/pixel';
import { SFX } from '../../art/sfx';
import { starterData } from '../../domain/templates';
import type { StartKind } from '../../store/contract';
import { useStore } from '../../store/store';

export const ONB_LEAD = '像 Minecraft 的进度一样，把人生里的每个成就记下来。';
export const ONB_NOTE = '数据只保存在这台设备上，可以在菜单里备份。';

interface Choice {
  kind: StartKind;
  icon: string;
  title: string;
  /** One sentence per line, so a line break never strands a word. */
  desc: string[];
}

function choices(): Choice[] {
  // count from the template itself so the copy cannot drift from the data
  const t = starterData();
  return [
    { kind: 'starter', icon: 'map', title: '示例模板', desc: [`${t.areas.length} 个领域、${t.achievements.length} 个进度。`, '把已经做到的勾上。'] },
    { kind: 'blank', icon: 'sapling', title: '空白开始', desc: ['每个领域只有一个起点。', '想做的进度自己加。'] },
  ];
}

/** First launch: a title screen with the two ways to start. */
export function Onboarding() {
  const id = useId().replace(/:/g, '');
  const list = useMemo(choices, []);

  const start = (kind: StartKind) => {
    SFX.click();
    useStore.getState().start(kind);
  };

  return (
    <main className="onb" aria-labelledby={`${id}t`}>
      <div className="onb-box">
        <header className="onb-head">
          <div className="onb-badge" aria-hidden="true">
            <img className="fr" src={frame('goal', 'done')} alt="" />
            <img className="ic" src={icon('sapling')} alt="" />
          </div>
          <h1 id={`${id}t`} className="onb-title">人生成就系统</h1>
        </header>
        <p className="onb-lead">{ONB_LEAD}</p>
        <h2 id={`${id}q`} className="sr-only">选一个开始方式</h2>
        <div className="onb-choices" role="group" aria-labelledby={`${id}q`}>
          {list.map(c => (
            <button
              key={c.kind}
              className="onb-choice"
              type="button"
              data-kind={c.kind}
              aria-labelledby={`${id}${c.kind}h`}
              aria-describedby={`${id}${c.kind}d`}
              onClick={() => start(c.kind)}
            >
              <span className="oc-h">
                <span className="slot"><img src={icon(c.icon)} alt="" /></span>
                <b id={`${id}${c.kind}h`}>{c.title}</b>
              </span>
              <span className="oc-d" id={`${id}${c.kind}d`}>
                {c.desc.map(line => <span key={line}>{line}</span>)}
              </span>
            </button>
          ))}
        </div>
        <p className="onb-note small">{ONB_NOTE}</p>
      </div>
    </main>
  );
}
