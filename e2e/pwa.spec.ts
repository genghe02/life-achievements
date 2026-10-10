/// <reference lib="dom" />
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { complete, node, tree } from './helpers';

/** The build the suite runs against (E2E_DIST when the server is started elsewhere). */
const DIST = process.env.E2E_DIST || 'dist';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** A static server for a private copy of the build, so a test can publish a "new version" of it. */
async function serveCopy(dir: string): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = normalize(join(dir, path === '/' ? 'index.html' : path));
    if (!file.startsWith(dir) || !existsSync(file)) file = join(dir, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(file));
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, server };
}

test.describe('installable app', () => {
  test('the manifest names the app and its icons', async ({ page, request }) => {
    await page.goto('./');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifestUrl = new URL(href!, page.url()).href;
    const res = await request.get(manifestUrl);
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.name).toBe('人生成就系统');
    expect(m.display).toBe('standalone');
    expect(m.lang).toBe('zh-CN');
    const sizes = (m.icons as { sizes: string }[]).map(i => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    for (const i of m.icons as { src: string }[]) {
      expect((await request.get(new URL(i.src, manifestUrl).href)).ok(), i.src).toBe(true);
    }
  });

  test.describe('updates', () => {
    /**
     * A private copy of the build on its own port, so the test can publish a "new version" (the
     * same worker with different bytes) without touching the build other tests use.
     */
    async function site(info: TestInfo) {
      const dir = info.outputPath('site');
      cpSync(DIST, dir, { recursive: true });
      const { server, url } = await serveCopy(dir);
      return {
        url,
        publish: () => writeFileSync(join(dir, 'sw.js'), readFileSync(join(dir, 'sw.js'), 'utf8') + '\n// next version\n'),
        close: () => new Promise<void>(ok => server.close(() => ok())),
      };
    }

    async function controlledApp(page: Page, url: string): Promise<void> {
      await page.goto(url);
      await page.getByRole('button', { name: '示例模板' }).click();
      await expect(tree(page)).toBeVisible();
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.reload();
      await expect(tree(page)).toBeVisible();
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    }

    test('a waiting new version shows 「有新版本」 and 更新 switches to it', async ({ page }, info) => {
      const s = await site(info);
      try {
        await controlledApp(page, s.url);
        await complete(page, info, 'o_start');
        s.publish();
        await page.evaluate(async () => {
          await (await navigator.serviceWorker.getRegistration())?.update();
        });
        const bar = page.getByRole('group', { name: '有新版本' });
        await expect(bar).toBeVisible({ timeout: 20_000 });
        await expect(bar).toContainText('点「更新」就能用上。');
        expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);

        await Promise.all([page.waitForEvent('load', { timeout: 20_000 }), bar.getByRole('button', { name: '更新', exact: true }).click()]);
        await expect(tree(page)).toBeVisible();
        await expect(page.getByRole('group', { name: '有新版本' })).toHaveCount(0);
        expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(false);
        // the data came through the switch
        await expect(node(page, 'o_start')).toHaveClass(/\bdone\b/);
      } finally {
        await s.close();
      }
    });

    test('× on the update bar hides it for now', async ({ page }, info) => {
      const s = await site(info);
      try {
        await controlledApp(page, s.url);
        s.publish();
        await page.evaluate(async () => {
          await (await navigator.serviceWorker.getRegistration())?.update();
        });
        const bar = page.getByRole('group', { name: '有新版本' });
        await expect(bar).toBeVisible({ timeout: 20_000 });
        // by keyboard: focus goes back to where it came from instead of to <body>
        await page.locator('#btnTrade').focus();
        await bar.getByRole('button', { name: '先不更新' }).focus();
        await page.keyboard.press('Enter');
        await expect(bar).toHaveCount(0);
        await expect(tree(page)).toBeVisible();
        await expect(page.locator('#btnTrade')).toBeFocused();
      } finally {
        await s.close();
      }
    });
  });
});
