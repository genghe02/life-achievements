import { useId, useRef, type MouseEvent } from 'react';
import { icon } from '../../art/pixel';
import { ICON_NAMES } from '../../domain/catalog';
import type { IconName } from '../../domain/types';

/** Chinese names for the icon pickers (read out and shown as a tooltip). */
export const ICON_LABEL: Readonly<Record<string, string>> = {
  sapling: '树苗', apple: '苹果', bread: '面包', water: '水', bed: '床', clock: '时钟', torch: '火把', chest: '箱子',
  house: '房子', broom: '扫帚', moon: '月亮', cake: '蛋糕', boots: '靴子', heart: '爱心', dumbbell: '哑铃', carrot: '胡萝卜',
  salad: '沙拉', potion: '药水', golden_apple: '金苹果', fish: '鱼', compass: '指南针', map: '地图', boat: '船', campfire: '营火',
  book: '书', enchanted_book: '附魔书', quill: '羽毛笔', scroll: '卷轴', grad_cap: '学士帽', lantern: '灯笼', pickaxe: '镐',
  hammer: '锤子', paintbrush: '画笔', music_disc: '唱片', computer: '电脑', camera: '相机', stew: '炖菜', coin: '硬币',
  emerald: '绿宝石', gold_ingot: '金锭', diamond: '钻石', key: '钥匙', pig: '猪', medal: '奖牌', trophy: '奖杯', crown: '王冠',
  poppy: '虞美人', letter: '信', ring: '戒指', speech: '对话', bell: '铃铛', elytra: '鞘翅', ender_eye: '末影之眼', nether_star: '下界之星',
};

export const iconLabel = (name: IconName): string => ICON_LABEL[name] ?? '图标';

interface IconGridProps {
  value: IconName;
  onChange: (name: IconName) => void;
  legend?: string;
}

/** The icon chooser: a grid of radio slots. */
export function IconGrid({ value, onChange, legend = '图标' }: IconGridProps) {
  const name = useId();
  return (
    <fieldset className="field">
      <legend className="small">{legend}</legend>
      <div className="icons">
        {ICON_NAMES.map(k => (
          <label key={k} title={iconLabel(k)}>
            <input type="radio" name={name} value={k} checked={value === k} onChange={() => onChange(k)} aria-label={iconLabel(k)} />
            <img src={icon(k)} alt="" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A folded icon chooser for small forms (rewards): the summary shows the current icon, the grid
 * opens below it.
 */
export function IconFold({ value, onChange }: Omit<IconGridProps, 'legend'>) {
  const name = useId();
  const ref = useRef<HTMLDetailsElement>(null);
  // a pointer pick folds the grid away again; keyboard picks (arrow keys, detail 0) keep it open
  const picked = (e: MouseEvent) => {
    const d = ref.current;
    if (e.detail === 0 || !d) return;
    d.open = false;
    d.querySelector('summary')?.focus({ preventScroll: true });
  };
  return (
    <details className="ipick" ref={ref}>
      <summary>
        <span className="small">图标</span>
        <span className="slot mini"><img src={icon(value)} alt="" /></span>
        <span className="small ipick-name">{iconLabel(value)}</span>
        <span className="small ipick-hint">换一个</span>
      </summary>
      <div className="icons">
        {ICON_NAMES.map(k => (
          <label key={k} title={iconLabel(k)} onClick={picked}>
            <input type="radio" name={name} value={k} checked={value === k} onChange={() => onChange(k)} aria-label={iconLabel(k)} />
            <img src={icon(k)} alt="" />
          </label>
        ))}
      </div>
    </details>
  );
}
