// Service worker (vite-plugin-pwa in prompt mode), the 「有新版本」 state behind <UpdateBar/>, the
// captured install prompt behind the menu's 「安装」 button, and the persistent-storage request.

import { registerSW } from 'virtual:pwa-register';
import { create } from 'zustand';
import { icon } from './art/pixel';
import { useStore } from './store/store';
import { toast } from './ui/fx/toastQueue';

export { requestPersist } from './store/persist';

/** Chromium's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export interface PwaState {
  /** A new version is installed and waiting: the update bar shows. */
  needRefresh: boolean;
  /** 「更新」 was pressed; the page reloads once the new version takes over. */
  updating: boolean;
  /** The browser offered an install prompt (Chrome, Edge, Android) that the menu can show. */
  canInstall: boolean;
  /** The app was installed during this visit. */
  installed: boolean;
}

export const usePwa = create<PwaState>()(() => ({ needRefresh: false, updating: false, canInstall: false, installed: false }));

const OFFLINE_KEY = 'life-achievements:offline-ready';
const UPDATE_CHECK_MS = 60 * 60 * 1000;
const OFFLINE_TOAST_DELAY_MS = 800;
/** If the new version has not taken over by then, reload anyway. */
const UPDATE_FALLBACK_MS = 4000;

let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let installEvent: BeforeInstallPromptEvent | null = null;
let started = false;

/** Show 「已经可以离线使用了。」 once per device (until site data is cleared). */
function offlineReadyOnce(): void {
  const show = () => {
    try {
      if (localStorage.getItem(OFFLINE_KEY)) return;
      localStorage.setItem(OFFLINE_KEY, '1');
    } catch {
      // no storage: show it this once
    }
    toast({ icon: icon('compass'), kind: 'info', l1: '离线可用', l2: '已经可以离线使用了。' });
  };
  if (useStore.getState().phase === 'ready') {
    show();
    return;
  }
  // first launch: keep the title screen clear and say it once the tree is up
  const stop = useStore.subscribe(st => {
    if (st.phase !== 'ready') return;
    stop();
    setTimeout(show, OFFLINE_TOAST_DELAY_MS);
  });
}

/** Register the service worker, watch for updates and keep the install prompt for the menu. */
export function setupPwa(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('beforeinstallprompt', e => {
    // keep it for the menu's 「安装」 button instead of the browser's own mini bar
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    usePwa.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    usePwa.setState({ canInstall: false, installed: true });
  });

  if (!('serviceWorker' in navigator)) return;
  updateSW = registerSW({
    onNeedRefresh: () => usePwa.setState({ needRefresh: true }),
    onOfflineReady: offlineReadyOnce,
    onRegisteredSW: (_url, reg) => {
      if (!reg) return;
      // an app left open for days still learns about new versions
      const check = () => {
        if (navigator.onLine && reg.installing === null) void reg.update().catch(() => {});
      };
      setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
    onRegisterError: e => console.warn('life-achievements: service worker registration failed', e),
  });
}

/** 「更新」: activate the waiting version; the page reloads when it takes over. */
export function applyUpdate(): void {
  if (usePwa.getState().updating) return;
  usePwa.setState({ updating: true });
  const reload = () => window.location.reload();
  if (!updateSW) {
    reload();
    return;
  }
  void updateSW(true).catch(reload);
  setTimeout(reload, UPDATE_FALLBACK_MS);
}

/** × on the update bar: hide it until the next launch (the new version still waits). */
export function dismissUpdate(): void {
  usePwa.setState({ needRefresh: false });
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/** Show the browser's install dialog captured from beforeinstallprompt. It can be used once. */
export async function promptInstall(): Promise<InstallOutcome> {
  const ev = installEvent;
  if (!ev) return 'unavailable';
  installEvent = null;
  usePwa.setState({ canInstall: false });
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'accepted') usePwa.setState({ installed: true });
    return outcome;
  } catch {
    return 'unavailable';
  }
}

/** Running as an installed app (home-screen icon), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

export type InstallPlatform = 'iphone' | 'ipad' | 'android' | 'other';

/** Which 「添加到主屏幕」 steps fit this device. iPadOS reports itself as a Mac with touch. */
export function installPlatform(
  ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  touchPoints: number = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0,
): InstallPlatform {
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ipad';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

/** Tests: forget the captured prompt and the update state. */
export function resetPwaForTests(): void {
  installEvent = null;
  updateSW = null;
  usePwa.setState({ needRefresh: false, updating: false, canInstall: false, installed: false });
}

/** Tests: pretend the browser offered an install prompt. */
export function setInstallEventForTests(ev: Event | null): void {
  installEvent = ev as BeforeInstallPromptEvent | null;
  usePwa.setState({ canInstall: !!ev });
}

/** Tests: provide the update function registerSW would return. */
export function setUpdateSWForTests(fn: ((reloadPage?: boolean) => Promise<void>) | null): void {
  updateSW = fn;
}
