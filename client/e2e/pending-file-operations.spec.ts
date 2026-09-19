import { test, expect } from '@playwright/test';
import { freshWorkspace, STRONG_PASSWORD } from './helpers/workspace.js';
import { signUpViaUI, uniqueEmail } from './helpers/auth.js';

for (const filename of ['first-account-private.txt', 'private/nested.txt']) {
test(`delayed creation of ${filename} cannot populate a different signed-in account`, async ({ page }) => {
  await freshWorkspace(page, 'First Account');
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let responseHeld = false;
  let responseReleased = false;
  await page.route(/\/workspaces\/[^/]+\/documents(?:\/bulk)?$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    responseHeld = true;
    await waiting;
    await route.fulfill({ response });
    responseReleased = true;
  });
  try {
    await page.getByLabel('Create your first file').fill(filename);
    await page.getByRole('button', { name: 'Create file', exact: true }).click();
    await expect.poll(() => responseHeld).toBe(true);
    await page.getByTestId('account-menu-button').click();
    await page.getByRole('button', { name: /Sign out$/ }).click();
    await expect(page).toHaveURL('/');
    // Stay in the same SPA: a full navigation would cancel the stale callback.
    await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD, 'Second Account');
    await expect(page.getByTestId('workspace-welcome')).toBeVisible();
    release();
    await expect.poll(() => responseReleased).toBe(true);
    // The response handler is a microtask; allow subsequent rendering to settle.
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect(page.getByTestId('workspace-welcome')).toBeVisible();
    await expect(page.getByTestId('file-tree-item')).toHaveCount(0);
    await expect(page.getByTestId('editor-tab')).toHaveCount(0);
  } finally {
    release();
  }
});
}
