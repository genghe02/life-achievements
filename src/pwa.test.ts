import { act } from '@testing-library/react';
import { registerSW, type RegisterSWOptions } from 'virtual:pwa-register';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyUpdate,
  installPlatform,
  isStandalone,
  promptInstall,
  requestPersist,
  resetPwaForTests,
  setInstallEventForTests,
  setupPwa,
  usePwa,
} from './pwa';
import { useStore } from './store/store';
import { clearToasts, getToasts } from './ui/fx/toastQueue';

const update = vi.fn(async () => {});
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => update) }));
/** What setupPwa handed registerSW (it registers once per page; vitest clears mock calls between tests). */
let registered: RegisterSWOptions | null = null;

afterEach(() => {
  resetPwaForTests();
  vi.unstubAllGlobals();
});

const fakePrompt = (outcome: 'accepted' | 'dismissed') => {
  const ev = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  ev.prompt = vi.fn(async () => {});
  ev.userChoice = Promise.resolve({ outcome });
  return ev;
};

describe('installPlatform', () => {
  it('tells iPhone, iPad (also when it claims to be a Mac), Android and the rest apart', () => {
    expect(installPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', 5)).toBe('iphone');
    expect(installPlatform('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15', 5)).toBe('ipad');
    expect(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 5)).toBe('ipad');
    expect(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 0)).toBe('other');
    expect(installPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36', 5)).toBe('android');
    expect(installPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0', 0)).toBe('other');
  });
});

describe('isStandalone', () => {
  it('is false in a browser tab and true for navigator.standalone (iOS home screen)', () => {
    expect(isStandalone()).toBe(false);
    vi.stubGlobal('navigator', { ...navigator, standalone: true });
    expect(isStandalone()).toBe(true);
  });

  it('reads display-mode: standalone', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }));
    expect(isStandalone()).toBe(true);
  });
});

describe('promptInstall', () => {
  it('shows the captured prompt once and remembers an accepted install', async () => {
    expect(await promptInstall()).toBe('unavailable');
    const ev = fakePrompt('accepted');
    setInstallEventForTests(ev);
    expect(usePwa.getState().canInstall).toBe(true);
    expect(await promptInstall()).toBe('accepted');
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(usePwa.getState()).toMatchObject({ canInstall: false, installed: true });
    expect(await promptInstall()).toBe('unavailable');
  });

  it('a dismissed prompt cannot be shown again', async () => {
    setInstallEventForTests(fakePrompt('dismissed'));
    expect(await promptInstall()).toBe('dismissed');
    expect(usePwa.getState()).toMatchObject({ canInstall: false, installed: false });
  });
});

describe('requestPersist', () => {
  it('is still exported for ui/actions.ts', async () => {
    expect(typeof requestPersist).toBe('function');
    expect(await requestPersist()).toBe(false); // jsdom has no navigator.storage
  });
});

describe('setupPwa', () => {
  it('registers once, tracks updates and the install prompt, and says 离线可用 after onboarding', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval'] });
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { serviceWorker: {} }));
    localStorage.clear();
    clearToasts();
    try {
      act(() => useStore.setState({ phase: 'new' }));
      setupPwa();
      setupPwa();
      expect(registerSW).toHaveBeenCalledTimes(1);
      const opts = vi.mocked(registerSW).mock.calls[0][0] as RegisterSWOptions;
      registered = opts;

      opts.onNeedRefresh?.();
      expect(usePwa.getState().needRefresh).toBe(true);

      const ev = new Event('beforeinstallprompt', { cancelable: true });
      window.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(usePwa.getState().canInstall).toBe(true);
      window.dispatchEvent(new Event('appinstalled'));
      expect(usePwa.getState()).toMatchObject({ canInstall: false, installed: true });

      // during onboarding the toast waits for the tree
      opts.onOfflineReady?.();
      vi.advanceTimersByTime(2000);
      expect(getToasts().items).toHaveLength(0);
      act(() => useStore.getState().start('blank'));
      vi.advanceTimersByTime(1000);
      expect(getToasts().items.map(t => t.l2)).toEqual(['已经可以离线使用了。']);
      // and only once per device
      opts.onOfflineReady?.();
      expect(getToasts().items).toHaveLength(1);

      applyUpdate();
      expect(update).toHaveBeenCalledWith(true);
      expect(usePwa.getState().updating).toBe(true);
    } finally {
      clearToasts();
      vi.useRealTimers();
    }
  });
});

describe('update checks', () => {
  it('asks for a new version hourly and when the page becomes visible, but not offline or mid-install', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      // setupPwa ran in the test above
      const opts = registered!;
      const reg = { installing: null as object | null, update: vi.fn(async () => {}) };
      opts.onRegisteredSW?.('sw.js', reg as unknown as ServiceWorkerRegistration);
      expect(reg.update).not.toHaveBeenCalled();

      document.dispatchEvent(new Event('visibilitychange'));
      expect(reg.update).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(reg.update).toHaveBeenCalledTimes(2);

      // a version already downloading is not asked for again
      reg.installing = {};
      document.dispatchEvent(new Event('visibilitychange'));
      expect(reg.update).toHaveBeenCalledTimes(2);
      reg.installing = null;

      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(reg.update).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});
