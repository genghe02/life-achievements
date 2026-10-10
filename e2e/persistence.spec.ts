/// <reference lib="dom" />
import { expect, test } from './fixtures';
import {
  boot,
  complete,
  detail,
  dialog,
  expectHud,
  expectToast,
  node,
  openMenu,
  pressAgain,
  selectNode,
  tab,
  tabs,
  tree,
} from './helpers';

test.describe('persistence', () => {
  test('a change is there after an immediate reload', async ({ page }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    // no waiting for the debounced save: the page has to keep it on the way out
    await page.reload();
    await expect(tree(page)).toBeVisible();
    await expect(node(page, 'o_start')).toHaveClass(/\bdone\b/);
    await expectHud(page, { level: '1', xp: '6/18', emeralds: '1' });

    // a second change right after the first reload
    await complete(page, info, 'o_water');
    await page.reload();
    await expect(tree(page)).toBeVisible();
    await expect(node(page, 'o_water')).toHaveClass(/\bdone\b/);
    await expect(page.locator('.hud')).toContainText('已达成 2/97');
  });

  test('a change is there after the page is closed right after it', async ({ page, context }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    await page.close();

    const again = await context.newPage();
    await again.goto('./');
    await expect(tree(again)).toBeVisible();
    await expect(node(again, 'o_start')).toHaveClass(/\bdone\b/);
    await expect(again.locator('.hud')).toContainText('已达成 1/97');
  });

  test('the onboarding choice is kept when the page closes at once', async ({ page, context }) => {
    await boot(page, 'blank');
    await page.close();
    const again = await context.newPage();
    await again.goto('./');
    await expect(tree(again)).toBeVisible();
    await expect(again.getByRole('button', { name: '空白开始' })).toHaveCount(0);
    await expect(again.locator('.hud')).toContainText('已达成 0/7');
  });

  test('a note still being typed is kept when the page closes', async ({ page, context }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    await detail(page).getByLabel('感想（可不填）').fill('写到一半');
    // no blur: the field still has focus when the page goes away
    await page.close();

    const again = await context.newPage();
    await again.goto('./');
    await expect(tree(again)).toBeVisible();
    await selectNode(again, info, 'o_start');
    await expect(detail(again).getByLabel('感想（可不填）')).toHaveValue('写到一半');
  });

  test('two open pages: a change in each, made one after the other, are both kept', async ({ page, context }, info) => {
    await boot(page);
    // the onboarding choice has landed once a second page opens on the tree
    const other = await context.newPage();
    await expect.poll(async () => {
      await other.goto('./');
      return tree(other).isVisible();
    }, { message: 'the second page opens on the tree' }).toBe(true);

    await complete(page, info, 'o_start');
    // the other page takes over the newer data instead of keeping its older copy
    await expect(node(other, 'o_start')).toHaveClass(/\bdone\b/);

    await other.getByRole('button', { name: '领域设置' }).click();
    const set = dialog(other, '领域设置');
    await set.getByLabel(/^名称/).fill('出发');
    await set.getByRole('button', { name: '保存' }).click();
    await expect(set).toBeHidden();
    await expect(page.locator('.whead h1')).toHaveText('出发');

    await page.reload();
    await expect(tree(page)).toBeVisible();
    await expect(page.locator('.whead h1')).toHaveText('出发');
    await expect(node(page, 'o_start')).toHaveClass(/\bdone\b/);
    await expect(page.locator('.hud')).toContainText('已达成 1/97');
  });

  test('the current area is remembered', async ({ page }) => {
    await boot(page);
    await tab(page, '学识').click();
    await expect(tab(page, '学识')).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await expect(tree(page)).toBeVisible();
    await expect(tab(page, '学识')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.whead h1')).toHaveText('学识');
  });
});

test.describe('storage', () => {
  test('persistent storage is asked for once, after the first completion', async ({ page }, info) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __persistCalls: number };
      w.__persistCalls = 0;
      if (navigator.storage) {
        Object.defineProperty(navigator.storage, 'persist', {
          configurable: true,
          value: () => {
            w.__persistCalls++;
            return Promise.resolve(true);
          },
        });
      }
    });
    const calls = () => page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls);
    await boot(page);
    expect(await calls()).toBe(0);
    await complete(page, info, 'o_start');
    await expect.poll(calls).toBe(1);
    await complete(page, info, 'o_water');
    expect(await calls()).toBe(1);
  });

  test('without IndexedDB the data goes to localStorage, with a warning in the menu', async ({ page }, info) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
    });
    await boot(page);
    await complete(page, info, 'o_start');
    const menu = await openMenu(page);
    await expect(menu.getByRole('region', { name: '数据' })).toContainText('浏览器不支持本地数据库，数据存得不够稳，记得常备份。');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(tree(page)).toBeVisible();
    await expect(node(page, 'o_start')).toHaveClass(/\bdone\b/);
  });

  test('when IndexedDB refuses to open, the app still starts and keeps the data', async ({ page }, info) => {
    await page.addInitScript(() => {
      IDBFactory.prototype.open = function open() {
        throw new DOMException('The user denied permission to access the database.', 'SecurityError');
      };
    });
    await boot(page);
    await complete(page, info, 'o_start');
    const menu = await openMenu(page);
    await expect(menu.getByRole('region', { name: '数据' })).toContainText('浏览器不支持本地数据库');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(tree(page)).toBeVisible();
    await expect(node(page, 'o_start')).toHaveClass(/\bdone\b/);
  });

  test('a daily snapshot keeps the data from before the day\'s first change and can be restored', async ({ page }, info) => {
    const day1 = new Date('2026-03-02T09:00:00');
    await page.clock.setSystemTime(day1);
    await boot(page);
    await complete(page, info, 'o_start');
    await expect(page.locator('.hud')).toContainText('已达成 1/97');
    // the next morning, one more completion: the first save of the day keeps yesterday's data
    await page.clock.setSystemTime(new Date('2026-03-03T09:00:00'));
    await complete(page, info, 'o_water');
    await expect(page.locator('.hud')).toContainText('已达成 2/97');

    const menu = await openMenu(page);
    const snaps = menu.getByRole('region', { name: '数据' }).locator('details', { hasText: '自动快照' });
    await snaps.getByText(/^自动快照/).click();
    const row = snaps.locator('li').filter({ hasText: '已达成 1/97' });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: '恢复到这一天' }).click();
    await pressAgain(page, row.getByRole('button', { name: '再点一次恢复' }));
    await expect(menu).toBeHidden();
    await expectToast(page, '已恢复');
    await expect(page.locator('.hud')).toContainText('已达成 1/97');
    await expect(node(page, 'o_water')).toHaveClass(/\bopen\b/);
  });
});

test.describe('replacing the data', () => {
  test('an import keeps a copy of the data it replaced, which the menu can bring back', async ({ page }, info) => {
    await boot(page);
    // a backup with nothing done yet
    let menu = await openMenu(page);
    const [download] = await Promise.all([page.waitForEvent('download'), menu.getByRole('button', { name: '导出备份' }).click()]);
    const empty = await download.path();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await complete(page, info, 'o_start');
    await complete(page, info, 'o_water');
    await expect(page.locator('.hud')).toContainText('已达成 2/97');

    menu = await openMenu(page);
    await menu.locator('input[type=file]').setInputFiles(empty);
    await menu.getByRole('button', { name: '用这份备份替换现在的数据' }).click();
    await pressAgain(page, menu.getByRole('button', { name: '再点一次确认替换' }));
    await expect(menu).toBeHidden();
    await expect(page.locator('.hud')).toContainText('已达成 0/97');

    menu = await openMenu(page);
    const snaps = menu.getByRole('region', { name: '数据' }).locator('details', { hasText: '自动快照' });
    await snaps.getByText(/^自动快照/).click();
    const copy = snaps.locator('li').filter({ hasText: '替换前' });
    await expect(copy).toHaveCount(1);
    await expect(copy).toContainText('已达成 2/97');
    await copy.getByRole('button', { name: '恢复这份' }).click();
    await pressAgain(page, copy.getByRole('button', { name: '再点一次恢复' }));
    await expect(menu).toBeHidden();
    await expectToast(page, '已恢复', '替换前的数据');
    await expect(page.locator('.hud')).toContainText('已达成 2/97');

    await page.reload();
    await expect(tree(page)).toBeVisible();
    await expect(node(page, 'o_start')).toHaveClass(/\bdone\b/);
    await expect(node(page, 'o_water')).toHaveClass(/\bdone\b/);
  });
});

test.describe('offline', () => {
  test('after the first load the app loads and works offline', async ({ page, context }, info) => {
    await boot(page);
    await expectToast(page, '离线可用', '已经可以离线使用了。');
    // the service worker is active, so everything it precaches is in its cache
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });

    await context.setOffline(true);
    await page.reload();
    await expect(tree(page)).toBeVisible();
    await expect(tabs(page)).toHaveCount(7);
    await expect(node(page, 'o_start')).toBeVisible();
    // the pixel fonts come from the cache too
    expect(await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('16px Unifont', '人生') && document.fonts.check('12px FusionPixel12', '人生');
    })).toBe(true);

    await complete(page, info, 'o_start');
    await expectHud(page, { level: '1', xp: '6/18', emeralds: '1' });
    const menu = await openMenu(page);
    await expect(menu.getByRole('region', { name: '统计' })).toContainText('1/97');
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(tree(page)).toBeVisible();
    await expect(node(page, 'o_start')).toHaveClass(/\bdone\b/);
    await context.setOffline(false);
  });
});
