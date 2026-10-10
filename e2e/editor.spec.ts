import { expect, test } from './fixtures';
import {
  boot,
  cellOf,
  complete,
  detail,
  dialog,
  expectHud,
  expectToast,
  hasStemInto,
  node,
  pressAgain,
  selectNode,
  tab,
  textContrast,
  tree,
} from './helpers';

test.describe('node editor', () => {
  test('a new achievement under a parent appears connected and selected', async ({ page }, info) => {
    await boot(page);
    await selectNode(page, info, 'o_start');
    await detail(page).getByRole('button', { name: '+ 后续进度' }).click();

    const ed = dialog(page, '新建进度 · 起源');
    await expect(ed).toBeVisible();
    await expect(ed.getByRole('checkbox', { name: '开局一棵树' })).toBeChecked();
    await expect(ed.getByLabel(/^名称/)).toBeFocused();
    await ed.getByLabel(/^名称/).fill('第一次登山');
    await ed.getByLabel('完成条件').fill('登上一座海拔1000米以上的山');
    await ed.getByRole('radio', { name: '指南针' }).check();
    await ed.getByRole('button', { name: '添加到进度树' }).click();
    await expect(ed).toBeHidden();

    await expect(tree(page).locator('.node')).toHaveCount(15);
    const added = tree(page).locator('.node.sel');
    await expect(added).toHaveCount(1);
    await expect(added).toHaveAccessibleName('第一次登山，任务，未解锁');
    const id = (await added.getAttribute('data-id')) ?? '';
    expect(id).not.toBe('');
    await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText('第一次登山');
    await expect(detail(page).locator('[data-goto="o_start"]')).toContainText('开局一棵树');
    await expectToast(page, '新进度已添加', '第一次登山');
    // one column right of its prerequisite, with a connector line ending at it
    expect((await cellOf(page, id, 'o_start', 0)).x).toBe(1);
    await expect.poll(() => hasStemInto(page, id)).toBe(true);
    await expect(tab(page, '起源')).toHaveAccessibleName('起源，已达成 0/15');
  });

  test('edit title, type and prerequisites', async ({ page }, info) => {
    await boot(page);
    await selectNode(page, info, 'o_road');
    await detail(page).getByRole('button', { name: '编辑' }).click();

    const ed = dialog(page, '编辑进度');
    await expect(ed).toBeVisible();
    await expect(ed.getByLabel(/^名称/)).toHaveValue('离开出生点');
    await expect(ed.getByLabel('完成条件')).not.toHaveValue('');
    await expect(ed.getByRole('radio', { name: /^目标/ })).toBeChecked();
    await expect(ed.getByRole('checkbox', { name: '清点库存' })).toBeChecked();

    await ed.getByLabel(/^名称/).fill('出门看看');
    await ed.getByRole('radio', { name: /^挑战/ }).check();
    // 亲手合成 sits in the same column, so the node has to move one column right
    await ed.getByRole('checkbox', { name: '亲手合成' }).check();
    await ed.getByRole('button', { name: '保存' }).click();
    await expect(ed).toBeHidden();

    const d = detail(page);
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('出门看看');
    await expect(d.locator('.dmeta')).toHaveText('挑战 · 起源');
    // a custom XP / emerald value is kept when the type changes
    await expect(d).toContainText('+80 经验');
    await expect(d).toContainText('+4 绿宝石');
    await expect(d.locator('[data-goto="o_wealth"]')).toContainText('清点库存');
    await expect(d.locator('[data-goto="o_craft"]')).toContainText('亲手合成');
    await expect(node(page, 'o_road')).toHaveAccessibleName('出门看看，挑战，未解锁');
    await expect.poll(async () => (await cellOf(page, 'o_road', 'o_start', 0)).x).toBe(4);
    await expect.poll(() => hasStemInto(page, 'o_road')).toBe(true);

    // a type change on an achievement still at the defaults follows the new type
    await selectNode(page, info, 'o_mind');
    await expect(detail(page)).toContainText('+40 经验');
    await detail(page).getByRole('button', { name: '编辑' }).click();
    const ed2 = dialog(page, '编辑进度');
    await ed2.getByRole('radio', { name: /^目标/ }).check();
    await ed2.getByRole('button', { name: '保存' }).click();
    await expect(ed2).toBeHidden();
    await expect(detail(page)).toContainText('+120 经验');
    await expect(detail(page)).toContainText('+6 绿宝石');
  });

  test('prerequisites that cannot be picked stay readable', async ({ page }, info) => {
    await boot(page);
    await selectNode(page, info, 'o_water');
    await detail(page).getByRole('button', { name: '编辑' }).click();
    const ed = dialog(page, '编辑进度');
    // 甜蜜的梦 sits in 无限水源's own column, too close to its followers to be a prerequisite
    const blocked = ed.getByRole('checkbox', { name: '甜蜜的梦' });
    await expect(blocked).toBeDisabled();
    const chip = ed.locator('.seg label').filter({ has: page.getByRole('checkbox', { name: '甜蜜的梦' }) });
    await expect(chip).toHaveCSS('cursor', 'not-allowed');
    expect(await textContrast(chip)).toBeGreaterThanOrEqual(4.5);
  });

  test('delete with the two-step button', async ({ page }, info) => {
    await boot(page);
    // a leaf nothing depends on (in a locked area: it can still be edited)
    await tab(page, '体魄').click();
    await selectNode(page, info, 'b_swim');
    await detail(page).getByRole('button', { name: '编辑' }).click();
    const ed = dialog(page, '编辑进度');
    await ed.getByRole('button', { name: '删除这个进度' }).click();
    const again = ed.getByRole('button', { name: '再点一次删除' });
    await expect(again).toBeVisible();
    await expect(node(page, 'b_swim')).toHaveCount(1);
    await pressAgain(page, again);
    await expect(ed).toBeHidden();
    await expect(node(page, 'b_swim')).toHaveCount(0);
    await expect(tree(page).locator('.node')).toHaveCount(13);
    // the panel lets go of it: the overview on desktop, a closed sheet on phones
    if (page.viewportSize()!.width >= 860) await expect(detail(page)).toHaveAccessibleName('领域概览');
    else await expect(detail(page)).not.toHaveClass(/\bopen\b/);
    await expect(tree(page).locator('.node.sel')).toHaveCount(0);
    await expect(page.locator('.hud')).toContainText('已达成 0/96');
  });

  test('deleting the root or a node others depend on is blocked with the reason', async ({ page }, info) => {
    await boot(page);
    const blocked = async (id: string, msg: string) => {
      await selectNode(page, info, id);
      await detail(page).getByRole('button', { name: '编辑' }).click();
      const ed = dialog(page, '编辑进度');
      await ed.getByRole('button', { name: '删除这个进度' }).click();
      await expect(ed.getByRole('alert').filter({ hasText: msg })).toHaveText(msg);
      await expect(ed.getByRole('button', { name: '再点一次删除' })).toHaveCount(0);
      await page.keyboard.press('Escape');
      if (await ed.isVisible()) await page.keyboard.press('Escape');
      await expect(ed).toBeHidden();
      await expect(node(page, id)).toHaveCount(1);
    };
    await blocked('o_start', '起点进度不能删除，可以删除整个领域。');
    await blocked('o_sleep', '先删除或修改「知识之书」「掉一格鸡腿」，它们把这个进度当作前置。');
    // a hidden dependant is named by its real title
    await blocked('o_home', '先删除或修改「那棵树长大了」，它们把这个进度当作前置。');
  });

  test('new achievements under a crowded parent are all placed and connected', async ({ page }, info) => {
    await boot(page, 'blank');
    const names = ['一', '二', '三', '四', '五', '六', '七'].map(n => `后续${n}`);
    for (const name of names) {
      await selectNode(page, info, 'o_start');
      await detail(page).getByRole('button', { name: '+ 后续进度' }).click();
      const ed = dialog(page, '新建进度 · 起源');
      await ed.getByLabel(/^名称/).fill(name);
      await ed.getByLabel('完成条件').fill('试一试');
      await ed.getByRole('button', { name: '添加到进度树' }).click();
      await expect(ed).toBeHidden();
      await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText(name);
    }
    const ids = await tree(page).locator('.node').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id ?? ''));
    expect(ids).toHaveLength(names.length + 1);
    const cells = new Set<string>();
    for (const id of ids) {
      const c = await cellOf(page, id, 'o_start', 0);
      cells.add(`${c.x},${c.y}`);
      if (id === 'o_start') continue;
      expect(c.x, `${id} sits right of the root`).toBe(1);
      expect(await hasStemInto(page, id), `${id} is connected`).toBe(true);
    }
    expect(cells.size, 'every achievement has its own cell').toBe(ids.length);
  });

  test('the editor says what is missing', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: '+ 新建' }).click();
    const ed = dialog(page, '新建进度 · 起源');
    // with nothing selected the new achievement hangs off the root
    await expect(ed.getByRole('checkbox', { name: '开局一棵树' })).toBeChecked();
    await ed.getByRole('button', { name: '添加到进度树' }).click();
    await expect(ed.getByRole('alert').filter({ hasText: '给这个进度起个名字。' })).toBeVisible();
    await ed.getByLabel(/^名称/).fill('早睡');
    await ed.getByRole('button', { name: '添加到进度树' }).click();
    await expect(ed.getByRole('alert').filter({ hasText: '写一句完成条件' })).toBeVisible();
    await ed.getByLabel('完成条件').fill('连续7天早起');
    await ed.getByLabel('累计目标（可不填）').fill('1');
    await ed.getByRole('button', { name: '添加到进度树' }).click();
    await expect(ed.getByRole('alert').filter({ hasText: '累计目标填2到9999之间的整数，或者留空。' })).toBeVisible();
    await ed.getByLabel('累计目标（可不填）').fill('7');
    await ed.getByLabel('单位').fill('天');
    await ed.getByRole('button', { name: '添加到进度树' }).click();
    await expect(ed).toBeHidden();
    await expect(detail(page).locator('.pbar')).toHaveText('0/7 天');
    await expect(tree(page).locator('.node')).toHaveCount(15);
  });

  test('a done achievement keeps its XP and emeralds on a type change unless typed in 高级', async ({ page }, info) => {
    await boot(page);
    for (const id of ['o_start', 'o_sleep', 'o_mind']) await complete(page, info, id);
    // 20 + 20 + 40 XP = 80: level 4 exactly; 1 + 1 + 2 emeralds
    await expectHud(page, { level: '4', xp: '0/30', emeralds: '4' });

    await selectNode(page, info, 'o_mind');
    await detail(page).getByRole('button', { name: '编辑' }).click();
    let ed = dialog(page, '编辑进度');
    await ed.getByRole('radio', { name: /^目标/ }).check();
    await ed.getByRole('button', { name: '保存' }).click();
    await expect(ed).toBeHidden();
    await expect(detail(page).locator('.dmeta')).toHaveText('目标 · 起源');
    await expect(detail(page)).toContainText('+40 经验');
    await expect(detail(page)).toContainText('+2 绿宝石');
    await expectHud(page, { level: '4', xp: '0/30', emeralds: '4' });

    await detail(page).getByRole('button', { name: '编辑' }).click();
    ed = dialog(page, '编辑进度');
    await expect(ed.getByText('这个进度已经完成，换类型不会改变它给过的经验和绿宝石。要改就在这里改。')).toBeAttached();
    const xp = ed.getByRole('spinbutton', { name: '经验', exact: true });
    if (!(await xp.isVisible())) await ed.getByText('高级', { exact: true }).click();
    await xp.fill('100');
    await ed.getByRole('spinbutton', { name: '绿宝石', exact: true }).fill('5');
    await ed.getByRole('button', { name: '保存' }).click();
    await expect(ed).toBeHidden();
    await expect(detail(page)).toContainText('+100 经验');
    // 140 XP: level 5 (110), 30 of 34; 1 + 1 + 5 emeralds
    await expectHud(page, { level: '5', xp: '30/34', emeralds: '7' });
  });

  test('a root takes achievements of other areas as its gateway', async ({ page }, info) => {
    await boot(page);
    await tab(page, '学识').click();
    await expect(tree(page).getByText('完成「起源 · 知识之书」后解锁这个领域')).toBeVisible();
    await selectNode(page, info, 'm_bookshelf');
    await detail(page).getByRole('button', { name: '编辑' }).click();
    const ed = dialog(page, '编辑进度');
    await expect(ed.getByText('这是「学识」的起点进度。', { exact: false })).toBeVisible();
    const gate = ed.getByRole('checkbox', { name: '知识之书' });
    await expect(gate).toBeChecked();
    await gate.uncheck();
    await ed.getByRole('checkbox', { name: '开局一棵树' }).check();
    await ed.getByRole('button', { name: '保存' }).click();
    await expect(ed).toBeHidden();
    await expect(tree(page).getByText('完成「起源 · 开局一棵树」后解锁这个领域')).toBeVisible();

    await tree(page).getByRole('button', { name: '去看看' }).click();
    await complete(page, info, 'o_start');
    await expect(tab(page, '学识')).toHaveAccessibleName('学识，已达成 0/14');
  });
});
