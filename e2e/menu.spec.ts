import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import {
  boot,
  complete,
  expectHud,
  expectToast,
  node,
  openMenu,
  pageToday,
  pressAgain,
  reload,
  tabs,
  tree,
} from './helpers';

test.describe('menu', () => {
  test('统计 shows level, XP, emeralds and one bar per area', async ({ page }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    await expectHud(page, { level: '1', xp: '6/18', emeralds: '1' });
    const menu = await openMenu(page);
    const stats = menu.getByRole('region', { name: '统计' });
    await expect(stats).toContainText('人生等级 · 新手');
    await expect(stats).toContainText('1/97');
    await expect(stats).toContainText('距离 2 级还差 12 经验');
    await expect(stats.locator('.stat-rows li')).toHaveCount(7);
    await expect(stats.locator('.stat-rows li').first()).toContainText('起源');
    await expect(stats.locator('.stat-rows li').first()).toContainText('1/14');
    await expect(stats.locator('.stat-rows li').nth(1)).toContainText('未解锁');
  });

  test('设置 toggles stay after a reload', async ({ page }) => {
    await boot(page);
    let menu = await openMenu(page);
    const sound = menu.getByRole('switch', { name: '音效' });
    const labels = menu.getByRole('switch', { name: '树上显示名称' });
    await expect(sound).toHaveAttribute('aria-checked', 'true');
    await expect(labels).toHaveAttribute('aria-checked', 'true');
    await sound.click();
    await labels.click();
    await expect(sound).toHaveAttribute('aria-checked', 'false');
    await expect(sound).toHaveText('关');
    await expect(labels).toHaveAttribute('aria-checked', 'false');
    await expect(tree(page).locator('.world')).toHaveClass(/\bnolabels\b/);

    await reload(page);
    await expect(tree(page).locator('.world')).toHaveClass(/\bnolabels\b/);
    await expect(node(page, 'o_start').locator('.lb')).toBeHidden();
    menu = await openMenu(page);
    await expect(menu.getByRole('switch', { name: '音效' })).toHaveAttribute('aria-checked', 'false');
    await expect(menu.getByRole('switch', { name: '树上显示名称' })).toHaveAttribute('aria-checked', 'false');
    await menu.getByRole('switch', { name: '树上显示名称' }).click();
    await expect(tree(page).locator('.world')).not.toHaveClass(/\bnolabels\b/);
  });

  test('export, restart blank, import the backup with a confirm step, restart from the template', async ({ page }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    await expectHud(page, { level: '1', xp: '6/18', emeralds: '1' });

    // export
    let menu = await openMenu(page);
    const data = menu.getByRole('region', { name: '数据' });
    await expect(data).toContainText('数据只保存在这台设备的浏览器里。');
    await expect(data).toContainText('还没有备份过。');
    const today = await pageToday(page);
    const [download] = await Promise.all([page.waitForEvent('download'), data.getByRole('button', { name: '导出备份' }).click()]);
    expect(download.suggestedFilename()).toBe(`life-achievements-${today}.json`);
    const file = info.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    const backup = JSON.parse(readFileSync(file, 'utf8'));
    expect(backup.app).toBe('life-achievements');
    expect(backup.version).toBe(1);
    expect(backup.data.areas).toHaveLength(7);
    expect(backup.data.achievements).toHaveLength(97);
    expect(Object.keys(backup.data.done)).toEqual(['o_start']);
    await expect(data.getByText(`已导出「life-achievements-${today}.json」。`)).toBeVisible();
    await expect(data).toContainText(`上次备份：${today}。`);

    // restart with a blank tree: two steps
    const restart = menu.getByRole('region', { name: '重新开始' });
    const go = restart.getByRole('button', { name: '确认重新开始' });
    await expect(go).toBeDisabled();
    await restart.getByRole('radio', { name: '空白开始' }).check();
    await go.click();
    const again = restart.getByRole('button', { name: '再点一次重新开始' });
    await expect(again).toBeVisible();
    await pressAgain(page, again);
    await expect(menu).toBeHidden();
    await expectToast(page, '已重新开始', '空白开始', 20_000);
    await expectHud(page, { level: '0', xp: '0/14', emeralds: '0' });
    await expect(page.locator('.hud')).toContainText('已达成 0/7');
    await expect(tree(page).locator('.node')).toHaveCount(1);

    // import: pick the file, see the summary, confirm twice
    menu = await openMenu(page);
    const data2 = menu.getByRole('region', { name: '数据' });
    await data2.getByLabel('导入备份').setInputFiles(file);
    const sum = data2.getByRole('group', { name: '要导入的备份' });
    await expect(sum).toBeVisible();
    await expect(sum).toContainText(`「life-achievements-${today}.json」`);
    await expect(sum).toContainText('领域：7 个');
    await expect(sum).toContainText('进度：97 个');
    await expect(sum).toContainText('已达成：1 个');
    await expect(page.locator('.hud')).toContainText('已达成 0/7');
    await sum.getByRole('button', { name: '用这份备份替换现在的数据' }).click();
    const confirm = sum.getByRole('button', { name: '再点一次确认替换' });
    await expect(confirm).toBeVisible();
    await pressAgain(page, confirm);
    await expect(menu).toBeHidden();
    await expectToast(page, '备份已导入', '97 个进度，已达成 1 个', 20_000);
    await expectHud(page, { level: '1', xp: '6/18', emeralds: '1' });
    await expect(page.locator('.hud')).toContainText('已达成 1/97');
    await expect(tabs(page)).toHaveCount(7);
    await expect(node(page, 'o_start')).toHaveClass(/\bdone\b/);

    // kept after a reload
    await reload(page);
    await expect(page.locator('.hud')).toContainText('已达成 1/97');

    // restart from the template
    menu = await openMenu(page);
    const restart2 = menu.getByRole('region', { name: '重新开始' });
    await restart2.getByRole('radio', { name: '示例模板' }).check();
    await restart2.getByRole('button', { name: '确认重新开始' }).click();
    await pressAgain(page, restart2.getByRole('button', { name: '再点一次重新开始' }));
    await expect(menu).toBeHidden();
    await expect(page.locator('.hud')).toContainText('已达成 0/97');
    await expect(node(page, 'o_start')).toHaveClass(/\bopen\b/);
    await expectHud(page, { level: '0', xp: '0/14', emeralds: '0' });
  });

  test('a file that is not a backup is refused and nothing changes', async ({ page }) => {
    await boot(page);
    const menu = await openMenu(page);
    const data = menu.getByRole('region', { name: '数据' });
    await data.getByLabel('导入备份').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
    await expect(data.getByRole('alert')).toHaveText('这不是人生成就系统的备份文件，换一个文件试试。');
    await expect(data.getByRole('group', { name: '要导入的备份' })).toHaveCount(0);
    await expect(page.locator('.hud')).toContainText('已达成 0/97');
  });

  test('a bare data document imports too; one from a newer version is refused', async ({ page }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    let menu = await openMenu(page);
    const [download] = await Promise.all([page.waitForEvent('download'), menu.getByRole('button', { name: '导出备份' }).click()]);
    const file = info.outputPath('backup.json');
    await download.saveAs(file);
    const backup = JSON.parse(readFileSync(file, 'utf8'));

    // a newer app version: refused, nothing replaced
    const newer = { ...backup, version: 2, data: { ...backup.data, version: 2 } };
    const data = menu.getByRole('region', { name: '数据' });
    await data.getByLabel('导入备份').setInputFiles({ name: 'newer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(newer)) });
    await expect(data.getByRole('alert')).toHaveText('这个备份来自更新版本的应用，先更新应用再导入。');
    await expect(data.getByRole('group', { name: '要导入的备份' })).toHaveCount(0);

    // restart blank, then import just the data document (no wrapper)
    const restart = menu.getByRole('region', { name: '重新开始' });
    await restart.getByRole('radio', { name: '空白开始' }).check();
    await restart.getByRole('button', { name: '确认重新开始' }).click();
    await pressAgain(page, restart.getByRole('button', { name: '再点一次重新开始' }));
    await expect(menu).toBeHidden();
    await expect(page.locator('.hud')).toContainText('已达成 0/7');

    menu = await openMenu(page);
    const data2 = menu.getByRole('region', { name: '数据' });
    await data2.getByLabel('导入备份').setInputFiles({ name: 'bare.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup.data)) });
    const sum = data2.getByRole('group', { name: '要导入的备份' });
    await expect(sum).toContainText('进度：97 个');
    await expect(sum).toContainText('导出时间：没有记录');
    // 取消 leaves everything as it was
    await sum.getByRole('button', { name: '取消' }).click();
    await expect(sum).toHaveCount(0);
    await expect(page.locator('.hud')).toContainText('已达成 0/7');
    await data2.getByLabel('导入备份').setInputFiles({ name: 'bare.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup.data)) });
    await sum.getByRole('button', { name: '用这份备份替换现在的数据' }).click();
    await pressAgain(page, sum.getByRole('button', { name: '再点一次确认替换' }));
    await expect(menu).toBeHidden();
    await expect(page.locator('.hud')).toContainText('已达成 1/97');
  });

  test('添加到主屏幕: browser steps on a phone, an 安装 button once the browser offers one', async ({ page }) => {
    await boot(page);
    let menu = await openMenu(page);
    const phone = page.viewportSize()!.width < 860;
    const install = menu.getByRole('region', { name: '添加到主屏幕' });
    if (phone) {
      await expect(install).toBeVisible();
      await expect(install).toContainText('点浏览器的菜单按钮（通常是右上角的三个点）');
    } else {
      await expect(install).toHaveCount(0);
    }
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // Chrome / Android: the captured install prompt becomes a button
    await page.evaluate(() => {
      const ev = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(ev, { prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: 'dismissed' }) });
      window.dispatchEvent(ev);
    });
    menu = await openMenu(page);
    await expect(install).toBeVisible();
    await install.getByRole('button', { name: '安装' }).click();
    await expect(install).toContainText('没有安装。以后想装，可以再回到这里。');
    // the used-up 安装 is gone; focus went to the answer, not to <body>
    await expect(install.getByRole('button', { name: '安装' })).toHaveCount(0);
    await expect(install.getByRole('status')).toBeFocused();
  });
});

test.describe('menu on an iPhone', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });

  test('添加到主屏幕 explains 分享 → 添加到主屏幕', async ({ page }) => {
    await boot(page);
    const menu = await openMenu(page);
    const install = menu.getByRole('region', { name: '添加到主屏幕' });
    await expect(install).toBeVisible();
    const steps = install.getByRole('listitem');
    await expect(steps).toHaveText(['点底部的「分享」按钮（新版 Safari 先点「⋯」）', '选「添加到主屏幕」', '点「添加」']);
  });
});
