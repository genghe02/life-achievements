import { expect, test } from './fixtures';
import {
  boot,
  complete,
  detail,
  expectDetailFor,
  expectHud,
  expectToast,
  node,
  pageToday,
  pastFlipGuard,
  pressAgain,
  reload,
  selectNode,
  tab,
  tree,
} from './helpers';

test.describe('progress', () => {
  test('完成 an open achievement: HUD, toast and unlocks; 撤销完成 restores it', async ({ page }, info) => {
    await boot(page);
    await expectHud(page, { level: '0', xp: '0/14', emeralds: '0' });
    const kids = ['o_sleep', 'o_water', 'o_tidy'];
    for (const k of kids) await expect(node(page, k)).toHaveClass(/\blocked\b/);

    await selectNode(page, info, 'o_start');
    await expect(detail(page).getByText('可以开始', { exact: true })).toBeVisible();
    await expect(detail(page)).toContainText('+20 经验');
    await expect(detail(page)).toContainText('+1 绿宝石');
    await detail(page).getByRole('button', { name: '完成进度' }).click();

    await expectToast(page, '进度已达成！', '开局一棵树');
    // 20 XP: level 1 (14 XP), 6 of the 18 to level 2; one emerald
    await expectHud(page, { level: '1', xp: '6/18', emeralds: '1' });
    await expectToast(page, '等级提升！', '人生等级 1 · 新手');
    await expect(node(page, 'o_start')).toHaveClass(/\bdone\b/);
    for (const k of kids) await expect(node(page, k)).toHaveClass(/\bopen\b/);
    await expect(detail(page).getByText(`✓ 已达成 · ${await pageToday(page)}`)).toBeVisible();
    await expect(tab(page, '起源')).toHaveAccessibleName('起源，已达成 1/14');
    await expect(page.locator('.hud')).toContainText('已达成 1/97');

    await pastFlipGuard(page);
    await detail(page).getByRole('button', { name: '撤销完成' }).click();
    await expect(detail(page).getByRole('button', { name: '完成进度' })).toBeVisible();
    await expectHud(page, { level: '0', xp: '0/14', emeralds: '0' });
    await expect(node(page, 'o_start')).toHaveClass(/\bopen\b/);
    for (const k of kids) await expect(node(page, k)).toHaveClass(/\blocked\b/);
    await expect(tab(page, '起源')).toHaveAccessibleName('起源，已达成 0/14');
  });

  test('undo is refused while a later achievement is done', async ({ page }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    await complete(page, info, 'o_water');
    await selectNode(page, info, 'o_start');
    await pastFlipGuard(page);
    await detail(page).getByRole('button', { name: '撤销完成' }).click();
    await expect(detail(page).getByRole('alert')).toHaveText('先撤销「无限水源」的完成，再撤销这个。');
    await expect(node(page, 'o_start')).toHaveClass(/\bdone\b/);
  });

  test('undo is refused while a done achievement in another area depends on it', async ({ page }, info) => {
    await boot(page);
    for (const id of ['o_start', 'o_sleep', 'o_water', 'o_body']) await complete(page, info, id);
    await tab(page, '体魄').click();
    await complete(page, info, 'b_warm_up');
    await tab(page, '起源').click();
    await selectNode(page, info, 'o_body');
    await pastFlipGuard(page);
    await detail(page).getByRole('button', { name: '撤销完成' }).click();
    await expect(detail(page).getByRole('alert')).toHaveText('先撤销「热身完毕」的完成，再撤销这个。');
    await expect(node(page, 'o_body')).toHaveClass(/\bdone\b/);
    await expect(tab(page, '体魄')).toHaveAccessibleName('体魄，已达成 1/14');
  });

  test('counter: +1 / 减一 up to the target completes it', async ({ page }, info) => {
    await boot(page);
    for (const id of ['o_start', 'o_sleep', 'o_water', 'o_body']) await complete(page, info, id);
    await expectHud(page, { level: '4', xp: '10/30', emeralds: '5' });

    await selectNode(page, info, 'o_offline');
    const d = detail(page);
    const inc = d.getByRole('button', { name: '+1' });
    const dec = d.getByRole('button', { name: '减一' });
    await expect(d.locator('.pbar')).toHaveText('0/7 天');
    await expect(dec).toBeDisabled();
    for (let i = 0; i < 3; i++) await inc.click();
    await expect(d.locator('.pbar')).toHaveText('3/7 天');
    await expect(d.getByText('进行中 · 3/7 天')).toBeVisible();
    await expect(node(page, 'o_offline')).toHaveAccessibleName('离线模式，目标，进行中 3/7');
    await dec.click();
    await expect(d.locator('.pbar')).toHaveText('2/7 天');
    for (let i = 0; i < 4; i++) await inc.click();
    await expect(d.locator('.pbar')).toHaveText('6/7 天');
    await expect(node(page, 'o_offline')).not.toHaveClass(/\bdone\b/);
    await inc.click();

    await expect(node(page, 'o_offline')).toHaveClass(/\bdone\b/);
    await expect(d.getByText(/^✓ 已达成 · /)).toBeVisible();
    await expect(d.locator('.pbar')).toHaveText('7/7 天');
    // 90 + 120 XP = 210: level 7 (182 XP), 28 of the 42 to level 8; 5 + 6 emeralds
    await expectHud(page, { level: '7', xp: '28/42', emeralds: '11' });

    // undo goes back to one short of the target
    await pastFlipGuard(page);
    await d.getByRole('button', { name: '撤销完成' }).click();
    await expect(d.locator('.pbar')).toHaveText('6/7 天');
    await expect(d.getByRole('button', { name: '+1' })).toBeVisible();
  });

  test('a locked area opens when its gateway in another area is done', async ({ page }, info) => {
    // the unlock toast queues behind every completion and level-up toast before it
    test.setTimeout(120_000);
    await boot(page);
    await tab(page, '体魄').click();
    await expect(tab(page, '体魄')).toHaveAttribute('aria-selected', 'true');
    await expect(tree(page).getByText('完成「起源 · 掉一格鸡腿」后解锁这个领域')).toBeVisible();
    await expect(node(page, 'b_warm_up')).toHaveClass(/\blocked\b/);

    // 「去看看」 jumps to the gateway in 起源
    await tree(page).getByRole('button', { name: '去看看' }).click();
    await expect(tab(page, '起源')).toHaveAttribute('aria-selected', 'true');
    await expect(node(page, 'o_body')).toHaveClass(/\bsel\b/);
    await expect(detail(page).getByRole('button', { name: '先完成前置进度' })).toBeDisabled();

    for (const id of ['o_start', 'o_sleep', 'o_water', 'o_body']) await complete(page, info, id);
    await expect(tab(page, '体魄')).toHaveAccessibleName('体魄，已达成 0/14');
    await expectToast(page, '新领域已解锁！', '体魄', 60_000);

    await tab(page, '体魄').click();
    await expect(tab(page, '体魄')).toHaveAttribute('aria-selected', 'true');
    await expect(node(page, 'b_warm_up')).toHaveClass(/\bopen\b/);
    await expect(tree(page).getByRole('button', { name: '去看看' })).toHaveCount(0);
    // the other areas keep their own gateways
    await expect(tab(page, '学识')).toHaveAccessibleName('学识，未解锁');
  });

  test('done details: 达成日期 and 感想 are saved and survive a reload', async ({ page }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    const today = await pageToday(page);
    const d = detail(page);
    const date = d.getByLabel('达成日期');
    const note = d.getByLabel('感想（可不填）');
    await expect(date).toHaveValue(today);
    await expect(date).toHaveAttribute('max', today);

    // not in the future
    await date.fill('2999-01-01');
    await date.blur();
    await expect(d.getByRole('alert').filter({ hasText: '达成日期不能晚于今天。' })).toBeVisible();
    await expect(date).toHaveValue(today);

    await date.fill('2025-03-14');
    await expect(d.getByText('✓ 已达成 · 2025-03-14')).toBeVisible();
    await note.fill('终于开始了，先写下三件事。');
    await note.blur();
    await expect(d.getByText('感想已保存。')).toBeVisible();

    await reload(page);
    await selectNode(page, info, 'o_start');
    await expect(detail(page).getByLabel('达成日期')).toHaveValue('2025-03-14');
    await expect(detail(page).getByLabel('感想（可不填）')).toHaveValue('终于开始了，先写下三件事。');
    await expect(detail(page).getByText('✓ 已达成 · 2025-03-14')).toBeVisible();

    // undo would drop the note: it asks twice
    const undo = detail(page).getByRole('button', { name: '撤销完成' });
    await undo.click();
    const again = detail(page).getByRole('button', { name: '再点一次撤销（感想会删掉）' });
    await expect(again).toBeVisible();
    await expect(node(page, 'o_start')).toHaveClass(/\bdone\b/);
    await pressAgain(page, again);
    await expect(node(page, 'o_start')).toHaveClass(/\bopen\b/);
  });

  test('a prerequisite in another area is shown as 「领域 · 名称」 and jumps there', async ({ page }) => {
    await boot(page);
    await tab(page, '体魄').click();
    await tree(page).getByRole('button', { name: '去看看' }).waitFor();
    // the root of 体魄 is on screen at its home view
    await node(page, 'b_warm_up').click();
    const row = detail(page).locator('[data-goto="o_body"]');
    await expect(row).toContainText('起源 · 掉一格鸡腿');
    await expect(row).toContainText('✗ 未达成');
    await row.click();
    await expect(tab(page, '起源')).toHaveAttribute('aria-selected', 'true');
    await expect(node(page, 'o_body')).toHaveClass(/\bsel\b/);
    await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText('掉一格鸡腿');
    await expect(detail(page).getByRole('heading', { level: 2 })).toBeFocused();
  });

  test('Esc in the 感想 field leaves the field and saves it; the next Esc closes the panel', async ({ page }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    const note = detail(page).getByLabel('感想（可不填）');
    await note.fill('先写一句');
    await page.keyboard.press('Escape');
    await expect(note).not.toBeFocused();
    await expect(node(page, 'o_start')).toHaveClass(/\bsel\b/);
    await expect(detail(page).getByText('感想已保存。')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(node(page, 'o_start')).not.toHaveClass(/\bsel\b/);
    await selectNode(page, info, 'o_start');
    await expect(detail(page).getByLabel('感想（可不填）')).toHaveValue('先写一句');
  });

  test('the phone overview lists what can be done now', async ({ page }, info) => {
    await boot(page);
    await complete(page, info, 'o_start');
    if (page.viewportSize()!.width < 860) {
      await detail(page).getByRole('button', { name: '关闭' }).click();
      await page.getByRole('button', { name: '概览' }).click();
    } else {
      await page.keyboard.press('Escape');
    }
    const d = detail(page);
    await expect(d).toHaveAccessibleName('领域概览');
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('起源');
    await expect(d.getByRole('heading', { name: '现在可以做' })).toBeVisible();
    for (const id of ['o_sleep', 'o_water', 'o_tidy']) await expect(d.locator(`[data-goto="${id}"]`)).toBeVisible();
    await expect(d.getByRole('heading', { name: '最近达成' })).toBeVisible();
    await expect(d.locator('[data-goto="o_start"]')).toBeVisible();
    await d.locator('[data-goto="o_tidy"]').click();
    await expect(node(page, 'o_tidy')).toHaveClass(/\bsel\b/);
    await expectDetailFor(page, 'o_tidy');
  });
});
