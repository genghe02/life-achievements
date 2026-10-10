/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  boot,
  centreOf,
  complete,
  detail,
  drag,
  expectHud,
  hittable,
  isTouch,
  node,
  rowHeight,
  selectNode,
  tree,
  viewSettled,
  worldTransform,
  zoom,
} from './helpers';

const zoomBtn = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function zoomTo(page: Page, k: number): Promise<void> {
  await viewSettled(page);
  await expect.poll(() => zoom(page)).toBeCloseTo(k, 2);
}

test.describe('tree view', () => {
  test('rows follow the screen: 76 px on a short desktop, 84 px otherwise', async ({ page }) => {
    await boot(page);
    const top = (id: string) => node(page, id).evaluate(e => parseFloat((e as HTMLElement).style.top));
    const gy = (await top('o_water')) - (await top('o_sleep'));
    const vp = page.viewportSize()!;
    expect(gy / 2).toBe(vp.width >= 860 && vp.height <= 780 ? 76 : 84);
    expect(gy / 2).toBe(await rowHeight(page));
  });

  test('zoom buttons step through 0.5 to 2, 全览 fits, 定位 goes home', async ({ page }) => {
    await boot(page);
    await zoomTo(page, 1);
    await zoomBtn(page, '放大').click();
    await zoomTo(page, 1.5);
    await zoomBtn(page, '放大').click();
    await zoomTo(page, 2);
    await zoomBtn(page, '放大').click();
    await zoomTo(page, 2);
    for (const k of [1.5, 1, 0.75, 0.5]) {
      await zoomBtn(page, '缩小').click();
      await zoomTo(page, k);
    }
    // below the steps it keeps going a little, as in the demo, down to 0.3
    for (const k of [0.4, 0.32, 0.3, 0.3]) {
      await zoomBtn(page, '缩小').click();
      await zoomTo(page, k);
    }
    // names are hidden at small zoom
    await expect(node(page, 'o_start').locator('.lb')).toBeHidden();
    await zoomBtn(page, '定位').click();
    await zoomTo(page, 1);
    await expect(node(page, 'o_start').locator('.lb')).toBeVisible();

    await zoomBtn(page, '全览').click();
    await viewSettled(page);
    const k = await zoom(page);
    // snapped down to a step; a tree too big for 0.5 gets the exact fit (as in the demo)
    if (k >= 0.5) expect([0.5, 0.75, 1, 1.5, 2]).toContain(Number(k.toFixed(2)));
    else expect(k).toBeGreaterThanOrEqual(0.3);
    // the whole tree is on screen
    for (const id of ['o_start', 'o_mind', 'o_wealth', 'o_tree']) expect(await hittable(page, id), id).toBe(true);
  });

  test('dragging the background pans, and the tree cannot be thrown away', async ({ page }, info) => {
    await boot(page);
    await viewSettled(page);
    const before = await worldTransform(page);
    const vp = (await tree(page).boundingBox())!;
    const from = await centreOf(page, 'o_start');
    // start just left of the root, on empty ground
    const start = { x: Math.max(vp.x + 8, from.x - 50), y: from.y - 30 };
    await drag(page, info, start, { x: start.x + 2000, y: start.y + 1500 });
    await viewSettled(page);
    expect(await worldTransform(page)).not.toBe(before);
    // the pan is clamped: some of the tree is still on screen
    const onScreen = await page.locator('#nodes .node').evaluateAll(els => {
      const v = document.getElementById('vp')!.getBoundingClientRect();
      return els.filter(e => {
        const r = e.getBoundingClientRect();
        return r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom;
      }).length;
    });
    expect(onScreen).toBeGreaterThan(0);
    // a pan is not a tap: nothing got selected
    await expect(tree(page).locator('.node.sel')).toHaveCount(0);
  });

  test('Ctrl + wheel zooms, the wheel alone pans', async ({ page }) => {
    await boot(page);
    await viewSettled(page);
    const c = await centreOf(page, 'o_water');
    await page.mouse.move(c.x, c.y);
    const before = await worldTransform(page);
    await page.mouse.wheel(0, 120);
    await viewSettled(page);
    expect(await zoom(page)).toBeCloseTo(1, 2);
    expect(await worldTransform(page)).not.toBe(before);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await viewSettled(page);
    expect(await zoom(page)).toBeGreaterThan(1);
  });

  test('a hidden achievement shows ??? until its prerequisites are done', async ({ page }, info) => {
    await boot(page);
    await expect(node(page, 'o_tree')).toHaveAccessibleName('???，挑战，未解锁');
    await selectNode(page, info, 'o_tree');
    const d = detail(page);
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('???');
    await expect(d).toContainText('这是一个隐藏进度。完成它的前置进度后，就能看到具体内容。');
    await expect(d).toContainText('+??? 经验');
    await expect(d.getByRole('button', { name: '+ 后续进度' })).toHaveCount(0);
    await expect(page.getByText('那棵树长大了')).toHaveCount(0);
  });

  test('hovering a node with the mouse shows its tooltip; a touch screen has none', async ({ page }, info) => {
    await boot(page);
    await viewSettled(page);
    const tip = page.getByRole('tooltip');
    if (isTouch(info)) {
      await node(page, 'o_water').tap();
      await expect(node(page, 'o_water')).toHaveClass(/\bsel\b/);
      await expect(tip).toHaveCount(0);
      return;
    }
    await node(page, 'o_water').hover();
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('无限水源');
    await expect(tip).toContainText('任务 · 未解锁 · +20 经验');
    await page.mouse.move(5, 5);
    await expect(tip).toHaveCount(0);
  });

  test('toasts sit at the top right of the visible tree, at most 3 on desktop and 1 on phones', async ({ page }, info) => {
    await boot(page);
    // let the one-time 「离线可用」 toast leave
    await expect(page.locator('.toasts .toast').filter({ hasText: '离线可用' })).toHaveCount(0, { timeout: 15_000 });
    for (const id of ['o_start', 'o_sleep', 'o_water', 'o_tidy']) await complete(page, info, id);
    const max = isTouch(info) ? 1 : 3;
    // sample the queue while it drains (toasts come and go on their own timers)
    for (let i = 0; i < 6; i++) {
      const n = await page.locator('.toasts .toast:not(.out)').count();
      expect(n, 'toasts on screen').toBeLessThanOrEqual(max);
      await page.waitForTimeout(300);
    }
    const box = await page.locator('.toasts .toast').first().boundingBox();
    const vp = (await tree(page).boundingBox())!;
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.x + vp.width + 1);
    expect(box!.y).toBeGreaterThanOrEqual(vp.y - 1);
    // clear of the open phone sheet / the desktop detail column
    const d = (await detail(page).boundingBox())!;
    const overlaps = box!.x < d.x + d.width && box!.x + box!.width > d.x && box!.y < d.y + d.height && box!.y + box!.height > d.y;
    expect(overlaps, 'toast over the detail panel').toBe(false);
  });

  test('two fingers pinch to zoom', async ({ page }) => {
    await boot(page);
    await viewSettled(page);
    const k0 = await zoom(page);
    const vp = (await tree(page).boundingBox())!;
    const cx = vp.x + vp.width / 2, cy = vp.y + vp.height / 2;
    const cdp = await page.context().newCDPSession(page);
    // a touch screen for the desktop project too (the phone project has one already)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const fingers = (d: number) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(30) });
    for (let d = 35; d <= 90; d += 5) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(d) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await viewSettled(page);
    expect(await zoom(page)).toBeGreaterThan(k0 * 1.5);
    await expect(tree(page).locator('.node.sel')).toHaveCount(0);
  });

  test('with reduced motion the view jumps and the HUD updates at once', async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page);
    await zoomBtn(page, '放大').click();
    expect(await zoom(page)).toBeCloseTo(1.5, 2);
    // no easing: the very next read already shows where 全览 and 定位 go
    await zoomBtn(page, '全览').click();
    expect(await zoom(page)).toBeLessThanOrEqual(1);
    await zoomBtn(page, '定位').click();
    expect(await zoom(page)).toBeCloseTo(1, 2);
    await complete(page, info, 'o_start');
    await expectHud(page, { level: '1', xp: '6/18', emeralds: '1' });
  });
});
