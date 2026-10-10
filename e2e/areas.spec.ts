import { expect, test } from './fixtures';
import { AREA_NAMES, boot, detail, dialog, isTouch, pressAgain, reachable, reload, selectNode, tab, tabs, tree } from './helpers';

test.describe('areas', () => {
  test('create an area with 「+」, rename it, move it, delete it in two steps', async ({ page }, info) => {
    await boot(page);
    await page.getByRole('button', { name: '新建领域' }).click();
    const ed = dialog(page, '新建领域');
    await expect(ed).toBeVisible();
    await expect(ed.getByLabel(/^名称/)).toBeFocused();
    await ed.getByLabel(/^名称/).fill('音乐');
    await ed.getByLabel('副标题（可不填）').fill('学会一样乐器');
    await ed.getByRole('radio', { name: '唱片' }).check();
    await ed.getByRole('radio', { name: '木板' }).check();
    await ed.getByRole('button', { name: '创建领域' }).click();
    await expect(ed).toBeHidden();

    // the new area is the current tab, with one open root 「新的开始」 of type 目标
    await expect(tabs(page)).toHaveCount(8);
    const music = tab(page, '音乐');
    await expect(music).toHaveAccessibleName('音乐，已达成 0/1');
    await expect(music).toHaveAttribute('aria-selected', 'true');
    await expect(tabs(page).nth(7)).toHaveAccessibleName('音乐，已达成 0/1');
    await expect(page.locator('.whead h1')).toHaveText('音乐');
    const nodes = tree(page).locator('.node');
    await expect(nodes).toHaveCount(1);
    await expect(nodes).toHaveAccessibleName('新的开始，目标，可以开始');
    const rootId = (await nodes.getAttribute('data-id')) ?? '';
    await selectNode(page, info, rootId);
    await expect(detail(page).locator('.dmeta')).toHaveText('目标 · 音乐');
    await expect(detail(page).getByRole('button', { name: '完成进度' })).toBeVisible();

    // rename
    await page.getByRole('button', { name: '领域设置' }).click();
    const set = dialog(page, '领域设置');
    await expect(set.getByLabel(/^名称/)).toHaveValue('音乐');
    await expect(set.getByLabel('副标题（可不填）')).toHaveValue('学会一样乐器');
    await set.getByLabel(/^名称/).fill('乐器');
    await set.getByRole('button', { name: '保存' }).click();
    await expect(set).toBeHidden();
    await expect(tab(page, '乐器')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, '音乐')).toHaveCount(0);
    await expect(page.locator('.whead h1')).toHaveText('乐器');

    // move one place left, then check the order
    await page.getByRole('button', { name: '领域设置' }).click();
    await expect(set.getByText('第 8 个，共 8 个')).toBeVisible();
    await expect(set.getByRole('button', { name: '右移 →' })).toBeDisabled();
    await set.getByRole('button', { name: '← 左移' }).click();
    await expect(set.getByText('第 7 个，共 8 个')).toBeVisible();
    await expect(tabs(page).nth(6)).toHaveAccessibleName('乐器，已达成 0/1');
    await expect(tabs(page).nth(7)).toHaveAccessibleName('远行，未解锁');
    await set.getByRole('button', { name: '取消' }).click();
    await expect(set).toBeHidden();

    // all of it is kept, and the app comes back on the same tab
    await reload(page);
    await expect(tabs(page)).toHaveCount(8);
    await expect(tabs(page).nth(6)).toHaveAccessibleName('乐器，已达成 0/1');
    await expect(tab(page, '乐器')).toHaveAttribute('aria-selected', 'true');
    await expect(tree(page).locator('.node')).toHaveAccessibleName('新的开始，目标，可以开始');
    await page.getByRole('button', { name: '领域设置' }).click();

    // delete: the first press arms, the second deletes the area and its achievements
    await set.getByRole('button', { name: '删除这个领域' }).click();
    const again = set.getByRole('button', { name: '再点一次删除（1 个进度会删掉）' });
    await expect(again).toBeVisible();
    await expect(tabs(page)).toHaveCount(8);
    await pressAgain(page, again);
    await expect(set).toBeHidden();
    await expect(tabs(page)).toHaveCount(7);
    await expect(tab(page, '乐器')).toHaveCount(0);
    for (const [i, name] of AREA_NAMES.entries()) await expect(tabs(page).nth(i)).toHaveAccessibleName(new RegExp(`^${name}，`));
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(page.locator('.hud')).toContainText('已达成 0/97');
  });

  test('with many areas the 「+」 tab stays on screen and the tab row scrolls', async ({ page }, info) => {
    if (!isTouch(info)) await page.setViewportSize({ width: 1280, height: 720 });
    await boot(page);
    const add = page.getByRole('button', { name: '新建领域' });
    for (let i = 8; i <= 10; i++) {
      await add.click();
      const ed = dialog(page, '新建领域');
      await ed.getByLabel(/^名称/).fill(`领域${i}`);
      await ed.getByRole('button', { name: '创建领域' }).click();
      await expect(ed).toBeHidden();
    }
    await expect(tabs(page)).toHaveCount(10);
    const row = page.getByRole('navigation', { name: '人生领域' });
    expect(await row.evaluate(e => e.scrollWidth > e.clientWidth), 'the row overflows').toBe(true);

    // the new area's tab is in view and clear of 「+」, which is on screen too
    const box = async (l: typeof add) => (await l.boundingBox())!;
    const sel = page.getByRole('tab', { selected: true });
    await expect(sel).toHaveAccessibleName(/^领域10，/);
    await expect(sel).toBeInViewport({ ratio: 1 });
    expect((await box(sel)).x + (await box(sel)).width).toBeLessThanOrEqual((await box(add)).x + 1);
    expect(await reachable(add)).toBe(true);

    // back at the start of the row, 「+」 is still on screen and works where it is (no scrolling to it)
    await sel.focus();
    await page.keyboard.press('Home');
    await expect(tab(page, '起源')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => row.evaluate(e => e.scrollLeft)).toBe(0);
    expect(await reachable(add)).toBe(true);
    if (!isTouch(info)) {
      // a plain mouse wheel scrolls the row sideways
      const r = await box(row);
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      await page.mouse.wheel(0, 200);
      await expect.poll(() => row.evaluate(e => e.scrollLeft)).toBeGreaterThan(0);
    }
    const a = await box(add);
    if (isTouch(info)) await page.touchscreen.tap(a.x + a.width / 2, a.y + a.height / 2);
    else await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
    await expect(dialog(page, '新建领域')).toBeVisible();
  });

  test('the last area cannot be deleted', async ({ page }) => {
    await boot(page, 'blank');
    // delete six of the seven areas
    for (let left = 7; left > 1; left--) {
      await page.getByRole('button', { name: '领域设置' }).click();
      const set = dialog(page, '领域设置');
      await set.getByRole('button', { name: '删除这个领域' }).click();
      await pressAgain(page, set.getByRole('button', { name: /^再点一次删除/ }));
      await expect(set).toBeHidden();
      await expect(tabs(page)).toHaveCount(left - 1);
    }
    await page.getByRole('button', { name: '领域设置' }).click();
    const set = dialog(page, '领域设置');
    await set.getByRole('button', { name: '删除这个领域' }).click();
    await expect(set.getByRole('alert').filter({ hasText: '至少要保留一个领域。' })).toBeVisible();
    await expect(tabs(page)).toHaveCount(1);
  });

  test('deleting an area also drops the gateways that pointed into it', async ({ page }) => {
    await boot(page);
    await expect(tab(page, '体魄')).toHaveAccessibleName('体魄，未解锁');
    // 起源 holds the gateway of every other area
    await page.getByRole('button', { name: '领域设置' }).click();
    const set = dialog(page, '领域设置');
    await expect(set.getByText('删除后，这个领域的 14 个进度和完成记录都会一起删掉。')).toBeVisible();
    await set.getByRole('button', { name: '删除这个领域' }).click();
    await pressAgain(page, set.getByRole('button', { name: '再点一次删除（14 个进度会删掉）' }));
    await expect(set).toBeHidden();
    await expect(tabs(page)).toHaveCount(6);
    for (const [i, name] of AREA_NAMES.slice(1).entries()) {
      await expect(tabs(page).nth(i)).toHaveAccessibleName(new RegExp(`^${name}，已达成 0/\\d+$`));
    }
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(tree(page).getByRole('button', { name: '去看看' })).toHaveCount(0);
    await expect(page.locator('.hud')).toContainText('已达成 0/83');
    await reload(page);
    await expect(tabs(page)).toHaveCount(6);
    await expect(page.locator('.hud')).toContainText('已达成 0/83');
  });
});
