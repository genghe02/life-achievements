import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { today } from '../../domain/dates';
import { blankData } from '../../domain/templates';
import { IMPORT_ERRORS } from '../../domain/validate';
import { resetPwaForTests, setInstallEventForTests } from '../../pwa';
import * as persist from '../../store/persist';
import { useStore } from '../../store/store';
import { clearToasts, getToasts } from '../fx/toastQueue';
import { useUi } from '../uiStore';
import { backupFileName, formatStamp, INSTALL_STEPS, MAX_IMPORT_BYTES, MenuModal, previewBackup, STORAGE_LINE, STORAGE_WARN, TOO_BIG } from './MenuModal';

// media.ts caches its MediaQueryLists, so the phone layout is switched here instead of via matchMedia
let phone = false;
vi.mock('../hooks/media', async importOriginal => ({
  ...(await importOriginal<typeof import('../hooks/media')>()),
  usePhone: () => phone,
}));

vi.mock('../../store/persist', async importOriginal => {
  const orig = await importOriginal<typeof import('../../store/persist')>();
  return {
    ...orig,
    lastBackup: vi.fn(async () => null),
    listSnapshots: vi.fn(async () => []),
    loadSnapshot: vi.fn(async () => null),
    storageKind: vi.fn(() => 'indexeddb'),
  };
});

const s = () => useStore.getState();
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const section = (title: string) => screen.getByRole('region', { name: title });

// performance.now() drives the two-step guard (a second press within 450 ms is ignored)
let clock = 0;

beforeEach(() => {
  act(() => s().start('starter'));
  useUi.setState({ sel: null, overview: false, modal: { kind: 'menu' }, arrange: false, centerReq: null });
  clock += 1e6;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.mocked(persist.lastBackup).mockResolvedValue(null);
  vi.mocked(persist.listSnapshots).mockResolvedValue([]);
  vi.mocked(persist.loadSnapshot).mockResolvedValue(null);
  vi.mocked(persist.storageKind).mockReturnValue('indexeddb');
  clearToasts();
});

afterEach(() => {
  phone = false;
  cleanup();
  vi.restoreAllMocks();
  resetPwaForTests();
  clearToasts();
});

/** Two presses far enough apart to confirm. */
function confirmTwice(name: string | RegExp, armedName: string | RegExp) {
  fireEvent.click(button(name));
  clock += 500;
  fireEvent.click(button(armedName));
}

async function chooseFile(text: string, name = 'backup.json', size?: number) {
  const input = document.querySelector<HTMLInputElement>('.file-btn input[type=file]')!;
  const file = new File([text], name, { type: 'application/json' });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

describe('MenuModal sections', () => {
  it('shows level, rank, totals and one bar per area', () => {
    act(() => { s().complete('o_start'); });
    render(<MenuModal />);
    const stats = section('统计');
    expect(stats.querySelector('.ov-stats')?.textContent).toContain('1/97');
    expect(stats.textContent).toContain('人生等级 · 新手');
    const rows = stats.querySelectorAll('.stat-rows li');
    expect(rows).toHaveLength(7);
    expect(rows[0].textContent).toBe('起源1/14');
    expect(rows[1].textContent).toContain('未解锁');
  });

  it('toggles sound and labels', () => {
    render(<MenuModal />);
    const sound = within(section('设置')).getByRole('switch', { name: '音效' });
    expect(sound.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sound);
    expect(s().data.settings.sound).toBe(false);
    expect(sound.textContent).toBe('关');
    fireEvent.click(within(section('设置')).getByRole('switch', { name: '树上显示名称' }));
    expect(s().data.settings.labels).toBe(false);
  });

  it('says where data lives, the last backup, and warns without IndexedDB', async () => {
    vi.mocked(persist.lastBackup).mockResolvedValue('2026-09-30');
    vi.mocked(persist.storageKind).mockReturnValue('localstorage');
    render(<MenuModal />);
    const data = section('数据');
    await waitFor(() => expect(data.querySelector('.mnote')?.textContent).toBe(`${STORAGE_LINE}上次备份：2026-09-30。`));
    expect(data.querySelector('.mwarn')?.textContent).toBe(STORAGE_WARN.localstorage);
  });

  it('without any storage, warns instead of claiming the data is kept', async () => {
    vi.mocked(persist.storageKind).mockReturnValue('memory');
    render(<MenuModal />);
    const data = section('数据');
    await waitFor(() => expect(data.querySelector('.mnote')?.textContent).toBe('还没有备份过。'));
    expect(data.textContent).not.toContain(STORAGE_LINE);
    expect(data.querySelector('.mwarn')?.textContent).toBe(STORAGE_WARN.memory);
  });

  it('says when there was no backup yet and shows no warning with IndexedDB', async () => {
    render(<MenuModal />);
    const data = section('数据');
    await waitFor(() => expect(data.querySelector('.mnote')?.textContent).toBe(`${STORAGE_LINE}还没有备份过。`));
    expect(data.querySelector('.mwarn')).toBeNull();
  });

  it('closes with ×', () => {
    render(<MenuModal />);
    fireEvent.click(button('关闭'));
    expect(useUi.getState().modal).toBeNull();
  });
});

describe('导出备份', () => {
  it('downloads the backup file as life-achievements-YYYY-MM-DD.json', async () => {
    act(() => { s().complete('o_start', { note: '开局' }); });
    let blob: Blob | null = null;
    const create = vi.fn((b: Blob) => { blob = b; return 'blob:test'; });
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    let clicked: { download: string; href: string } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = { download: this.download, href: this.getAttribute('href') ?? '' };
    });
    render(<MenuModal />);
    // the live region exists (empty) before the message arrives, so screen readers announce it
    const live = within(section('数据')).getByRole('status');
    expect(live.textContent).toBe('');
    fireEvent.click(button('导出备份'));
    expect(within(section('数据')).getByRole('status')).toBe(live);

    expect(backupFileName('2026-10-10')).toBe('life-achievements-2026-10-10.json');
    expect(clicked).toEqual({ download: `life-achievements-${today()}.json`, href: 'blob:test' });
    expect(blob!.type).toBe('application/json');
    const file = JSON.parse(await blob!.text());
    expect(file).toMatchObject({ app: 'life-achievements', version: 1 });
    expect(Number.isNaN(Date.parse(file.exportedAt))).toBe(false);
    expect(file.data.achievements).toHaveLength(97);
    expect(file.data.done.o_start).toMatchObject({ note: '开局' });
    // nothing left behind in the page
    expect(document.querySelector('a[download]')).toBeNull();
    expect(screen.getByText(`已导出「life-achievements-${today()}.json」。`)).toBeTruthy();
    expect(section('数据').querySelector('.mnote')?.textContent).toContain(`上次备份：${today()}。`);
  });
});

describe('导入备份', () => {
  it('shows a summary and replaces the data only after the two-step confirm', async () => {
    act(() => { s().complete('o_start'); });
    const backup = s().exportBackup();
    act(() => s().start('blank'));
    render(<MenuModal />);

    await chooseFile(JSON.stringify(backup), 'life-achievements-2026-10-01.json');
    const sum = document.querySelector('.msum')!;
    expect(sum.textContent).toContain('「life-achievements-2026-10-01.json」');
    expect(sum.textContent).toContain('领域：7 个');
    expect(sum.textContent).toContain('进度：97 个');
    expect(sum.textContent).toContain('已达成：1 个');
    expect(sum.textContent).toContain(`导出时间：${formatStamp(backup.exportedAt)}`);
    // nothing replaced yet
    expect(s().data.achievements).toHaveLength(7);

    const go = button('用这份备份替换现在的数据');
    expect(document.activeElement).toBe(go);
    fireEvent.click(go);
    expect(go.className).toBe('btn danger armed');
    expect(go.textContent).toBe('再点一次确认替换');
    // a double-click's second press is ignored
    clock += 200;
    fireEvent.click(go);
    expect(s().data.achievements).toHaveLength(7);
    clock += 400;
    fireEvent.click(go);
    expect(s().data.achievements).toHaveLength(97);
    expect(s().data.done.o_start).toBeDefined();
    expect(useUi.getState().modal).toBeNull();
    expect(getToasts().items.map(t => t.l1)).toContain('备份已导入');
  });

  it('disarms after 4 s and can be cancelled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      render(<MenuModal />);
      await chooseFile(JSON.stringify(s().exportBackup()));
      fireEvent.click(button('用这份备份替换现在的数据'));
      expect(button('再点一次确认替换')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(button('用这份备份替换现在的数据').className).toBe('btn danger');
      fireEvent.click(button('取消'));
      expect(document.querySelector('.msum')).toBeNull();
      // focus goes back next to 导入备份 instead of being lost with the summary
      expect(document.activeElement).toBe(document.querySelector('.file-btn input[type=file]'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows why a file cannot be imported and keeps the data', async () => {
    render(<MenuModal />);
    const before = s().data;
    await chooseFile('{"hello": 1}');
    expect(document.querySelector('.msec .mwarn')?.textContent).toBe(IMPORT_ERRORS.notOurs);
    expect(document.querySelector('.msum')).toBeNull();
    await chooseFile('not json at all');
    expect(document.querySelector('.msec .mwarn')?.textContent).toBe(IMPORT_ERRORS.unreadable);
    await chooseFile('[1, 2]');
    expect(document.querySelector('.msec .mwarn')?.textContent).toBe(IMPORT_ERRORS.notOurs);
    await chooseFile('');
    expect(document.querySelector('.msec .mwarn')?.textContent).toBe(IMPORT_ERRORS.unreadable);
    expect(s().data).toBe(before);
  });

  it('turns away a file too big to be a backup without reading it', async () => {
    render(<MenuModal />);
    const text = vi.spyOn(File.prototype, 'text');
    await chooseFile('{}', 'huge.json', MAX_IMPORT_BYTES + 1);
    expect(document.querySelector('.msec .mwarn')?.textContent).toBe(TOO_BIG);
    expect(text).not.toHaveBeenCalled();
    expect(document.querySelector('.msum')).toBeNull();
  });

  it('previewBackup accepts a bare document and a BOM', () => {
    const bare = previewBackup('﻿' + JSON.stringify(blankData()));
    expect(bare.ok && bare.preview).toMatchObject({ areas: 7, nodes: 7, done: 0, exportedAt: null });
    expect(previewBackup(JSON.stringify({ app: 'life-achievements', version: 9, data: blankData() }))).toEqual({ ok: false, error: IMPORT_ERRORS.newer });
  });
});

describe('自动快照', () => {
  it('lists snapshots and restores one after the two-step confirm', async () => {
    const snap = blankData();
    vi.mocked(persist.listSnapshots).mockResolvedValue([
      { date: today(), done: 0, all: 97 },
      { date: '2026-10-01', done: 0, all: 7 },
    ]);
    vi.mocked(persist.loadSnapshot).mockResolvedValue(snap);
    render(<MenuModal />);
    await waitFor(() => expect(document.querySelectorAll('.snaps li')).toHaveLength(2));
    const rows = document.querySelectorAll('.snaps li');
    expect(rows[0].textContent).toContain('（今天）');
    expect(rows[1].textContent).toContain('2026-10-01');
    expect(rows[1].textContent).toContain('已达成 0/7');
    expect(document.querySelector('.msnaps summary')?.textContent).toBe('自动快照（2）');

    const restore = rows[1].querySelector('button')!;
    fireEvent.click(restore);
    expect(restore.textContent).toBe('再点一次恢复');
    expect(persist.loadSnapshot).not.toHaveBeenCalled();
    clock += 500;
    await act(async () => { fireEvent.click(restore); });
    expect(persist.loadSnapshot).toHaveBeenCalledWith('2026-10-01');
    expect(s().data.achievements).toHaveLength(7);
    expect(useUi.getState().modal).toBeNull();
    expect(getToasts().items.at(-1)).toMatchObject({ l1: '已恢复', l2: '回到 2026-10-01 的数据' });
  });

  it('says so when a snapshot cannot be read', async () => {
    vi.mocked(persist.listSnapshots).mockResolvedValue([{ date: '2026-10-01', done: 0, all: 7 }]);
    render(<MenuModal />);
    await waitFor(() => expect(document.querySelectorAll('.snaps li')).toHaveLength(1));
    const restore = document.querySelector<HTMLButtonElement>('.snaps li button')!;
    fireEvent.click(restore);
    clock += 500;
    await act(async () => { fireEvent.click(restore); });
    expect(document.querySelector('.msec .mwarn')?.textContent).toBe('这一天的快照读不出来了，换一天试试。');
    expect(s().data.achievements).toHaveLength(97);
    expect(useUi.getState().modal).toEqual({ kind: 'menu' });
  });

  it('explains when there are none yet', async () => {
    render(<MenuModal />);
    await waitFor(() => expect(screen.getByText('还没有自动快照。')).toBeTruthy());
  });
});

describe('重新开始', () => {
  it('needs a choice, then two presses', () => {
    act(() => { s().complete('o_start'); });
    render(<MenuModal />);
    const go = button('确认重新开始');
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '空白开始' }));
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    expect(s().data.achievements).toHaveLength(97);
    // switching the choice disarms
    fireEvent.click(screen.getByRole('radio', { name: '示例模板' }));
    expect(button('确认重新开始')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '空白开始' }));
    confirmTwice('确认重新开始', '再点一次重新开始');
    expect(s().data.achievements).toHaveLength(7);
    expect(Object.keys(s().data.done)).toHaveLength(0);
    expect(useUi.getState().modal).toBeNull();
    expect(getToasts().items.at(-1)).toMatchObject({ l1: '已重新开始' });
  });

  it('keeps sound and label settings', () => {
    act(() => s().setSettings({ sound: false }));
    render(<MenuModal />);
    fireEvent.click(screen.getByRole('radio', { name: '示例模板' }));
    confirmTwice('确认重新开始', '再点一次重新开始');
    expect(s().data.settings.sound).toBe(false);
  });
});

describe('添加到主屏幕', () => {
  it('is hidden on a desktop browser that offers no install', () => {
    render(<MenuModal />);
    expect(screen.queryByRole('region', { name: '添加到主屏幕' })).toBeNull();
  });

  it('offers 安装 when the browser captured an install prompt', async () => {
    const ev = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    ev.prompt = vi.fn(async () => {});
    ev.userChoice = Promise.resolve({ outcome: 'accepted' });
    setInstallEventForTests(ev);
    render(<MenuModal />);
    const sec = section('添加到主屏幕');
    await act(async () => { fireEvent.click(within(sec).getByRole('button', { name: '安装' })); });
    expect(ev.prompt).toHaveBeenCalled();
    expect(section('添加到主屏幕').textContent).toContain('已经装好了，以后可以像应用一样直接打开。');
  });

  it('shows the Safari steps on an iPhone', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1');
    render(<MenuModal />);
    const steps = [...section('添加到主屏幕').querySelectorAll('ol.steps li')].map(li => li.textContent);
    expect(steps).toEqual(['点底部的「分享」按钮（新版 Safari 先点「⋯」）', '选「添加到主屏幕」', '点「添加」']);
  });

  it('points Chrome on iOS at its own 「分享」 button', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1');
    render(<MenuModal />);
    const steps = [...section('添加到主屏幕').querySelectorAll('ol.steps li')].map(li => li.textContent);
    expect(steps).toEqual([...INSTALL_STEPS.iosOther]);
  });

  it('shows the browser-menu steps on an Android phone without an install prompt', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36');
    phone = true;
    render(<MenuModal />);
    const steps = [...section('添加到主屏幕').querySelectorAll('ol.steps li')].map(li => li.textContent);
    expect(steps).toEqual([...INSTALL_STEPS.browser]);
  });
});
