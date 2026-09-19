import { test, expect, type Page } from '@playwright/test';
import { BACKEND_URL, isBackendAvailable } from './helpers/auth.js';
import { freshWorkspace, fileItem } from './helpers/workspace.js';

async function command(page: Page, text: string): Promise<void> {
  await page.getByTestId('terminal-xterm').click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
}

async function openTerminal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Toggle Terminal', exact: true }).click();
  await expect(page.getByTestId('terminal-status-label')).toContainText('Connected');
}

async function editorReady(page: Page): Promise<void> {
  await expect(page.getByTestId('monaco-editor-wrapper')).toHaveAttribute('data-collaboration-ready', 'true');
}

test.describe('terminal file saving (backend required)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await isBackendAvailable()), 'Backend unavailable');
    await freshWorkspace(page, 'Terminal file check');
  });

  test('shell creation and edits reach both open editors, survive reload, and appear in export', async ({ page, context }) => {
    const peer = await context.newPage();
    await peer.goto('/workspace');
    await expect(peer.getByTestId('workspace-root')).toHaveAttribute('data-backend-status', 'available');
    await openTerminal(page);
    await command(page, `mkdir -p src; printf 'print(42)\\n' > src/from_terminal.py`);
    await expect(fileItem(page, 'from_terminal.py')).toBeVisible();
    await expect(fileItem(peer, 'from_terminal.py')).toBeVisible();
    for (const editor of [page, peer]) {
      await fileItem(editor, 'from_terminal.py').click();
      await editorReady(editor);
      await expect(editor.locator('.monaco-editor .view-lines')).toContainText('print(42)');
    }
    await command(page, `printf 'print(84)\\n' > src/from_terminal.py`);
    for (const editor of [page, peer]) {
      await expect(editor.locator('.monaco-editor .view-lines')).toContainText('print(84)');
      await editorReady(editor);
    }
    // Closing the last shell and rematerializing must use the saved text.
    await peer.close();
    await page.reload();
    await fileItem(page, 'from_terminal.py').click();
    await editorReady(page);
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('print(84)');
    const workspaces = await (await page.request.get(`${BACKEND_URL}/workspaces`)).json();
    const documents = await (await page.request.get(`${BACKEND_URL}/workspaces/${workspaces[0].id}/documents`)).json();
    const file = documents.find((doc: { path: string }) => doc.path === 'src/from_terminal.py');
    expect(file.content).toBe('print(84)\n');
    const versions = await (await page.request.get(`${BACKEND_URL}/documents/${file.id}/versions`)).json();
    expect(versions.length).toBeGreaterThanOrEqual(2);
    const JSZip = (await import('jszip')).default;
    const response = await page.request.get(`${BACKEND_URL}/workspaces/${workspaces[0].id}/export`);
    expect(response.ok()).toBe(true);
    const zip = await JSZip.loadAsync(await response.body());
    expect(await zip.file('src/from_terminal.py')!.async('string')).toBe('print(84)\n');
  });

  test('concurrent unsaved editor text is preserved alongside a terminal conflict copy', async ({ page }) => {
    await openTerminal(page);
    await command(page, `printf 'initial\\n' > conflict.txt`);
    await fileItem(page, 'conflict.txt').click();
    await editorReady(page);
    await page.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('editor unsaved');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-save-status', 'unsaved');
    await page.evaluate(async () => {
      const storePath = '/src/store/useWorkspaceStore.ts';
      const queuePath = '/src/lib/yjsUpdateFlush.ts';
      const { useWorkspaceStore } = await import(storePath);
      const { flushDocumentUpdates } = await import(queuePath);
      if (!await flushDocumentUpdates(useWorkspaceStore.getState().activeFileId)) throw new Error("Editor updates did not reach durable storage");
    });
    await expect.poll(() => page.evaluate(async () => {
      const storePath = '/src/store/useWorkspaceStore.ts';
      const queuePath = '/src/lib/yjsOutboundQueue.ts';
      const { useWorkspaceStore } = await import(storePath);
      const { listPendingYjsUpdates } = await import(queuePath);
      return (await listPendingYjsUpdates(useWorkspaceStore.getState().activeFileId)).length;
    })).toBe(0);
    await command(page, `printf 'terminal version\\n' > conflict.txt`);
    await expect(page.locator('.xterm-rows')).toContainText('Terminal copy saved as');
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('editor unsaved');
    await expect(page.locator('[data-testid="folder-tree-item"][data-node-name="terminal-conflicts"]')).toBeVisible();
  });
});
