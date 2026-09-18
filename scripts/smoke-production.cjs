#!/usr/bin/env node
'use strict';

// Runs against built assets, HTTPS, secure cookies, and the production proxy.
// Use a disposable verified account: this creates and then removes a test file.
const assert = require('node:assert/strict');
const { chromium, expect } = require('../client/node_modules/@playwright/test');

async function main() {
  const baseURL = process.env.SMOKE_BASE_URL;
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  assert(baseURL && email && password, 'Set SMOKE_BASE_URL, SMOKE_EMAIL, and SMOKE_PASSWORD');
  const url = new URL(baseURL);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  assert(local || process.env.SMOKE_ALLOW_REMOTE === 'true', 'Remote smoke runs require SMOKE_ALLOW_REMOTE=true');
  assert.equal(url.protocol, 'https:', 'Production smoke requires HTTPS');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: local && process.env.SMOKE_IGNORE_HTTPS_ERRORS === 'true',
  });
  const page = await context.newPage();
  let documentId;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (const path of ['/metrics', '/docs', '/docs/index.html', '/e2e/cleanup']) {
      assert.equal((await context.request.get(path)).status(), 404, `${path} must be blocked at the edge`);
    }
    assert.equal((await context.request.get('/ready')).status(), 200);
    const response = await page.goto('/');
    assert(response.headers()['content-security-policy'], 'SPA must serve CSP');
    await page.getByLabel('Email Address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/workspace');
    await expect(page.locator('[data-testid="workspace-root"][data-backend-status="available"]')).toBeVisible();
    const cookie = (await context.cookies()).find((item) => item.name === 'auth_token');
    assert(cookie?.httpOnly && cookie.secure && cookie.sameSite === 'Lax', 'Production session cookie must be HttpOnly, Secure, SameSite=Lax');

    const name = `production-smoke-${Date.now()}.txt`;
    await page.getByTestId('new-file-button').click();
    await page.getByTestId('new-item-input').fill(name);
    const creation = page.waitForResponse((res) => res.request().method() === 'POST' && /\/documents$/.test(res.url()));
    await page.getByTestId('new-item-input').press('Enter');
    const document = await (await creation).json();
    documentId = document.id;
    assert(documentId, 'File creation must return a document ID');
    await expect(page.locator('.monaco-editor .view-lines')).toBeVisible();
    // Monaco stays read-only until the collaboration handshake finishes.
    await expect(page.getByTestId('monaco-editor-wrapper')).toHaveAttribute('data-collaboration-ready', 'true');
    await page.locator('.monaco-editor .view-lines').click();
    const first = 'PRODUCTION_CHECKPOINT_ONE';
    await page.keyboard.type(first);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-save-status', 'unsaved');
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-save-status', 'saved');
    let saved = await (await context.request.get(`/documents/${documentId}`)).json();
    assert.equal(saved.content, first);
    const versions = await (await context.request.get(`/documents/${documentId}/versions`)).json();
    assert.equal(versions.length, 1);

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('PRODUCTION_CHECKPOINT_TWO');
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-save-status', 'saved');
    const restored = await context.request.post(`/documents/${documentId}/versions/${versions[0].id}/restore`);
    assert(restored.ok(), 'Restore must succeed');
    await expect(page.locator('.monaco-editor .view-lines')).toContainText(first);
    await page.reload();
    await expect(page.locator('.monaco-editor .view-lines')).toContainText(first);
    saved = await (await context.request.get(`/documents/${documentId}`)).json();
    assert.equal(saved.content, first);
    const archive = await context.request.get(`/workspaces/${document.workspaceId}/export`);
    assert(archive.ok() && archive.headers()['content-type'].includes('application/zip'));
    assert.deepEqual(errors, [], 'Production browser must not raise JavaScript errors');
    console.log('Production HTTPS smoke passed: edge routes, CSP, secure login, editing, save, versions, restore, reload, and ZIP export');
  } finally {
    if (documentId) await context.request.delete(`/documents/${documentId}`);
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
