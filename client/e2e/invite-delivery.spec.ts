import { test, expect } from '@playwright/test';
import { freshWorkspace } from './helpers/workspace.js';

test('email invitations prevent duplicate submissions and allow retry after failure', async ({ page }) => {
  await freshWorkspace(page);
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('copy-invite-link')).toBeEnabled();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route('**/workspaces/*/invites', async (route) => {
    if (!route.request().postDataJSON()?.email) return route.continue();
    requests += 1;
    await pending;
    await route.fulfill({ status: 503, json: { message: 'Delivery unavailable' } });
  });
  const email = page.getByRole('textbox', { name: 'Invite email address' });
  const send = page.getByRole('button', { name: 'Send invite' });
  await email.fill('recipient@example.com');
  try {
    await send.click();
    await expect.poll(() => requests).toBe(1);
    await expect(send).toBeDisabled();
    await expect(send).toHaveText('Sending…');
    await expect(email).toBeDisabled();
    await expect(page.getByLabel('Invite role')).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByRole('status').filter({ hasText: 'Delivery unavailable' })).toBeVisible();
  await expect(send).toBeEnabled();
  await expect(email).toHaveValue('recipient@example.com');
  await send.click();
  await expect.poll(() => requests).toBe(2);
});

test('a delivered invite does not claim the link was copied when clipboard access fails', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => { throw new DOMException('Clipboard denied', 'NotAllowedError'); } },
    });
  });
  await freshWorkspace(page);
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('copy-invite-link')).toBeEnabled();
  await page.route('**/workspaces/*/invites', async (route) => {
    if (!route.request().postDataJSON()?.email) return route.continue();
    await route.fulfill({ json: { token: 'delivered-test-invite', emailDelivered: true } });
  });
  await page.getByRole('textbox', { name: 'Invite email address' }).fill('recipient@example.com');
  await page.getByRole('button', { name: 'Send invite' }).click();
  const notice = page.getByRole('status').filter({ hasText: 'Invite sent to recipient@example.com' });
  await expect(notice).toBeVisible();
  await expect(notice).not.toContainText('copied');
  await expect(page.getByTestId('invite-link-display')).toContainText('delivered-test-invite');
});

test('an undelivered invitation offers its link without claiming email success', async ({ page }) => {
  await freshWorkspace(page);
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('copy-invite-link')).toBeEnabled();
  await page.route('**/workspaces/*/invites', async (route) => {
    if (!route.request().postDataJSON()?.email) return route.continue();
    await route.fulfill({ json: { token: 'undelivered-test-invite', emailDelivered: false } });
  });
  await page.getByRole('textbox', { name: 'Invite email address' }).fill('recipient@example.com');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'email delivery was not confirmed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send invite' })).toHaveText('Link ready');
  await expect(page.getByTestId('invite-link-display')).toContainText('undelivered-test-invite');
});
