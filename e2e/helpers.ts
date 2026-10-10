/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Shared steps for the end-to-end suite. Every test runs in a fresh browser context (empty
// IndexedDB, localStorage and service worker), so each one starts at the onboarding screen.

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export type StartKind = 'starter' | 'blank';

/** The rows of the tree: 84 px, or 76 px on a short desktop (ARCHITECTURE.md, rendering). */
export const GX = 112;
export const PAD = 56;

export const AREA_NAMES = ['起源', '体魄', '学识', '技艺', '财富', '羁绊', '远行'];

/** True when the test runs on a touch phone (the phone project). */
export const isTouch = (info: TestInfo): boolean => !!info.project.use.hasTouch;

/** Today's date (YYYY-MM-DD) as the page sees it. */
export function pageToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
}

// ---------- shell ----------

export const tabs = (page: Page): Locator => page.getByRole('tablist', { name: '人生领域' }).getByRole('tab');
export const tab = (page: Page, name: string): Locator => page.getByRole('tab', { name: new RegExp(`^${name}，`) });
export const tree = (page: Page): Locator => page.getByRole('group', { name: '进度树' });
export const detail = (page: Page): Locator => page.locator('#detail');
export const node = (page: Page, id: string): Locator => page.locator(`.node[data-id="${id}"]`);
export const tradePill = (page: Page): Locator => page.getByRole('button', { name: /^绿宝石 -?\d+，交易$/ });
export const dialog = (page: Page, name: string | RegExp): Locator => page.getByRole('dialog', { name });

export interface HudState {
  level: string;
  xp: string;
  emeralds: string;
}

/** The HUD's level, XP (cur/need) and emerald numbers as shown. */
export async function hud(page: Page): Promise<HudState> {
  return {
    level: (await page.getByTitle('人生等级').textContent())?.trim() ?? '',
    xp: (await page.locator('.hud .xp-top .num > span').first().textContent())?.trim() ?? '',
    emeralds: (await page.locator('#btnTrade .num').textContent())?.trim() ?? '',
  };
}

export async function expectHud(page: Page, want: HudState): Promise<void> {
  await expect.poll(() => hud(page), { message: 'HUD numbers' }).toEqual(want);
}

/** Open the app and pick a start on the onboarding screen. */
export async function boot(page: Page, kind: StartKind = 'starter'): Promise<void> {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '人生成就系统' })).toBeVisible();
  await page.getByRole('button', { name: kind === 'starter' ? '示例模板' : '空白开始' }).click();
  await expect(tree(page)).toBeVisible();
  await expect(tabs(page)).toHaveCount(7);
}

/** Reload and wait until the tree is back (no onboarding). */
export async function reload(page: Page): Promise<void> {
  await page.reload();
  await expect(tree(page)).toBeVisible();
}

// ---------- tree ----------

/** True when the node's centre is on screen and not covered (a tap there would reach it). */
export function hittable(page: Page, id: string): Promise<boolean> {
  return page.evaluate(nid => {
    const el = document.querySelector(`.node[data-id="${nid}"]`);
    const vp = document.getElementById('vp');
    if (!el || !vp) return false;
    const r = el.getBoundingClientRect(), v = vp.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < v.left || x > v.right || y < v.top || y > v.bottom) return false;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && el.contains(hit);
  }, id);
}

/** Tap on phones, click with the mouse elsewhere. */
export async function press(info: TestInfo, target: Locator): Promise<void> {
  if (isTouch(info)) await target.tap();
  else await target.click();
}

/** The panel's close button (phone sheet and sideways dock only). */
export async function closeSheet(page: Page): Promise<void> {
  const close = detail(page).getByRole('button', { name: '关闭' });
  if (await close.isVisible()) {
    await close.click();
    await expect(detail(page)).not.toHaveClass(/\bopen\b/);
  }
}

/**
 * Select an achievement of the current area the way a person would: tap it when it is on screen,
 * else follow its row in the detail panel, else zoom out with 「全览」 and tap it.
 */
export async function selectNode(page: Page, info: TestInfo, id: string): Promise<void> {
  const el = node(page, id);
  await expect(el).toBeAttached();
  await viewSettled(page);
  if (!(await hittable(page, id))) {
    const row = detail(page).locator(`[data-goto="${id}"]`).first();
    if (await row.isVisible()) {
      await row.click();
      await expect(el).toHaveClass(/\bsel\b/);
      await expectDetailFor(page, id);
      return;
    }
    await closeSheet(page);
    // desktop keeps the zoom buttons in the window head, phones float them over the tree
    await page.getByRole('button', { name: '全览' }).click();
    await viewSettled(page);
    await expect.poll(() => hittable(page, id), { message: `node ${id} on screen after 全览` }).toBe(true);
  }
  await press(info, el);
  await expect(el).toHaveClass(/\bsel\b/);
  await expectDetailFor(page, id);
}

/** The detail panel shows this achievement (its title, from the tree label). */
export async function expectDetailFor(page: Page, id: string): Promise<void> {
  const title = (await node(page, id).locator('.lb').textContent()) ?? '';
  await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText(title);
}

/** Select an open achievement and press 完成进度 (or 直接标记完成 for a counter). */
export async function complete(page: Page, info: TestInfo, id: string): Promise<void> {
  await selectNode(page, info, id);
  await detail(page).getByRole('button', { name: /^(完成进度|直接标记完成)$/ }).click();
  await expect(node(page, id)).toHaveClass(/\bdone\b/);
  await expect(detail(page).getByRole('button', { name: '撤销完成' })).toBeVisible();
}

/** A node's grid cell, read back from where it is drawn. Rows are relative to `refId`'s row `refY`. */
export async function cellOf(page: Page, id: string, refId: string, refY: number): Promise<{ x: number; y: number }> {
  const gy = await rowHeight(page);
  const box = async (nid: string) => node(page, nid).evaluate(e => ({ left: parseFloat((e as HTMLElement).style.left), top: parseFloat((e as HTMLElement).style.top) }));
  const a = await box(id), ref = await box(refId);
  return { x: Math.round((a.left + 26 - PAD) / GX), y: refY + Math.round((a.top - ref.top) / gy) };
}

export function rowHeight(page: Page): Promise<number> {
  return page.evaluate(() => (matchMedia('(min-width: 860px) and (max-height: 780px)').matches ? 76 : 84));
}

/** The world's current zoom: the scale of the transform the viewport last applied. */
export function zoom(page: Page): Promise<number> {
  return page.locator('.world').evaluate(e => {
    const m = /scale\(([\d.]+)\)/.exec((e as HTMLElement).style.transform);
    return m ? Number(m[1]) : new DOMMatrixReadOnly(getComputedStyle(e).transform).a;
  });
}

/** The world transform as drawn (for checks that the view did or did not move). */
export function worldTransform(page: Page): Promise<string> {
  return page.locator('.world').evaluate(e => (e as HTMLElement).style.transform);
}

/** Wait until the tree view stops moving (a pan or zoom animation has finished). */
export async function viewSettled(page: Page): Promise<void> {
  let last = '';
  await expect
    .poll(async () => {
      const t = await worldTransform(page);
      const same = t === last;
      last = t;
      return same;
    }, { message: 'tree view at rest', intervals: [120] })
    .toBe(true);
}

/** Screen point of the centre of grid cell (x, y), measured from a node whose cell is known. */
export async function cellPoint(page: Page, refId: string, ref: { x: number; y: number }, cell: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const k = await zoom(page);
  const gy = await rowHeight(page);
  const b = await node(page, refId).boundingBox();
  if (!b) throw new Error(`node ${refId} has no box`);
  return {
    x: b.x + b.width / 2 + (cell.x - ref.x) * GX * k,
    y: b.y + b.height / 2 + (cell.y - ref.y) * gy * k,
  };
}

/** A stem of the connector lines ends at this node's centre (it is drawn as connected). */
export async function hasStemInto(page: Page, id: string): Promise<boolean> {
  return page.evaluate(nid => {
    const el = document.querySelector<HTMLElement>(`.node[data-id="${nid}"]`);
    if (!el) return false;
    const cx = parseFloat(el.style.left) + 26, cy = parseFloat(el.style.top) + 26;
    return [...document.querySelectorAll('svg.links .lo path')].some(p => {
      const m = /M(-?[\d.]+) (-?[\d.]+)H(-?[\d.]+)$/.exec(p.getAttribute('d') ?? '');
      return !!m && Number(m[2]) === cy && Number(m[3]) === cx && Number(m[1]) < cx;
    });
  }, id);
}

// ---------- toasts ----------

/**
 * A toast with this first line shows up. Toasts queue (3 at a time for 4.2 s on desktop, one at a
 * time for 2.6 s on phones), so one that follows several others can take a while to appear.
 */
export async function expectToast(page: Page, l1: string, l2?: string, timeout = 10_000): Promise<void> {
  const t = page.locator('.toasts .toast').filter({ hasText: l1 });
  await expect(t.first()).toBeVisible({ timeout });
  if (l2) await expect(t.first()).toContainText(l2);
}

/**
 * Right after a completion the undo button ignores clicks for 900 ms, and right after an undo the
 * complete button does (the tail of a double click must not flip it back). The pause is that rule
 * of the app, not a wait for rendering.
 */
export async function pastFlipGuard(page: Page): Promise<void> {
  await page.waitForTimeout(950);
}

// ---------- modals ----------

/**
 * Two-step buttons ignore a second press within 450 ms (the tail of a double click). The pause is
 * that rule of the app, not a wait for rendering.
 */
export async function pressAgain(page: Page, button: Locator): Promise<void> {
  await page.waitForTimeout(500);
  await button.click();
}

export async function openMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '菜单' }).click();
  const d = dialog(page, '菜单');
  await expect(d).toBeVisible();
  return d;
}

export async function closeDialog(d: Locator): Promise<void> {
  await d.getByRole('button', { name: '关闭' }).first().click();
  await expect(d).toBeHidden();
}

/** True when the element's centre is on screen and nothing covers it (a click there reaches it). */
export function reachable(target: Locator): Promise<boolean> {
  return target.evaluate(el => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && el.contains(hit);
  });
}

/**
 * WCAG contrast of an element's text against its own (opaque) background, with the opacity of the
 * element and its ancestors blended in.
 */
export function textContrast(target: Locator): Promise<number> {
  return target.evaluate(el => {
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const cs = getComputedStyle(el);
    let alpha = 1;
    for (let e: Element | null = el; e; e = e.parentElement) alpha *= Number(getComputedStyle(e).opacity);
    const bg = rgb(cs.backgroundColor);
    // what the text looks like once it is faded into the background
    const fg = rgb(cs.color).map((v, i) => v * alpha + bg[i] * (1 - alpha));
    const lum = (c: number[]) => {
      const [r, g, b] = c.map(v => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}

/** No horizontal page scroll. */
export function overflowX(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

// ---------- dragging ----------

export interface Point {
  x: number;
  y: number;
}

/**
 * Press at `from`, move to `to` in small steps and, after `during` ran, release. With a mouse on
 * desktop; on touch phones as real touch input (Chromium's CDP touch events, which the page sees
 * as pointer events of type touch).
 */
export async function drag(page: Page, info: TestInfo, from: Point, to: Point, during?: () => Promise<void>): Promise<void> {
  const steps = 12;
  const at = (i: number) => ({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  if (!isTouch(info)) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(at(i).x, at(i).y);
    await during?.();
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: Point) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
  await touch('touchStart', from);
  for (let i = 1; i <= steps; i++) await touch('touchMove', at(i));
  await during?.();
  await touch('touchEnd');
  await cdp.detach();
}

/** The centre of a node on screen. */
export async function centreOf(page: Page, id: string): Promise<Point> {
  const b = await node(page, id).boundingBox();
  if (!b) throw new Error(`node ${id} has no box`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
