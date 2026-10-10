// The ≡ menu: 统计, 设置, 数据 (backup export / import, daily snapshots), 添加到主屏幕 and 重新开始.

import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { icon, XPORB } from '../../art/pixel';
import { setSound, SFX } from '../../art/sfx';
import { today } from '../../domain/dates';
import { levelOf, rankOf, totals } from '../../domain/level';
import { areaLocked, isDone, nodesOfArea } from '../../domain/rules';
import type { LifeData } from '../../domain/types';
import { IMPORT_ERRORS, parseBackup } from '../../domain/validate';
import { installPlatform, isStandalone, promptInstall, usePwa } from '../../pwa';
import type { StartKind } from '../../store/contract';
import { lastBackup, listSnapshots, loadSnapshot, storageKind, type SnapshotInfo } from '../../store/persist';
import { useStore } from '../../store/store';
import { resetHud } from '../fx/hudFx';
import { toast, type ToastInput } from '../fx/toastQueue';
import { usePhone } from '../hooks/media';
import { useUi } from '../uiStore';
import { Modal } from './Modal';
import { useArm } from './useArm';

/** Larger files are not one of our backups (the full template is about 60 KB). */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const TOO_BIG = '这个文件太大了，不是人生成就系统的备份，换一个文件试试。';

export const STORAGE_LINE = '数据只保存在这台设备的浏览器里。';
export const STORAGE_WARN = {
  localstorage: '浏览器不支持本地数据库，数据存得不够稳，记得常备份。',
  memory: '这个浏览器现在存不了数据，关掉页面就会全部丢失。关掉前先导出备份。',
} as const;

export function backupFileName(date: string = today()): string {
  return `life-achievements-${date}.json`;
}

export interface BackupPreview {
  /** What importBackup gets: the file's parsed JSON. */
  file: unknown;
  areas: number;
  nodes: number;
  done: number;
  /** ISO timestamp from the file, if it has one. */
  exportedAt: string | null;
}

/** Read a backup file's text: the summary shown before replacing anything, or the reason it can't be used. */
export function previewBackup(text: string): { ok: true; preview: BackupPreview } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, error: IMPORT_ERRORS.unreadable };
  }
  const parsed = parseBackup(raw);
  if (!parsed.ok) return parsed;
  const data = parsed.data;
  const at = typeof raw === 'object' && raw !== null ? (raw as { exportedAt?: unknown }).exportedAt : undefined;
  return {
    ok: true,
    preview: {
      file: raw,
      areas: data.areas.length,
      nodes: data.achievements.length,
      done: totals(data).done,
      exportedAt: typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : null,
    },
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date and time, e.g. 2026-10-10 20:15. */
export function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${today(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Save text as a file through a temporary download link. */
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  // some browsers read the blob after click() returns
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** After the data was replaced (import, snapshot, restart): close the menu and say what happened. */
function afterReplace(t: ToastInput): void {
  resetHud();
  const ui = useUi.getState();
  ui.select(null);
  ui.setArrange(false);
  ui.closeModal();
  toast(t);
}

type Arm = ReturnType<typeof useArm>;

/** Two-step buttons (the demo's reset rules, see useArm): the confirming press runs the action. */
function pressArmed(arm: Arm, key: string, run: () => void): void {
  const arming = arm.armed !== key;
  if (arm.press(key)) run();
  else if (arming) SFX.click();
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section className={className ? `msec ${className}` : 'msec'} aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

// ---------- 统计 ----------

function areaRows(data: LifeData) {
  return data.areas.map(a => {
    const ns = nodesOfArea(data, a.id);
    return { id: a.id, name: a.name, icon: a.icon, all: ns.length, done: ns.filter(n => isDone(data, n.id)).length, locked: areaLocked(data, a.id) };
  });
}

function Stats() {
  const data = useStore(s => s.data);
  const t = totals(data);
  const lv = levelOf(t.xp);
  return (
    <Section title="统计">
      <div className="ov-stats small">
        <div><b className="num">{lv.level}</b><span>人生等级 · {rankOf(lv.level)}</span></div>
        <div><b className="num">{t.done}/{t.all}</b><span>已达成进度</span></div>
        <div><b className="num">{t.xp}</b><span>累计经验</span></div>
        <div><b className="num">{t.earned}</b><span>累计绿宝石</span></div>
        <div><b className="num">{t.spent}</b><span>交易花掉</span></div>
        <div><b className="num">{t.emeralds}</b><span>现有绿宝石</span></div>
      </div>
      <p className="mnote small mxp">
        <img src={XPORB} alt="" />
        <span>距离 {lv.level + 1} 级还差 <span className="num">{lv.need - lv.cur}</span> 经验</span>
      </p>
      <ul className="stat-rows small">
        {areaRows(data).map(r => (
          <li key={r.id}>
            <img src={icon(r.icon)} alt="" />
            <span>{r.name}</span>
            <div className="ov-bar" aria-hidden="true"><i style={{ width: `${(r.all ? (r.done / r.all) * 100 : 0).toFixed(1)}%` }} /></div>
            <span className="num">{r.locked ? '未解锁' : `${r.done}/${r.all}`}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------- 设置 ----------

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <div>
      <span id={id}>{label}</span>
      <button className="btn sm" type="button" role="switch" aria-checked={on} aria-labelledby={id} onClick={() => onChange(!on)}>
        {on ? '开' : '关'}
      </button>
    </div>
  );
}

function Settings() {
  const sound = useStore(s => s.data.settings.sound);
  const labels = useStore(s => s.data.settings.labels);
  return (
    <Section title="设置" className="settings">
      <Toggle
        label="音效"
        on={sound}
        onChange={on => {
          // App syncs the sound switch after render; set it now so turning it on clicks right away
          setSound(on);
          useStore.getState().setSettings({ sound: on });
          SFX.click();
        }}
      />
      <Toggle
        label="树上显示名称"
        on={labels}
        onChange={on => {
          useStore.getState().setSettings({ labels: on });
          SFX.click();
        }}
      />
    </Section>
  );
}

// ---------- 数据 ----------

interface Pending extends BackupPreview {
  name: string;
}

function Snapshots({ arm, setError }: { arm: Arm; setError: (e: string) => void }) {
  const [list, setList] = useState<SnapshotInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    listSnapshots().then(
      l => { if (live) setList(l); },
      () => { if (live) setList([]); },
    );
    return () => { live = false; };
  }, []);

  const restore = async (date: string) => {
    setError('');
    let data: LifeData | null = null;
    try {
      data = await loadSnapshot(date);
    } catch {
      data = null;
    }
    if (!data) {
      setError('这一天的快照读不出来了，换一天试试。');
      return;
    }
    const r = useStore.getState().importBackup(data);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    afterReplace({ icon: icon('clock'), kind: 'info', l1: '已恢复', l2: `回到 ${date} 的数据` });
  };

  const day = today();
  return (
    <details className="adv msnaps">
      <summary>自动快照{list?.length ? `（${list.length}）` : ''}</summary>
      <p className="mnote small">每天第一次改动前，会自动留一份当时的数据，保留最近 14 天。</p>
      {list && !list.length && <p className="mnote small">还没有自动快照。</p>}
      {!!list?.length && (
        <ul className="snaps">
          {list.map(s => {
            const key = `snap:${s.date}`;
            const armed = arm.armed === key;
            return (
              <li key={s.date}>
                <span className="sd">
                  <span className="num">{s.date}{s.date === day ? '（今天）' : ''}</span>
                  <span className="small">已达成 <span className="num">{s.done}/{s.all}</span></span>
                </span>
                <button
                  className={armed ? 'btn sm danger armed' : 'btn sm'}
                  type="button"
                  data-date={s.date}
                  onClick={() => pressArmed(arm, key, () => void restore(s.date))}
                >
                  {armed ? '再点一次恢复' : '恢复到这一天'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

function Data({ arm }: { arm: Arm }) {
  const [last, setLast] = useState<string | null | undefined>(undefined);
  const [ok, setOk] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const kind = storageKind();

  useEffect(() => {
    let live = true;
    lastBackup().then(
      d => { if (live) setLast(d); },
      () => { if (live) setLast(null); },
    );
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const btn = confirmRef.current;
    if (!pending || !btn) return;
    btn.focus({ preventScroll: true });
    // bring the whole summary into view, not just the button
    btn.closest('.msum')?.scrollIntoView?.({ block: 'nearest' });
  }, [pending]);

  const exportNow = () => {
    SFX.click();
    setError('');
    try {
      const file = useStore.getState().exportBackup();
      const name = backupFileName();
      download(name, JSON.stringify(file, null, 2));
      setLast(today());
      setOk(`已导出「${name}」。`);
    } catch (e) {
      console.error('life-achievements: export failed', e);
      setOk('');
      setError('导出没有成功，再试一次。');
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const f = input.files?.[0];
    // allow picking the same file again
    input.value = '';
    if (!f) return;
    arm.disarm();
    setOk('');
    setError('');
    setPending(null);
    if (f.size > MAX_IMPORT_BYTES) {
      setError(TOO_BIG);
      return;
    }
    let text: string;
    try {
      text = await f.text();
    } catch {
      setError(IMPORT_ERRORS.unreadable);
      return;
    }
    const r = previewBackup(text);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPending({ ...r.preview, name: f.name });
  };

  const confirmImport = () => {
    if (!pending) return;
    const r = useStore.getState().importBackup(pending.file);
    if (!r.ok) {
      setPending(null);
      setError(r.error);
      return;
    }
    afterReplace({ icon: icon('chest'), kind: 'info', l1: '备份已导入', l2: `${pending.nodes} 个进度，已达成 ${pending.done} 个` });
  };

  const cancel = () => {
    arm.disarm();
    setPending(null);
    // the focused 取消 is about to disappear: keep keyboard users next to 导入备份
    fileRef.current?.focus({ preventScroll: true });
  };

  const armed = arm.armed === 'import';
  return (
    <Section title="数据">
      <p className="mnote small">
        {/* with nothing stored, the warning below says it instead */}
        {kind === 'memory' ? null : STORAGE_LINE}
        {last === undefined ? null : last ? `上次备份：${last}。` : '还没有备份过。'}
      </p>
      {kind !== 'indexeddb' && <p className="mwarn small">{STORAGE_WARN[kind]}</p>}
      <div className="mrow">
        <button className="btn" type="button" onClick={exportNow}>导出备份</button>
        <label className="btn file-btn">
          导入备份
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={e => void onFile(e)} />
        </label>
      </div>
      {/* a live region has to exist before its text arrives, so it stays mounted (hidden while empty) */}
      <p className={ok ? 'mok small' : 'sr-only'} role="status">{ok}</p>
      {error && <p className="mwarn small" role="alert">{error}</p>}
      {pending && (
        <div className="msum" role="group" aria-label="要导入的备份">
          <b className="msum-name">「{pending.name}」</b>
          <div className="kv small">
            <span>领域：<span className="num">{pending.areas}</span> 个</span>
            <span>进度：<span className="num">{pending.nodes}</span> 个</span>
            <span>已达成：<span className="num">{pending.done}</span> 个</span>
            <span>导出时间：<span className="num">{pending.exportedAt ? formatStamp(pending.exportedAt) : '没有记录'}</span></span>
          </div>
          <p className="mnote small">导入会用这份备份替换现在的全部数据。</p>
          <div className="mrow">
            <button
              ref={confirmRef}
              className={armed ? 'btn danger armed' : 'btn danger'}
              type="button"
              onClick={() => pressArmed(arm, 'import', confirmImport)}
            >
              {armed ? '再点一次确认替换' : '用这份备份替换现在的数据'}
            </button>
            <button className="btn" type="button" onClick={cancel}>取消</button>
          </div>
        </div>
      )}
      <Snapshots arm={arm} setError={setError} />
    </Section>
  );
}

// ---------- 添加到主屏幕 ----------

// Safari since iOS 26 keeps 「分享」 behind 「⋯」 in its default layout; Chrome, Edge and Firefox on
// iOS put it in the address bar or their menu.
const IOS_LAST = ['选「添加到主屏幕」', '点「添加」'];
export const INSTALL_STEPS = {
  iphone: ['点底部的「分享」按钮（新版 Safari 先点「⋯」）', ...IOS_LAST],
  ipad: ['点顶部的「分享」按钮（新版 Safari 先点「⋯」）', ...IOS_LAST],
  iosOther: ['点浏览器的「分享」按钮（在地址栏或菜单里）', ...IOS_LAST],
  browser: ['点浏览器的菜单按钮（通常是右上角的三个点）', '选「添加到主屏幕」或「安装应用」', '点「安装」或「添加」'],
} as const;

/** Chrome, Edge, Firefox or Opera on iOS rather than Safari. */
const iosOtherBrowser = (ua: string) => /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

function Install() {
  const phone = usePhone();
  const canInstall = usePwa(s => s.canInstall);
  const installed = usePwa(s => s.installed);
  const [msg, setMsg] = useState('');
  const platform = installPlatform();
  const ios = platform === 'iphone' || platform === 'ipad';

  if (isStandalone()) return null;
  if (installed) {
    return (
      <Section title="添加到主屏幕">
        <p className="mok small">已经装好了，以后可以像应用一样直接打开。</p>
      </Section>
    );
  }
  if (!phone && !ios && !canInstall) return null;

  const install = async () => {
    SFX.click();
    const r = await promptInstall();
    setMsg(r === 'accepted' ? '' : r === 'dismissed' ? '没有安装。以后想装，可以再回到这里。' : '');
  };

  return (
    <Section title="添加到主屏幕">
      <p className="mnote small">添加后可以像应用一样直接打开，没有网络也能用。</p>
      {ios ? (
        <ol className="steps small">
          {INSTALL_STEPS[iosOtherBrowser(navigator.userAgent) ? 'iosOther' : platform].map(s => <li key={s}>{s}</li>)}
        </ol>
      ) : canInstall ? (
        <div className="mrow"><button className="btn go" type="button" onClick={() => void install()}>安装</button></div>
      ) : (
        <ol className="steps small">{INSTALL_STEPS.browser.map(s => <li key={s}>{s}</li>)}</ol>
      )}
      {msg && <p className="mnote small">{msg}</p>}
    </Section>
  );
}

// ---------- 重新开始 ----------

const RESTART_TOAST: Record<StartKind, string> = {
  starter: '示例模板：把已经做到的勾上',
  blank: '空白开始：从每个领域的起点出发',
};

function Restart({ arm }: { arm: Arm }) {
  const [kind, setKind] = useState<StartKind | null>(null);
  const groupId = useId();
  const pick = (k: StartKind) => {
    if (k === kind) return;
    arm.disarm();
    setKind(k);
  };
  const run = () => {
    if (!kind) return;
    useStore.getState().start(kind);
    afterReplace({ icon: icon('sapling'), kind: 'info', l1: '已重新开始', l2: RESTART_TOAST[kind] });
  };
  const armed = arm.armed === 'restart';
  return (
    <Section title="重新开始">
      <p className="mnote small">清空现在的全部数据，重新选一个开始方式。建议先导出备份。</p>
      <div className="seg" role="radiogroup" aria-labelledby={groupId}>
        <span id={groupId} className="sr-only">开始方式</span>
        {([['starter', 'map', '示例模板'], ['blank', 'sapling', '空白开始']] as const).map(([k, ic, label]) => (
          <label key={k}>
            <input type="radio" name="restartKind" value={k} checked={kind === k} onChange={() => pick(k)} />
            <span className="slot mini"><img src={icon(ic)} alt="" /></span>
            {label}
          </label>
        ))}
      </div>
      <div className="mrow">
        <button
          className={armed ? 'btn danger armed' : 'btn danger'}
          type="button"
          disabled={!kind}
          onClick={() => pressArmed(arm, 'restart', run)}
        >
          {armed ? '再点一次重新开始' : '确认重新开始'}
        </button>
      </div>
    </Section>
  );
}

/** The ≡ menu. ModalHost renders it for useUi.modal.kind === 'menu'. */
export function MenuModal({ onClose }: { onClose?: () => void } = {}) {
  const arm = useArm();
  const close = onClose ?? (() => useUi.getState().closeModal());
  return (
    <Modal title="菜单" onClose={close}>
      <Stats />
      <Settings />
      <Data arm={arm} />
      <Install />
      <Restart arm={arm} />
    </Modal>
  );
}
