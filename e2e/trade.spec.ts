import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { boot, complete, detail, dialog, expectHud, expectToast, node, pageToday, pressAgain, reload, selectNode, tradePill } from './helpers';

/** The toasts' stacking level, and the modal's while one is open. */
const layers = (page: Page) =>
  page.evaluate(() => {
    const z = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? Number(getComputedStyle(el).zIndex) : null;
    };
    return { toasts: z('.toasts'), modal: z('.modal') };
  });

test.describe('trade', () => {
  test('add a reward, buy it, edit it and delete it', async ({ page }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    await complete(page, info, 'o_water');
    await expectHud(page, { level: '2', xp: '8/22', emeralds: '2' });

    await tradePill(page).click();
    const tr = dialog(page, /^交易/);
    await expect(tr).toBeVisible();
    await expect(tr.getByRole('heading', { level: 2 })).toHaveText('交易 · 你有 2 颗绿宝石');
    await expect(tr.getByText('还没有交易记录。')).toBeVisible();

    // add
    await tr.getByLabel('添加一个奖励').fill('一颗糖');
    await tr.getByLabel('价格（绿宝石）').last().fill('2');
    await tr.getByRole('button', { name: '添加奖励' }).click();
    const buy = tr.getByRole('button', { name: '交易「一颗糖」，花 2 颗绿宝石' });
    await expect(buy).toBeEnabled();
    await expect(tr.getByLabel('添加一个奖励')).toHaveValue('');

    // buy: the balance drops and the log has the entry
    await buy.click();
    await expectToast(page, '交易成功！', '一颗糖 · -2 绿宝石', 20_000);
    // the modal says so itself, and the toast stays under the modal instead of covering it
    await expect(tr.getByRole('status')).toHaveText('换到了「一颗糖」，花了 2 颗绿宝石。');
    const open = await layers(page);
    expect(open.toasts).toBeLessThan(open.modal!);
    await expect(tr.getByRole('heading', { level: 2 })).toHaveText('交易 · 你有 0 颗绿宝石');
    await expect(tradePill(page)).toHaveAccessibleName('绿宝石 0，交易');
    const today = await pageToday(page);
    await expect(tr.getByText(`${today} · 一颗糖 · -2`)).toBeVisible();
    await expect(tr.getByText('交易记录 · 已花 2 颗')).toBeVisible();
    await expect(tr.getByRole('button', { name: '还差 2 颗绿宝石换「一颗糖」' })).toBeDisabled();

    // edit name, price and icon
    await tr.getByRole('button', { name: '编辑「一颗糖」' }).click();
    const row = tr.locator('li.editing');
    await expect(row.getByLabel('奖励名称')).toBeFocused();
    await row.getByLabel('奖励名称').fill('两颗糖');
    await row.getByLabel('价格（绿宝石）').fill('3');
    await row.getByText('换一个').click();
    await row.getByRole('radio', { name: '蛋糕' }).check();
    await row.getByRole('button', { name: '保存' }).click();
    await expect(tr.getByRole('button', { name: '编辑「两颗糖」' })).toBeVisible();
    await expect(tr.getByRole('button', { name: '还差 3 颗绿宝石换「两颗糖」' })).toBeDisabled();
    // the log keeps what was bought
    await expect(tr.getByText(`${today} · 一颗糖 · -2`)).toBeVisible();

    // delete in two steps
    await tr.getByRole('button', { name: '删除「两颗糖」' }).click();
    const again = tr.getByRole('button', { name: '再点一次删除「两颗糖」' });
    await expect(again).toBeVisible();
    await pressAgain(page, again);
    await expect(tr.getByRole('button', { name: /两颗糖/ })).toHaveCount(0);
    await expect(tr.getByText(`${today} · 一颗糖 · -2`)).toBeVisible();

    // all of it is kept
    await page.keyboard.press('Escape');
    await expect(tr).toBeHidden();
    // with no modal open, toasts are back above everything but the XP orbs
    expect(await layers(page)).toEqual({ toasts: 60, modal: null });
    await reload(page);
    await expectHud(page, { level: '2', xp: '8/22', emeralds: '0' });
    await tradePill(page).click();
    await expect(tr.getByText(`${today} · 一颗糖 · -2`)).toBeVisible();
    await expect(tr.getByRole('button', { name: /两颗糖|一颗糖」/ })).toHaveCount(0);
  });

  test('a reward that costs more than the balance cannot be bought', async ({ page }) => {
    await boot(page);
    await tradePill(page).click();
    const tr = dialog(page, /^交易/);
    // the default list: the cheapest is 一杯奶茶 for 3
    const milkTea = tr.getByRole('button', { name: '还差 3 颗绿宝石换「一杯奶茶」' });
    await expect(milkTea).toBeDisabled();
    await expect(tr.getByText('还没有交易记录。')).toBeVisible();
  });

  test('spent emeralds block an undo, and a lowered reward shows a negative balance as it is', async ({ page }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    await complete(page, info, 'o_water');
    await expectHud(page, { level: '2', xp: '8/22', emeralds: '2' });
    await tradePill(page).click();
    const tr = dialog(page, /^交易/);
    await tr.getByLabel('添加一个奖励').fill('一颗糖');
    await tr.getByLabel('价格（绿宝石）').fill('2');
    await tr.getByRole('button', { name: '添加奖励' }).click();
    await tr.getByRole('button', { name: '交易「一颗糖」，花 2 颗绿宝石' }).click();
    await expect(tradePill(page)).toHaveAccessibleName('绿宝石 0，交易');
    await page.keyboard.press('Escape');
    if (await tr.isVisible()) await page.keyboard.press('Escape');
    await expect(tr).toBeHidden();

    // undoing 无限水源 would take back an emerald that is already spent
    await selectNode(page, info, 'o_water');
    await detail(page).getByRole('button', { name: '撤销完成' }).click();
    await expect(detail(page).getByRole('alert')).toHaveText('这个进度给的绿宝石已经花掉了，还差 1 颗才能撤销。');
    await expect(node(page, 'o_water')).toHaveClass(/\bdone\b/);

    // pay out less for it afterwards: the balance goes below zero and is shown that way
    await detail(page).getByRole('button', { name: '编辑' }).click();
    const ed = dialog(page, '编辑进度');
    const pts = ed.getByRole('spinbutton', { name: '绿宝石', exact: true });
    if (!(await pts.isVisible())) await ed.getByText('高级', { exact: true }).click();
    await pts.fill('0');
    await ed.getByRole('button', { name: '保存' }).click();
    await expect(ed).toBeHidden();
    await expect(tradePill(page)).toHaveAccessibleName('绿宝石 -1，交易');
    await expectHud(page, { level: '2', xp: '8/22', emeralds: '-1' });
    await tradePill(page).click();
    await expect(tr.getByRole('heading', { level: 2 })).toHaveText('交易 · 你有 -1 颗绿宝石');
  });

  test('the trade log lists every entry newest first and scrolls when long', async ({ page }, info) => {
    await boot(page);
    // pay out plenty for the first achievement (高级), then complete it
    await selectNode(page, info, 'o_start');
    await detail(page).getByRole('button', { name: '编辑' }).click();
    const ed = dialog(page, '编辑进度');
    const pts = ed.getByRole('spinbutton', { name: '绿宝石', exact: true });
    if (!(await pts.isVisible())) await ed.getByText('高级', { exact: true }).click();
    await pts.fill('100');
    await ed.getByRole('button', { name: '保存' }).click();
    await expect(ed).toBeHidden();
    await detail(page).getByRole('button', { name: '完成进度' }).click();
    await expect(tradePill(page)).toHaveAccessibleName('绿宝石 100，交易');

    await tradePill(page).click();
    const tr = dialog(page, /^交易/);
    for (const name of ['苹果', '香蕉']) {
      await tr.getByLabel('添加一个奖励').fill(name);
      await tr.getByLabel('价格（绿宝石）').fill('1');
      await tr.getByRole('button', { name: '添加奖励' }).click();
      await expect(tr.getByRole('button', { name: `交易「${name}」，花 1 颗绿宝石` })).toBeVisible();
    }
    const apple = tr.getByRole('button', { name: '交易「苹果」，花 1 颗绿宝石' });
    const banana = tr.getByRole('button', { name: '交易「香蕉」，花 1 颗绿宝石' });
    // alternate, so no click is the tail of a double click on the same reward
    for (let i = 0; i < 12; i++) await (i % 2 ? banana : apple).click();
    await expect(tr.getByRole('heading', { level: 2 })).toHaveText('交易 · 你有 88 颗绿宝石');
    const log = tr.locator('.tlog li');
    await expect(log).toHaveCount(12);
    await expect(log.first()).toContainText('香蕉');
    await expect(log.last()).toContainText('苹果');
    await expect(tr.getByText('交易记录 · 已花 12 颗')).toBeVisible();
    expect(await tr.locator('.tlog').evaluate(e => e.scrollHeight > e.clientHeight + 1)).toBe(true);
  });
});
