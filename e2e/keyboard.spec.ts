/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { boot, detail, dialog, expectDetailFor, hittable, node, selectNode, viewSettled } from './helpers';

/** The data-id of the focused tree node, or null when focus is elsewhere. */
const focusedNode = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a instanceof HTMLElement && a.classList.contains('node') ? (a.dataset.id ?? null) : null;
  });

const focusInside = (page: Page, sel: string) =>
  page.locator(sel).evaluate(e => e.contains(document.activeElement));

test.describe('keyboard', () => {
  test('Tab reaches the tree, Enter selects the focused node, Esc lets go', async ({ page }) => {
    await boot(page);
    let id: string | null = null;
    for (let i = 0; i < 40 && !id; i++) {
      await page.keyboard.press('Tab');
      id = await focusedNode(page);
    }
    expect(id, 'a tree node takes focus within 40 presses of Tab').not.toBeNull();
    const nid = id as string;
    await expect(node(page, nid)).toBeFocused();
    await expect(node(page, nid)).not.toHaveClass(/\bsel\b/);

    await page.keyboard.press('Enter');
    await expect(node(page, nid)).toHaveClass(/\bsel\b/);
    await expectDetailFor(page, nid);

    await page.keyboard.press('Escape');
    await expect(node(page, nid)).not.toHaveClass(/\bsel\b/);
    // desktop: the column shows the area overview again; phone: the sheet closes
    if (page.viewportSize()!.width >= 860) await expect(detail(page)).toHaveAccessibleName('领域概览');
    else await expect(detail(page)).not.toHaveClass(/\bopen\b/);
    await expect(node(page, nid)).toBeFocused();
  });

  test('keyboard focus brings every node of the tree on screen', async ({ page }) => {
    await boot(page);
    const ids = await page.locator('#nodes .node').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id ?? ''));
    expect(ids).toHaveLength(14);
    let id: string | null = null;
    for (let i = 0; i < 40 && !id; i++) {
      await page.keyboard.press('Tab');
      id = await focusedNode(page);
    }
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      await viewSettled(page);
      expect(await hittable(page, id), `node ${id} on screen once focused`).toBe(true);
      await page.keyboard.press('Tab');
      id = await focusedNode(page);
    }
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  test('Esc closes a modal and gives focus back to what opened it', async ({ page }, info) => {
    await boot(page);
    const menuButton = page.getByRole('button', { name: '菜单' });
    await menuButton.focus();
    await page.keyboard.press('Enter');
    const menu = dialog(page, '菜单');
    await expect(menu).toBeVisible();
    expect(await focusInside(page, '[role="dialog"]')).toBe(true);
    // Tab and Shift+Tab stay inside the dialog
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press(i % 5 === 4 ? 'Shift+Tab' : 'Tab');
      expect(await focusInside(page, '[role="dialog"]'), `focus inside the menu after Tab #${i + 1}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(menuButton).toBeFocused();

    // the node editor: the first Esc only leaves the text field, the second closes it
    await selectNode(page, info, 'o_start');
    const edit = detail(page).getByRole('button', { name: '编辑' });
    await edit.focus();
    await page.keyboard.press('Enter');
    const ed = dialog(page, '编辑进度');
    await expect(ed).toBeVisible();
    await expect(ed.getByLabel(/^名称/)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(ed).toBeVisible();
    await expect(ed.getByLabel(/^名称/)).not.toBeFocused();
    await page.keyboard.press('Escape');
    await expect(ed).toBeHidden();
    await expect(edit).toBeFocused();
    // closing the modal did not also close the selection
    await expect(node(page, 'o_start')).toHaveClass(/\bsel\b/);

    // the trade window from the HUD
    const pill = page.getByRole('button', { name: /^绿宝石 0，交易$/ });
    await pill.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page, /^交易/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page, /^交易/)).toBeHidden();
    await expect(pill).toBeFocused();
  });

  test('arrow keys move between the area tabs', async ({ page }) => {
    await boot(page);
    const t = page.getByRole('tab', { selected: true });
    await t.focus();
    await expect(t).toHaveAccessibleName(/^起源，/);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /^体魄，/ })).toBeFocused();
    await expect(page.getByRole('tab', { name: /^体魄，/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.whead h1')).toHaveText('体魄');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: /^远行，/ })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /^起源，/ })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: /^远行，/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: /^起源，/ })).toHaveAttribute('aria-selected', 'true');
    // only the selected tab is in the Tab order
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  });
});
