import { test, expect } from '@playwright/test';
import { freshWorkspace } from './helpers/workspace.js';

test('profile names cannot be blank and a saved change survives reload', async ({ page }) => {
  await freshWorkspace(page, 'Original Name');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const name = page.getByTestId('settings-display-name');
  const save = page.getByTestId('settings-save-name');
  await expect(name).toHaveAttribute('maxlength', '100');
  await name.fill('   ');
  await expect(save).toBeDisabled();
  await name.fill('  Updated Name  ');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Profile updated.' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(name).toHaveValue('Updated Name');
  await expect(save).toBeDisabled();
});
