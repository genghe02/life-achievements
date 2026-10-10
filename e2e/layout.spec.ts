/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  boot,
  closeDialog,
  detail,
  dialog,
  hittable,
  node,
  openMenu,
  overflowX,
  press,
  reachable,
  selectNode,
  tradePill,
  viewSettled,
  worldTransform,
} from './helpers';

const rect = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate(e => {
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });

test.describe('layout', () => {
  test('desktop: the detail is a 340px column; phone: a bottom sheet whose action row is on screen', async ({ page }, info) => {
    await boot(page);
    const vw = page.viewportSize()!;
    const d = detail(page);
    if (vw.width >= 860) {
      await expect(d).toBeVisible();
      await expect(d).toHaveAccessibleName('领域概览');
      expect(Math.round((await rect(page, '#detail')).width)).toBe(340);
      await viewSettled(page);
      const before = await worldTransform(page);
      await selectNode(page, info, 'o_start');
      await expect(d).toHaveAccessibleName('进度详情');
      // a click selects without moving the tree (only keyboard focus re-centres)
      expect(await worldTransform(page)).toBe(before);
      await expect(d.getByRole('button', { name: '关闭' })).toBeHidden();
      return;
    }

    await expect(d).not.toHaveClass(/\bopen\b/);
    await expect(d).toBeHidden();
    await selectNode(page, info, 'o_start');
    await expect(d).toHaveClass(/\bopen\b/);
    await expect(d).toBeInViewport({ ratio: 1 });
    const sheet = await rect(page, '#detail');
    expect(sheet.height).toBeLessThanOrEqual(Math.min(0.58 * vw.height, 520) + 1);
    // the sticky action row is on screen with its buttons in full
    await expect(d.locator('.dact')).toBeInViewport();
    await expect(d.getByRole('button', { name: '完成进度' })).toBeInViewport({ ratio: 1 });
    await expect(d.getByRole('button', { name: '编辑' })).toBeInViewport({ ratio: 1 });
    // the selected node is not hidden under the sheet
    await viewSettled(page);
    expect(await hittable(page, 'o_start')).toBe(true);
    const n = await node(page, 'o_start').boundingBox();
    expect(n!.y + n!.height).toBeLessThanOrEqual(sheet.top);

    // a long panel scrolls inside the sheet while the action row stays put
    await selectNode(page, info, 'o_home');
    await expect(d.getByRole('button', { name: '先完成前置进度' })).toBeInViewport({ ratio: 1 });
    await d.locator('.dscroll').evaluate(e => e.scrollTo(0, e.scrollHeight));
    await expect(d.getByRole('button', { name: '先完成前置进度' })).toBeInViewport({ ratio: 1 });

    await d.getByRole('button', { name: '关闭' }).click();
    await expect(d).not.toHaveClass(/\bopen\b/);
    await expect(node(page, 'o_home')).not.toHaveClass(/\bsel\b/);

    // 概览 opens the area overview in the sheet
    await page.getByRole('button', { name: '概览' }).click();
    await expect(d).toHaveClass(/\bopen\b/);
    await expect(d).toHaveAccessibleName('领域概览');
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('起源');
  });

  test('sideways phone (844x390): the sheet docks on the right below the HUD', async ({ page }, info) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await boot(page);
    const d = detail(page);
    await expect(d).not.toHaveClass(/\bopen\b/);
    await selectNode(page, info, 'o_start');
    await expect(d).toHaveClass(/\bopen\b/);
    await expect(d).toBeInViewport({ ratio: 1 });
    const dock = await rect(page, '#detail');
    const hud = await rect(page, '.hud');
    expect(dock.right).toBeGreaterThan(844 - 20);
    expect(dock.left).toBeGreaterThan(844 / 2);
    expect(dock.top).toBeGreaterThanOrEqual(hud.bottom - 1);
    expect(dock.bottom).toBeLessThanOrEqual(390);
    await expect(d.getByRole('button', { name: '完成进度' })).toBeInViewport({ ratio: 1 });
    // the window head sits in the tab row, above the tree
    const head = await rect(page, '.whead');
    const vp = await rect(page, '#vp');
    expect(head.bottom).toBeLessThanOrEqual(vp.top + 1);
    await expect(page.getByRole('button', { name: '整理' })).toBeInViewport();
    // the selected node stays clear of the dock
    await viewSettled(page);
    expect(await hittable(page, 'o_start')).toBe(true);
    expect(await overflowX(page)).toBe(0);
    // the dock starts below the window head, so its buttons still work while the dock is open
    expect(dock.top).toBeGreaterThanOrEqual(head.bottom);
    for (const name of ['概览', '整理', '领域设置', '+ 新建']) {
      expect(await reachable(page.getByRole('button', { name, exact: true })), name).toBe(true);
    }
    await press(info, page.getByRole('button', { name: '+ 新建' }));
    const ed = dialog(page, '新建进度 · 起源');
    await expect(ed).toBeVisible();
    await expect(ed.getByRole('checkbox', { name: '开局一棵树' })).toBeChecked();
    await closeDialog(ed);
    await press(info, page.getByRole('button', { name: '领域设置' }));
    await expect(dialog(page, '领域设置')).toBeVisible();
  });

  test('no horizontal page scroll at 360x740', async ({ page }, info) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('./');
    await expect(page.getByRole('heading', { name: '人生成就系统' })).toBeVisible();
    expect(await overflowX(page), 'onboarding').toBe(0);
    await page.getByRole('button', { name: '示例模板' }).click();
    await expect(page.getByRole('group', { name: '进度树' })).toBeVisible();
    expect(await overflowX(page), 'tree').toBe(0);

    await selectNode(page, info, 'o_start');
    await expect(detail(page)).toHaveClass(/\bopen\b/);
    expect(await overflowX(page), 'sheet').toBe(0);
    await expect(detail(page).getByRole('button', { name: '完成进度' })).toBeInViewport({ ratio: 1 });

    await detail(page).getByRole('button', { name: '编辑' }).click();
    const ed = dialog(page, '编辑进度');
    await expect(ed).toBeVisible();
    expect(await overflowX(page), 'node editor').toBe(0);
    await expect(ed.getByRole('button', { name: '保存' })).toBeInViewport({ ratio: 1 });
    await closeDialog(ed);

    await tradePill(page).click();
    const tr = dialog(page, /^交易/);
    await expect(tr).toBeVisible();
    expect(await overflowX(page), 'trade').toBe(0);
    await closeDialog(tr);

    const menu = await openMenu(page);
    expect(await overflowX(page), 'menu').toBe(0);
    // a long modal is capped to the screen and scrolls inside
    await expect(menu).toBeInViewport({ ratio: 1 });
    const scroll = menu.locator('.mscroll');
    expect(await scroll.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true);
    await menu.getByRole('button', { name: '确认重新开始' }).scrollIntoViewIfNeeded();
    await expect(menu.getByRole('button', { name: '确认重新开始' })).toBeInViewport();
    await closeDialog(menu);

    await page.getByRole('button', { name: '新建领域' }).click();
    const area = dialog(page, '新建领域');
    await expect(area).toBeVisible();
    expect(await overflowX(page), 'area editor').toBe(0);
    await expect(area.getByRole('button', { name: '创建领域' })).toBeInViewport({ ratio: 1 });
    await closeDialog(area);

    await page.getByRole('button', { name: '整理' }).click();
    expect(await overflowX(page), 'arrange').toBe(0);
    await page.getByRole('button', { name: '完成', exact: true }).click();

    // an eighth area: the tab row scrolls inside itself, the page does not
    await page.getByRole('button', { name: '新建领域' }).click();
    await area.getByLabel(/^名称/).fill('音乐');
    await area.getByRole('button', { name: '创建领域' }).click();
    await expect(area).toBeHidden();
    await expect(page.getByRole('tab', { name: /^音乐，/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /^音乐，/ })).toBeInViewport();
    expect(await overflowX(page), 'eight tabs').toBe(0);
    await page.getByRole('button', { name: '新建领域' }).click();
    await expect(area).toBeVisible();
    await closeDialog(area);
  });

  test('phone: a node tapped low on the screen is brought out from under the sheet', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await viewSettled(page);
    // the lowest node that can be tapped at the home view
    const ids = await page.locator('#nodes .node').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id ?? ''));
    let low = '';
    let lowY = -Infinity;
    for (const id of ids) {
      if (!(await hittable(page, id))) continue;
      const b = (await node(page, id).boundingBox())!;
      if (b.y > lowY) { lowY = b.y; low = id; }
    }
    expect(low).not.toBe('');
    if (info.project.use.hasTouch) await node(page, low).tap();
    else await node(page, low).click();
    await expect(detail(page)).toHaveClass(/\bopen\b/);
    await viewSettled(page);
    expect(await hittable(page, low), `${low} visible above the sheet`).toBe(true);
    const sheet = await rect(page, '#detail');
    const n = (await node(page, low).boundingBox())!;
    expect(n.y + n.height).toBeLessThanOrEqual(sheet.top);

    // turning the phone keeps the selection in view, now beside the docked panel
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(detail(page)).toHaveClass(/\bopen\b/);
    await viewSettled(page);
    expect(await hittable(page, low), `${low} visible beside the dock`).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await viewSettled(page);
    expect(await hittable(page, low), `${low} visible after turning back`).toBe(true);
  });
});
