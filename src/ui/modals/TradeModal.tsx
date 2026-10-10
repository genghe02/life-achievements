import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ARROW, icon } from '../../art/pixel';
import { SFX } from '../../art/sfx';
import { totals } from '../../domain/level';
import type { IconName, Reward } from '../../domain/types';
import { LIMITS } from '../../store/inputs';
import { useStore } from '../../store/store';
import { toast } from '../fx/toastQueue';
import { useUi } from '../uiStore';
import { IconFold } from './fields';
import { Modal } from './Modal';
import { ARM_GUARD_MS, numOrUndef, useArm } from './useArm';

const close = () => useUi.getState().closeModal();
const NEW_COST = '12';
const NEW_ICON: IconName = 'chest';

interface RewardFormProps {
  /** Prefill (edit); empty for the add form. */
  init?: Reward;
  submitLabel: string;
  onDone: (id: string) => void;
  onCancel?: () => void;
  /** Label above the name field. */
  nameLabel: string;
}

/** Name, price and icon of a reward; used by the add form and by a row being edited. */
function RewardForm({ init, submitLabel, onDone, onCancel, nameLabel }: RewardFormProps) {
  const [name, setName] = useState(init?.name ?? '');
  const [cost, setCost] = useState(init ? String(init.cost) : NEW_COST);
  const [ic, setIc] = useState<IconName>(init?.icon ?? NEW_ICON);
  const [err, setErr] = useState('');
  // bumped after each add so the icon fold starts closed again
  const [round, setRound] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const errId = useId();
  // the add form empties itself on success: an empty submit right after that (a double click, a
  // second Enter) repeats the request that just went through, it is not a new one
  const okAt = useRef(Number.NEGATIVE_INFINITY);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() && performance.now() - okAt.current < ARM_GUARD_MS) return;
    const r = useStore.getState().saveReward({ name, cost: numOrUndef(cost) ?? Number.NaN, icon: ic }, init?.id);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    okAt.current = performance.now();
    SFX.click();
    setErr('');
    if (!init) {
      setName('');
      setCost(NEW_COST);
      setIc(NEW_ICON);
      setRound(n => n + 1);
      nameRef.current?.focus();
    }
    onDone(r.id);
  };

  // in a row being edited, Esc cancels the edit (the modal stays open)
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !onCancel || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    onCancel();
  };

  return (
    <form className="form" noValidate onSubmit={submit} onKeyDown={onKey} aria-describedby={err ? errId : undefined}>
      <div className="row">
        <label className="field">
          <span className="small">{nameLabel}</span>
          <input
            ref={nameRef}
            className="inp"
            maxLength={LIMITS.rewardName}
            placeholder="比如：买一副新耳机"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus={!!init}
          />
        </label>
        <label className="field fcost">
          <span className="small">价格（绿宝石）</span>
          <input
            className="inp num"
            type="number"
            inputMode="numeric"
            min={LIMITS.costMin}
            max={LIMITS.costMax}
            value={cost}
            onChange={e => setCost(e.target.value)}
          />
        </label>
      </div>
      <IconFold key={round} value={ic} onChange={setIc} />
      <p className="ferr small" id={errId} role="alert">{err}</p>
      <div className="mrow">
        <button className={init ? 'btn sm go' : 'btn'} type="submit">{submitLabel}</button>
        {onCancel && <button className="btn sm" type="button" onClick={onCancel}>取消</button>}
      </div>
    </form>
  );
}

/** 交易: spend emeralds on the user's own real-life rewards, edit the list, see the log. */
export function TradeModal() {
  const rewards = useStore(s => s.data.rewards);
  const trades = useStore(s => s.data.trades);
  const em = useStore(s => totals(s.data).emeralds);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const { armed, press, disarm } = useArm();
  const listRef = useRef<HTMLUListElement>(null);
  const lastBuy = useRef({ id: '', at: Number.NEGATIVE_INFINITY });

  const spent = trades.reduce((a, t) => a + t.cost, 0);
  // after a re-render: put focus on a row's 编辑 button (ids are not escaped into a selector)
  const focusEdit = (id: string) => requestAnimationFrame(() => {
    const btns = listRef.current?.querySelectorAll<HTMLElement>('[data-edit]') ?? [];
    [...btns].find(b => b.dataset.edit === id)?.focus();
  });

  const buy = (r: Reward) => {
    // the second click of a double click must not pay twice
    const now = performance.now();
    if (lastBuy.current.id === r.id && now - lastBuy.current.at < ARM_GUARD_MS) return;
    lastBuy.current = { id: r.id, at: now };
    const res = useStore.getState().buy(r.id);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setMsg('');
    SFX.trade();
    toast({ icon: icon(r.icon), kind: 'trade', l1: '交易成功！', l2: `${r.name} · -${r.cost} 绿宝石` });
    // the button turns into a disabled 「还差 N」 when this was the last affordable one
    if (totals(useStore.getState().data).emeralds < r.cost) focusEdit(r.id);
  };

  const remove = (r: Reward) => {
    if (!press(r.id)) return;
    const at = rewards.findIndex(x => x.id === r.id);
    useStore.getState().deleteReward(r.id);
    SFX.click();
    setMsg('');
    // the pressed button is gone: focus the row that took its place (or the add form)
    requestAnimationFrame(() => {
      const btns = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-edit]') ?? [])];
      const next = btns[Math.min(at, btns.length - 1)] ?? document.querySelector<HTMLElement>('.mscroll > form input');
      next?.focus();
    });
  };

  const startEdit = (r: Reward) => {
    SFX.click();
    disarm();
    setMsg('');
    setEditing(r.id);
  };
  const stopEdit = (id: string) => {
    setEditing(null);
    focusEdit(id);
  };

  return (
    <Modal title={<>交易 · 你有 <span className="num">{em}</span> 颗绿宝石</>} onClose={close}>
      <p className="mnote small">完成进度会得到绿宝石。像和村民交易一样，用它们换一些现实里的奖励。</p>
      {rewards.length ? (
        <ul className="trades" ref={listRef}>
          {rewards.map(r => {
            if (r.id === editing) {
              return (
                <li key={r.id} className="trade editing">
                  <RewardForm
                    init={r}
                    nameLabel="奖励名称"
                    submitLabel="保存"
                    onDone={() => stopEdit(r.id)}
                    onCancel={() => stopEdit(r.id)}
                  />
                </li>
              );
            }
            const poor = em < r.cost;
            const isArmed = armed === r.id;
            return (
              <li key={r.id} className={poor ? 'trade poor' : 'trade'}>
                <span className="cost"><img src={icon('emerald')} alt="绿宝石" /><b className="num">{r.cost}</b></span>
                <img className="arr" src={ARROW} alt="换" />
                <span className="slot"><img src={icon(r.icon)} alt="" /></span>
                <span className="tn">{r.name}</span>
                <button
                  className="btn sm tbuy"
                  type="button"
                  disabled={poor}
                  // names the reward and keeps the visible words first (voice control says what it sees)
                  aria-label={poor ? `还差 ${r.cost - em} 颗绿宝石换「${r.name}」` : `交易「${r.name}」，花 ${r.cost} 颗绿宝石`}
                  onClick={() => buy(r)}
                >
                  {poor ? `还差 ${r.cost - em}` : '交易'}
                </button>
                <span className="tact">
                  <button className="btn sm" type="button" data-edit={r.id} aria-label={`编辑「${r.name}」`} onClick={() => startEdit(r)}>编辑</button>
                  <button
                    className={isArmed ? 'btn sm danger armed' : 'btn sm danger'}
                    type="button"
                    aria-label={isArmed ? `再点一次删除「${r.name}」` : `删除「${r.name}」`}
                    onClick={() => remove(r)}
                  >
                    {isArmed ? '再点一次删除' : '删除'}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty-note small">还没有奖励。在下面添加一个，给自己一点盼头。</p>
      )}
      <p className="ferr small" role="alert">{msg}</p>
      <RewardForm key="add" nameLabel="添加一个奖励" submitLabel="添加奖励" onDone={() => setMsg('')} />
      <div className="dsec">
        <h3>交易记录 · 已花 <span className="num">{spent}</span> 颗</h3>
        <ul className="tlog small">
          {trades.length ? (
            trades.slice().reverse().map(t => (
              <li key={t.id} className="num">{t.date} · {t.name} · -{t.cost}</li>
            ))
          ) : (
            <li>还没有交易记录。</li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
