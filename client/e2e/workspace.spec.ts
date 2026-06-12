/**
 * Workspace E2E tests.
 *
 * All tests require a running backend.  Run with:
 *   E2E_TEST=true npm run start:dev   # in server/
 *   MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e  # in client/
 *
 * When the backend is absent every test in this file is skipped gracefully.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  isBackendAvailable,
  uniqueEmail,
  signUpViaUI,
} from "./helpers/auth.js";

const STRONG_PASSWORD = "Test@1234!";

// ── Unique name helper ─────────────────────────────────────────────────────────

/** Short unique suffix so file/folder names never collide across re-runs. */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Stable selectors ───────────────────────────────────────────────────────────

/** Locate a file tree item by its exact displayed name. */
function fileItem(page: Page, name: string): Locator {
  return page.locator(`[data-testid="file-tree-item"][data-node-name="${name}"]`);
}

/** Locate a folder tree item by its exact displayed name. */
function folderItem(page: Page, name: string): Locator {
  return page.locator(`[data-testid="folder-tree-item"][data-node-name="${name}"]`);
}

// ── Shared setup ───────────────────────────────────────────────────────────────

/**
 * Signs up a fresh user and waits for the workspace + backend to be fully ready.
 *
 * We do NOT swallow the timeout here.  If the backend takes longer than 20 s to
 * become available the test fails with a clear selector-timeout error rather
 * than silently proceeding with backendStatus="pending", which would cause
 * createFile to use a local-id and every subsequent PATCH to return 404
 * ("Save failed").
 */
async function freshWorkspace(page: Page): Promise<void> {
  await page.goto("/");
  await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
  await page.waitForURL("/workspace", { timeout: 20_000 });
  await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector(
    '[data-testid="workspace-root"][data-backend-status="available"]',
    { timeout: 20_000 },
  );
}

test.describe("workspace (backend required)", () => {
  // Check backend availability once for the entire describe block to avoid
  // hitting the auth rate limiter with per-test GET /auth/me calls.
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      // eslint-disable-next-line no-console
      console.log("⚠  Backend not available — skipping workspace tests.");
    }
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available — skipping workspace tests");
  });

  // ── Workspace loads ──────────────────────────────────────────────────────────

  test("workspace page opens after sign-up", async ({ page }) => {
    await freshWorkspace(page);
    await expect(page.getByTestId("workspace-root")).toBeVisible();
  });

  test("workspace auto-creates when user has no existing workspace", async ({ page }) => {
    // A brand-new account will trigger auto-create on the backend hook.
    await page.goto("/");
    await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
    await page.waitForURL("/workspace", { timeout: 20_000 });
    // The file explorer should be present — workspace was auto-created.
    await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  });

  // ── Create file ──────────────────────────────────────────────────────────────

  test("create a new file via the explorer toolbar", async ({ page }) => {
    await freshWorkspace(page);
    const name = `e2e-file-${uid()}.ts`;

    await page.getByTestId("new-file-button").click();
    const input = page.getByTestId("new-item-input");
    await expect(input).toBeVisible();
    await input.fill(name);
    await input.press("Enter");

    const item = fileItem(page, name);
    await expect(item).toBeVisible({ timeout: 8_000 });
    await expect(item).toHaveCount(1);
  });

  // ── Create folder ────────────────────────────────────────────────────────────

  test("create a new folder via the explorer toolbar", async ({ page }) => {
    await freshWorkspace(page);
    const name = `e2e-folder-${uid()}`;

    await page.getByTestId("new-folder-button").click();
    const input = page.getByTestId("new-item-input");
    await expect(input).toBeVisible();
    await input.fill(name);
    await input.press("Enter");

    const item = folderItem(page, name);
    await expect(item).toBeVisible({ timeout: 8_000 });
    await expect(item).toHaveCount(1);
  });

  // ── Rename file ──────────────────────────────────────────────────────────────

  test("rename a file", async ({ page }) => {
    await freshWorkspace(page);
    const ts = uid();
    const sourceName = `rename-src-${ts}.ts`;
    const targetName = `renamed-${ts}.ts`;

    await page.getByTestId("new-file-button").click();
    await page.getByTestId("new-item-input").fill(sourceName);
    await page.getByTestId("new-item-input").press("Enter");
    const beforeItem = fileItem(page, sourceName);
    await expect(beforeItem).toBeVisible({ timeout: 8_000 });
    await expect(beforeItem).toHaveCount(1);

    await beforeItem.hover();
    await page.getByRole("button", { name: `Rename ${sourceName}` }).click();

    const renameInput = page.getByLabel("Rename file");
    await renameInput.selectText();
    await renameInput.fill(targetName);
    await renameInput.press("Enter");

    const afterItem = fileItem(page, targetName);
    await expect(afterItem).toBeVisible({ timeout: 8_000 });
    await expect(afterItem).toHaveCount(1);
  });

  // ── Rename folder ────────────────────────────────────────────────────────────

  test("rename a folder", async ({ page }) => {
    await freshWorkspace(page);
    const ts = uid();
    const sourceName = `folder-src-${ts}`;
    const targetName = `folder-dst-${ts}`;

    await page.getByTestId("new-folder-button").click();
    await page.getByTestId("new-item-input").fill(sourceName);
    await page.getByTestId("new-item-input").press("Enter");
    const beforeItem = folderItem(page, sourceName);
    await expect(beforeItem).toBeVisible({ timeout: 8_000 });
    await expect(beforeItem).toHaveCount(1);

    await beforeItem.hover();
    await page.getByRole("button", { name: `Rename ${sourceName}` }).click();

    const renameInput = page.getByRole("textbox", { name: "Rename folder" });
    await renameInput.selectText();
    await renameInput.fill(targetName);
    await renameInput.press("Enter");

    const afterItem = folderItem(page, targetName);
    await expect(afterItem).toBeVisible({ timeout: 8_000 });
    await expect(afterItem).toHaveCount(1);
  });

  // ── Delete file ──────────────────────────────────────────────────────────────

  test("delete a file", async ({ page }) => {
    await freshWorkspace(page);
    const name = `delete-me-${uid()}.ts`;

    await page.getByTestId("new-file-button").click();
    await page.getByTestId("new-item-input").fill(name);
    await page.getByTestId("new-item-input").press("Enter");
    const item = fileItem(page, name);
    await expect(item).toBeVisible({ timeout: 8_000 });
    await expect(item).toHaveCount(1);

    await item.hover();

    // Accept the window.confirm dialog
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: `Delete ${name}` }).click();

    await expect(item).toBeHidden({ timeout: 8_000 });
  });

  // ── Edit file in Monaco ──────────────────────────────────────────────────────

  test("edit file content in Monaco editor", async ({ page }) => {
    await freshWorkspace(page);
    const name = `edit-test-${uid()}.ts`;

    // Create + open a file
    await page.getByTestId("new-file-button").click();
    await page.getByTestId("new-item-input").fill(name);
    await page.getByTestId("new-item-input").press("Enter");
    const item = fileItem(page, name);
    await expect(item).toBeVisible({ timeout: 8_000 });
    await expect(item).toHaveCount(1);
    await item.click();

    // Wait for Monaco to mount and render its view
    await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".monaco-editor .view-lines")).toBeVisible({ timeout: 5_000 });

    // Click inside the editor view to focus Monaco, then type via page.keyboard
    // which fires the full keydown+keypress+input+keyup sequence that Monaco's
    // input pipeline requires.  (Locator.pressSequentially / press only emits
    // keydown+keyup — no input event — so Monaco silently ignores it.)
    await page.locator(".monaco-editor .view-lines").click();
    await page.keyboard.type("const e2e = true;");

    // Verify save-status shows "Unsaved".
    await expect(page.getByTestId("save-status")).toContainText("Unsaved", {
      timeout: 5_000,
    });
  });

  // ── Save with Cmd+S ──────────────────────────────────────────────────────────

  test("Cmd+S saves the active file and clears dirty state", async ({ page }) => {
    await freshWorkspace(page);
    const name = `save-test-${uid()}.ts`;

    await page.getByTestId("new-file-button").click();
    await page.getByTestId("new-item-input").fill(name);
    await page.getByTestId("new-item-input").press("Enter");
    const item = fileItem(page, name);
    await expect(item).toBeVisible({ timeout: 8_000 });
    await expect(item).toHaveCount(1);
    await item.click();

    await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".monaco-editor .view-lines")).toBeVisible({ timeout: 5_000 });

    await page.locator(".monaco-editor .view-lines").click();
    await page.keyboard.type("const saved = true;");

    // Wait for unsaved state
    await expect(page.getByTestId("save-status")).toContainText("Unsaved", {
      timeout: 5_000,
    });

    // Save via keyboard shortcut
    await page.keyboard.press("Meta+s");

    await expect(page.getByTestId("save-status")).toContainText("Saved", {
      timeout: 8_000,
    });
  });

  // ── Content persists after page refresh ──────────────────────────────────────

  test("file content persists after page refresh", async ({ page }) => {
    await freshWorkspace(page);
    const name = `persist-test-${uid()}.ts`;
    // A unique string to verify round-trip: typed → saved → reloaded.
    const marker = `e2e-persisted-${uid()}`;

    await page.getByTestId("new-file-button").click();
    await page.getByTestId("new-item-input").fill(name);
    await page.getByTestId("new-item-input").press("Enter");
    const item = fileItem(page, name);
    await expect(item).toBeVisible({ timeout: 8_000 });
    await expect(item).toHaveCount(1);
    await item.click();

    await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".monaco-editor .view-lines")).toBeVisible({ timeout: 5_000 });

    await page.locator(".monaco-editor .view-lines").click();
    await page.keyboard.type(marker);

    // Assert "Unsaved" before saving
    await expect(page.getByTestId("save-status")).toContainText("Unsaved", {
      timeout: 5_000,
    });

    // Save
    await page.keyboard.press("Meta+s");
    await expect(page.getByTestId("save-status")).toContainText("Saved", {
      timeout: 8_000,
    });

    // Reload and wait for backend tree to load
    await page.reload();
    await page.waitForURL("/workspace");
    await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
    await page.waitForSelector(
      '[data-testid="workspace-root"][data-backend-status="available"]',
      { timeout: 20_000 },
    );

    // Reopen the file and wait for Monaco to render
    await page.locator(`[data-testid="file-tree-item"][data-node-name="${name}"]`).click();
    await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({ timeout: 10_000 });

    // Assert the marker survives the round-trip.  toContainText handles Monaco's
    // multi-span rendering by collecting all descendant text.
    await expect(page.locator(".monaco-editor .view-lines")).toContainText(marker, {
      timeout: 10_000,
    });
  });
});
