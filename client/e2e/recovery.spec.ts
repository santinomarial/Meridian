import { test, expect, type Page } from '@playwright/test';
import { freshWorkspace } from './helpers/workspace.js';
import { BACKEND_URL } from './helpers/auth.js';

async function openDocument(page: Page): Promise<string> {
  await freshWorkspace(page, 'Recovery Tester');
  await page.getByTestId('new-file-button').click();
  await page.getByTestId('new-item-input').fill('recovery.txt');
  await page.getByTestId('new-item-input').press('Enter');
  await expect(page.locator('.monaco-editor')).toBeVisible();
  // Wait for the actual collaborative binding, not just the editor shell.
  await expect.poll(() => page.evaluate(async () => {
    const storePath = '/src/store/useWorkspaceStore.ts';
    const flushPath = '/src/lib/yjsUpdateFlush.ts';
    const { useWorkspaceStore } = await import(storePath);
    const { flushDocumentUpdates } = await import(flushPath);
    return flushDocumentUpdates(useWorkspaceStore.getState().activeFileId);
  })).toBe(true);
  return page.evaluate(async () => {
    const path = '/src/store/useWorkspaceStore.ts';
    const { useWorkspaceStore } = await import(path);
    return useWorkspaceStore.getState().activeFileId as string;
  });
}

async function offlineEdit(page: Page, text: string): Promise<void> {
  await page.evaluate(async (content) => {
    const socketPath = '/src/lib/socket.ts';
    const editorPath = '/src/lib/editorRegistry.ts';
    const storePath = '/src/store/useWorkspaceStore.ts';
    const flushPath = '/src/lib/yjsUpdateFlush.ts';
    const { getSocket } = await import(socketPath);
    const { getActiveEditor } = await import(editorPath);
    const { useWorkspaceStore } = await import(storePath);
    const { flushDocumentUpdates } = await import(flushPath);
    getSocket().disconnect();
    getActiveEditor().setValue(content);
    await flushDocumentUpdates(useWorkspaceStore.getState().activeFileId);
  }, text);
}

async function pendingCount(page: Page, documentId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const path = '/src/lib/yjsOutboundQueue.ts';
    const { listPendingYjsUpdates } = await import(path);
    return (await listPendingYjsUpdates(id)).length;
  }, documentId);
}

test('reload replays durable offline edits and checkpoints the recovered text', async ({ page }) => {
  const documentId = await openDocument(page);
  await offlineEdit(page, 'RECOVER_AFTER_RELOAD');
  expect(await pendingCount(page, documentId)).toBeGreaterThan(0);
  await page.reload();
  await expect.poll(() => pendingCount(page, documentId)).toBe(0);
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('RECOVER_AFTER_RELOAD');
  const save = await page.request.post(`${BACKEND_URL}/documents/${documentId}/checkpoint`);
  expect(save.ok()).toBe(true);
  expect((await save.json()).content).toBe('RECOVER_AFTER_RELOAD');
});

test('restore fences offline edits from the old generation when the browser reloads', async ({ page }) => {
  const documentId = await openDocument(page);
  await page.evaluate(async () => {
    const editorPath = '/src/lib/editorRegistry.ts';
    const storePath = '/src/store/useWorkspaceStore.ts';
    const flushPath = '/src/lib/yjsUpdateFlush.ts';
    const { getActiveEditor } = await import(editorPath);
    const { useWorkspaceStore } = await import(storePath);
    const { flushDocumentUpdates } = await import(flushPath);
    getActiveEditor().setValue('SAVED_VERSION');
    await flushDocumentUpdates(useWorkspaceStore.getState().activeFileId);
  });
  await expect.poll(() => pendingCount(page, documentId)).toBe(0);
  expect((await page.request.post(`${BACKEND_URL}/documents/${documentId}/checkpoint`)).ok()).toBe(true);
  const versions = await (await page.request.get(`${BACKEND_URL}/documents/${documentId}/versions`)).json();
  await offlineEdit(page, 'STALE_OFFLINE_CONTENT');
  expect(await pendingCount(page, documentId)).toBeGreaterThan(0);
  expect((await page.request.post(`${BACKEND_URL}/documents/${documentId}/versions/${versions[0].id}/restore`)).ok()).toBe(true);
  await page.reload();
  await expect.poll(() => pendingCount(page, documentId)).toBe(0);
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('SAVED_VERSION');
  await expect(page.locator('.monaco-editor .view-lines')).not.toContainText('STALE_OFFLINE_CONTENT');
  expect((await (await page.request.post(`${BACKEND_URL}/documents/${documentId}/checkpoint`)).json()).content).toBe('SAVED_VERSION');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder(/Search files and commands/).fill('Export Recovery Data');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  expect((await download).suggestedFilename()).toBe('meridian-recovery.json');
});

test('retries a dropped update while the connection remains open', async ({ page }) => {
  const documentId = await openDocument(page);
  await page.evaluate(async () => {
    const socketPath = '/src/lib/socket.ts';
    const editorPath = '/src/lib/editorRegistry.ts';
    const storePath = '/src/store/useWorkspaceStore.ts';
    const flushPath = '/src/lib/yjsUpdateFlush.ts';
    const { getSocket } = await import(socketPath);
    const { getActiveEditor } = await import(editorPath);
    const { useWorkspaceStore } = await import(storePath);
    const { flushDocumentUpdates } = await import(flushPath);
    const socket = getSocket();
    const original = socket.emit.bind(socket);
    socket.emit = (event: string, ...args: unknown[]) => {
      if (event === 'yjs:update') {
        socket.emit = original;
        return socket;
      }
      return original(event, ...args);
    };
    getActiveEditor().setValue('RETRIED_WITHOUT_RECONNECT');
    await flushDocumentUpdates(useWorkspaceStore.getState().activeFileId);
  });
  expect(await pendingCount(page, documentId)).toBeGreaterThan(0);
  await expect.poll(() => pendingCount(page, documentId)).toBe(0);
  expect((await (await page.request.post(`${BACKEND_URL}/documents/${documentId}/checkpoint`)).json()).content).toBe('RETRIED_WITHOUT_RECONNECT');
});

test('a checkpoint response never replaces newer live editor text', async ({ page }) => {
  const documentId = await openDocument(page);
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.type('LIVE_COLLABORATIVE_TEXT');
  await expect.poll(() => pendingCount(page, documentId)).toBe(0);
  // A peer can have visible edits whose durable commit failed. In that case
  // checkpoint projection legitimately trails the live editor.
  await page.route(`**/documents/${documentId}/checkpoint`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, content: 'OLDER_CHECKPOINT' } });
  });
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByTestId('save-status')).toContainText('Unsaved');
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('LIVE_COLLABORATIVE_TEXT');
  await expect(page.locator('.monaco-editor .view-lines')).not.toContainText('OLDER_CHECKPOINT');
});
