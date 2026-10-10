// The suite's `test`: Playwright's, plus a watch on every page of the test for uncaught errors
// and console.error output, which fail the test.

import { test as base, expect, type Page } from '@playwright/test';

export { expect };

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      const watch = (p: Page) => {
        p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
        p.on('console', m => {
          if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
        });
      };
      context.pages().forEach(watch);
      context.on('page', watch);
      await use(errors);
      expect(errors, 'no uncaught errors or console.error output in the page').toEqual([]);
    },
    { auto: true },
  ],
});
