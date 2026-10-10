import { useId, useRef, useState, type FormEvent } from 'react';
import { texture } from '../../art/pixel';
import { SFX } from '../../art/sfx';
import { AREA_BGS, ICON_NAMES } from '../../domain/catalog';
import { nodesOfArea } from '../../domain/rules';
import type { AreaBg, IconName } from '../../domain/types';
import { LIMITS } from '../../store/inputs';
import { useStore } from '../../store/store';
import { useUi } from '../uiStore';
import { IconGrid } from './fields';
import { Modal } from './Modal';
import { useArm } from './useArm';

const close = () => useUi.getState().closeModal();

export const BG_NAME: Readonly<Record<AreaBg, string>> = {
  dirt: '泥土',
  grass: '草地',
  bookshelf: '书架',
  cobblestone: '圆石',
  sandstone: '砂岩',
  planks: '木板',
  end_stone: '末地石',
};

/** 新建领域 / 领域设置: name, subtitle, icon and background; on edit also order and delete. */
export function AreaEditor({ id }: { id?: string }) {
  const area = useStore(s => (id ? s.data.areas.find(a => a.id === id) : undefined));
  const index = useStore(s => (id ? s.data.areas.findIndex(a => a.id === id) : -1));
  const count = useStore(s => s.data.areas.length);
  const nodeCount = useStore(s => (id ? nodesOfArea(s.data, id).length : 0));
  const [init] = useState(() => (id ? useStore.getState().data.areas.find(a => a.id === id) : undefined));

  const [name, setName] = useState(init?.name ?? '');
  const [subtitle, setSubtitle] = useState(init?.subtitle ?? '');
  const [ic, setIc] = useState<IconName>(init?.icon ?? ICON_NAMES[0]);
  const [bg, setBg] = useState<AreaBg>(init?.bg ?? 'grass');
  const [err, setErr] = useState('');
  const [delErr, setDelErr] = useState('');
  const { armed, press } = useArm();
  const formId = useId();
  const moveRef = useRef<HTMLDivElement>(null);

  if (id && !area) {
    return (
      <Modal title="领域设置" onClose={close}>
        <p className="mnote">找不到这个领域，刷新后再试。</p>
      </Modal>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const st = useStore.getState();
    const r = st.saveArea({ name, subtitle, icon: ic, bg }, id);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    SFX.click();
    close();
    if (!id) {
      st.setArea(r.id);
      useUi.getState().select(null);
    }
  };

  const move = (dir: -1 | 1) => {
    if (!id) return;
    SFX.click();
    useStore.getState().moveArea(id, dir);
    // at either end the pressed button turns disabled: hand focus to the other one
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a instanceof HTMLButtonElement && !a.disabled && moveRef.current?.contains(a)) return;
      moveRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });
  };

  const remove = () => {
    if (!id) return;
    const st = useStore.getState();
    // the last area can't go: say so on the first click
    if (st.data.areas.length <= 1) {
      const r = st.deleteArea(id);
      setDelErr(r.ok ? '' : r.error);
      return;
    }
    setDelErr('');
    if (!press('del')) {
      SFX.click();
      return;
    }
    const r = st.deleteArea(id);
    if (!r.ok) {
      setDelErr(r.error);
      return;
    }
    SFX.click();
    close();
  };

  const footer = (
    <>
      <p className="ferr dmsg small" role="alert">{err}</p>
      <button className="btn go" type="submit" form={formId}>{id ? '保存' : '创建领域'}</button>
      <button className="btn" type="button" onClick={close}>取消</button>
    </>
  );

  return (
    <Modal title={id ? '领域设置' : '新建领域'} onClose={close} footer={footer}>
      <form className="form" id={formId} noValidate onSubmit={submit}>
        {!id && <p className="mnote small">每个领域是一棵自己的进度树。新领域会带一个起点进度「新的开始」，之后可以改名、往后添加进度。</p>}
        <div className="row">
          <label className="field aname">
            <span className="small">名称（最多 {LIMITS.areaName} 个字）</span>
            <input className="inp" maxLength={LIMITS.areaName} placeholder="比如：音乐" value={name} onChange={e => setName(e.target.value)} data-autofocus="" />
          </label>
          <label className="field asub">
            <span className="small">副标题（可不填）</span>
            <input className="inp" maxLength={LIMITS.areaSubtitle} placeholder="比如：学会一样乐器" value={subtitle} onChange={e => setSubtitle(e.target.value)} />
          </label>
        </div>
        <IconGrid value={ic} onChange={setIc} />
        <fieldset className="field">
          <legend className="small">背景</legend>
          <div className="seg">
            {AREA_BGS.map(b => (
              <label key={b}>
                <input type="radio" name={`${formId}-bg`} value={b} checked={bg === b} onChange={() => setBg(b)} />
                <span className="swatch" style={{ backgroundImage: `url(${texture(b)})` }} />
                {BG_NAME[b]}
              </label>
            ))}
          </div>
        </fieldset>
        {id && (
          <div className="dsec">
            <h3>位置</h3>
            <div className="mrow" ref={moveRef}>
              <button className="btn sm" type="button" disabled={index <= 0} onClick={() => move(-1)}>← 左移</button>
              <button className="btn sm" type="button" disabled={index < 0 || index >= count - 1} onClick={() => move(1)}>右移 →</button>
              <span className="small mnote num">第 {index + 1} 个，共 {count} 个</span>
            </div>
          </div>
        )}
        {id && (
          <div className="dsec">
            <h3>删除</h3>
            <p className="mnote small">删除后，这个领域的 {nodeCount} 个进度和完成记录都会一起删掉。</p>
            <div className="mrow">
              <button className={armed === 'del' ? 'btn danger armed' : 'btn danger'} type="button" onClick={remove}>
                {armed === 'del' ? `再点一次删除（${nodeCount} 个进度会删掉）` : '删除这个领域'}
              </button>
            </div>
            <p className="ferr small" role="alert">{delErr}</p>
          </div>
        )}
      </form>
    </Modal>
  );
}
