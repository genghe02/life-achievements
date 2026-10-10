import { expect, test } from './fixtures';
import { AREA_NAMES, boot, node, openMenu, reload, tab, tabs, tree } from './helpers';

test.describe('first launch', () => {
  test('onboarding offers two starts and explains where data lives', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { name: '人生成就系统' })).toBeVisible();
    await expect(page.getByText('数据只保存在这台设备上，可以在菜单里备份。')).toBeVisible();
    await expect(page.getByRole('button', { name: '示例模板' })).toContainText('7 个领域、97 个进度。');
    await expect(page.getByRole('button', { name: '空白开始' })).toBeVisible();
    // nothing of the app behind it yet
    await expect(tree(page)).toHaveCount(0);
    await expect(page.getByText(/演示|demo/i)).toHaveCount(0);
  });

  test('示例模板 gives 7 areas and 97 achievements, nothing done', async ({ page }) => {
    await boot(page, 'starter');
    await expect(tabs(page)).toHaveCount(7);
    const want = ['起源，已达成 0/14', ...AREA_NAMES.slice(1).map(n => `${n}，未解锁`)];
    for (const [i, name] of want.entries()) await expect(tabs(page).nth(i)).toHaveAccessibleName(name);
    await expect(tab(page, '起源')).toHaveAttribute('aria-selected', 'true');
    await expect(tree(page).locator('.node')).toHaveCount(14);
    await expect(page.locator('.hud')).toContainText('已达成 0/97');

    const menu = await openMenu(page);
    const stats = menu.getByRole('region', { name: '统计' });
    await expect(stats).toContainText('0/97');
    await expect(stats).toContainText('已达成进度');
    for (const name of AREA_NAMES) await expect(stats.getByText(name, { exact: true })).toBeVisible();

    // the choice is kept: no onboarding after a reload
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await reload(page);
    await expect(page.getByRole('button', { name: '示例模板' })).toHaveCount(0);
    await expect(tree(page).locator('.node')).toHaveCount(14);
  });

  test('空白开始 gives one open root per area', async ({ page }) => {
    await boot(page, 'blank');
    await expect(tabs(page)).toHaveCount(7);
    for (const [i, name] of AREA_NAMES.entries()) {
      const t = tabs(page).nth(i);
      await expect(t).toHaveAccessibleName(`${name}，已达成 0/1`);
      await t.click();
      await expect(t).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.whead h1')).toHaveText(name);
      const nodes = tree(page).locator('.node');
      await expect(nodes).toHaveCount(1);
      await expect(nodes).toHaveClass(/\bopen\b/);
    }
    await expect(page.locator('.hud')).toContainText('已达成 0/7');
    // the starter's gateway roots are plain open roots here
    await tab(page, '体魄').click();
    await expect(node(page, 'b_warm_up')).toHaveClass(/\bopen\b/);
    await expect(tree(page).getByRole('button', { name: '去看看' })).toHaveCount(0);
  });
});
