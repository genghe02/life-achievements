import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  boot,
  cellOf,
  cellPoint,
  centreOf,
  drag,
  hasStemInto,
  reload,
  tree,
  viewSettled,
  worldTransform,
  type Point,
} from './helpers';

const arrangeButton = (page: Page) => page.getByRole('button', { name: '整理' });
const target = (page: Page) => tree(page).locator('.cell-target');

/** Turn on arrange mode and show the whole tree. */
async function startArranging(page: Page): Promise<void> {
  await arrangeButton(page).click();
  await expect(arrangeButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(tree(page).getByText('拖动进度换个位置。')).toBeVisible();
  await page.getByRole('button', { name: '全览' }).click();
  await viewSettled(page);
}

/** A point of the tree with no node, button or bar under it. */
async function emptySpot(page: Page): Promise<Point> {
  const p = await page.evaluate(() => {
    const vp = document.getElementById('vp')!.getBoundingClientRect();
    for (let fy = 0.3; fy < 0.9; fy += 0.05) {
      for (let fx = 0.1; fx < 0.9; fx += 0.05) {
        const x = vp.left + vp.width * fx, y = vp.top + vp.height * fy;
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('#vp') && !el.closest('.node, button, .arr-hint, .vbanner, .vctl')) return { x, y };
      }
    }
    return null;
  });
  if (!p) throw new Error('no empty spot in the tree');
  return p;
}

test.describe('arrange mode', () => {
  test('drag a node to a free cell: it moves, stays connected and survives a reload', async ({ page }, info) => {
    await boot(page);
    await startArranging(page);
    expect(await cellOf(page, 'o_road', 'o_start', 0)).toEqual({ x: 3, y: 3 });

    const to = await cellPoint(page, 'o_road', { x: 3, y: 3 }, { x: 3, y: 2 });
    await drag(page, info, await centreOf(page, 'o_road'), to, async () => {
      await expect(target(page)).toBeAttached();
      await expect(target(page)).toHaveClass(/\bok\b/);
    });
    await expect.poll(() => cellOf(page, 'o_road', 'o_start', 0)).toEqual({ x: 3, y: 2 });
    await expect.poll(() => hasStemInto(page, 'o_road')).toBe(true);
    await expect(tree(page).getByText('拖动进度换个位置。')).toBeVisible();

    await tree(page).getByRole('button', { name: '完成' }).click();
    await expect(arrangeButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(tree(page).getByText('拖动进度换个位置。')).toHaveCount(0);

    await reload(page);
    expect(await cellOf(page, 'o_road', 'o_start', 0)).toEqual({ x: 3, y: 2 });
  });

  test('an invalid cell shows red and the node snaps back', async ({ page }, info) => {
    await boot(page);
    await startArranging(page);
    const home = await cellOf(page, 'o_road', 'o_start', 0);
    expect(home).toEqual({ x: 3, y: 3 });

    // the column of its own prerequisite 清点库存
    const to = await cellPoint(page, 'o_road', home, { x: 2, y: 2 });
    await drag(page, info, await centreOf(page, 'o_road'), to, async () => {
      await expect(target(page)).toHaveClass(/\bbad\b/);
    });
    await expect(tree(page).getByText('进度要放在所有前置进度的右边、后续进度的左边。')).toBeVisible();
    await expect.poll(() => cellOf(page, 'o_road', 'o_start', 0)).toEqual(home);
    await expect(target(page)).toBeHidden();
    // the slide back has ended
    await expect(tree(page).locator('.node[data-id="o_road"]')).not.toHaveClass(/\bsnap\b/);

    // onto another achievement
    const taken = await cellPoint(page, 'o_road', home, { x: 3, y: 1 });
    await drag(page, info, await centreOf(page, 'o_road'), taken, async () => {
      await expect(target(page)).toHaveClass(/\bbad\b/);
    });
    await expect.poll(() => cellOf(page, 'o_road', 'o_start', 0)).toEqual(home);
    expect(await cellOf(page, 'o_craft', 'o_start', 0)).toEqual({ x: 3, y: 1 });

    await reload(page);
    expect(await cellOf(page, 'o_road', 'o_start', 0)).toEqual(home);
  });

  test('a node moved above the top row lands there and every other node keeps its cell', async ({ page }, info) => {
    await boot(page);
    await startArranging(page);
    // 知识之书 sits in the top row (-3); its prerequisite 甜蜜的梦 is at (1, -2)
    expect(await cellOf(page, 'o_mind', 'o_start', 0)).toEqual({ x: 2, y: -3 });
    const others = ['o_start', 'o_sleep', 'o_bond', 'o_road', 'o_tree'];
    const before = await Promise.all(others.map(id => cellOf(page, id, 'o_start', 0)));
    const to = await cellPoint(page, 'o_mind', { x: 2, y: -3 }, { x: 2, y: -4 });
    await drag(page, info, await centreOf(page, 'o_mind'), to, async () => {
      await expect(target(page)).toHaveClass(/\bok\b/);
    });
    await expect.poll(() => cellOf(page, 'o_mind', 'o_start', 0)).toEqual({ x: 2, y: -4 });
    expect(await Promise.all(others.map(id => cellOf(page, id, 'o_start', 0)))).toEqual(before);
    await expect.poll(() => hasStemInto(page, 'o_mind')).toBe(true);
    // drawn where its cell is: one row above the old top row
    const top = (id: string) => tree(page).locator(`.node[data-id="${id}"]`).evaluate(e => parseFloat((e as HTMLElement).style.top));
    expect(await top('o_mind')).toBeLessThan(await top('o_bond'));
    await reload(page);
    expect(await cellOf(page, 'o_mind', 'o_start', 0)).toEqual({ x: 2, y: -4 });
  });

  test('dragging empty space still pans in arrange mode', async ({ page }, info) => {
    await boot(page);
    await arrangeButton(page).click();
    await viewSettled(page);
    const before = await worldTransform(page);
    const cells = await Promise.all(['o_start', 'o_road'].map(id => cellOf(page, id, 'o_start', 0)));
    const from = await emptySpot(page);
    await drag(page, info, from, { x: from.x - 60, y: from.y - 40 });
    await expect.poll(() => worldTransform(page)).not.toBe(before);
    expect(await Promise.all(['o_start', 'o_road'].map(id => cellOf(page, id, 'o_start', 0)))).toEqual(cells);
  });
});
