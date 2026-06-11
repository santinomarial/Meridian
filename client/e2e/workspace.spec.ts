/**
 * Workspace E2E tests.
 *
 * All tests require a running backend.  Run with:
 *   E2E_TEST=true npm run start:dev   # in server/
 *   MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e  # in client/
 *
 * When the backend is absent every test in this file is skipped gracefully.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  isBackendAvailable,
  uniqueEmail,
  signUpViaUI,
} from "./helpers/auth.js";

const STRONG_PASSWORD = "Test@1234!";

// ── Shared setup ───────────────────────────────────────────────────────────────

/** Signs up a fresh user and waits for the workspace to be visible. */
async function freshWorkspace(page: Page): Promise<void> {
  await page.goto("/");
  await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
  await page.waitForURL("/workspace", { timeout: 20_000 });
  // Wait for file explorer to be present and workspace to settle
  await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  // Wait for backend status to resolve (available or unavailable, not pending)
  await page
    .waitForSelector(
      '[data-testid="workspace-root"][data-backend-status="available"], ' +
        '[data-testid="backend-unavailable-banner"]',
      { timeout: 10_000 },
    )
    .catch(() => {
      // If neither signal appears in time, proceed — createFile has a local fallback.
    });
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

    await page.getByTestId("new-file-button").click();
    const input = page.getByTestId("new-item-input");
    await expect(input).toBeVisible();
    await input.fill("e2e-test-file.ts");
    await input.press("Enter");

    // File should appear in the tree
    await expect(
      page.getByRole("treeitem", { name: "e2e-test-file.ts" }),
    ).toBeVisible({ timeout: 8_000 });
  });

  // ── Create folder ────────────────────────────────────────────────────────────

  test("create a new folder via the explorer toolbar", async ({ page }) => {
    await freshWorkspace(page);

    await page.getByTestId("new-folder-button").click();
    const input = page.getByTestId("new-item-input");
    await expect(input).toBeVisible();
    await input.fill("e2e-folder");
    await input.press("Enter");

    await expect(
      page.getByRole("treeitem", { name: "e2e-folder" }),
    ).toBeVisible({ timeout: 8_000 });
  });

  // ── Rename file ──────────────────────────────────────────────────────────────

  test("rename a file", async ({ page }) => {
    await freshWorkspace(page);

    // Create a file first
    await page.getByTestId("new-file-button").click();
    await page.getByTestId("new-item-input").fill("rename-me.ts");
    await page.getByTestId("new-item-input").press("Enter");
    await expect(page.getByRole("treeitem", { name: "rename-me.ts" })).toBeVisible({
      timeout: 8_000,
    });

    // Hover over the file to reveal the rename button
    const fileRow = page.getByRole("treeitem", { name: "rename-me.ts" });
    await fileRow.hover();
    await page.getByRole("button", { name: "Rename rename-me.ts" }).click();

    const renameInput = page.getByLabel("Rename file");
    await renameInput.selectText();
    await renameInput.fill("renamed.ts");
    await renameInput.press("Enter");

    await expect(page.getByRole("treeitem", { name: "renamed.ts" })).toBeVisible({
      timeout: 8_000,
    });
  });

  // ── Rename folder ────────────────────────────────────────────────────────────

  test("rename a folder", async ({ page }) => {
    await freshWorkspace(page);

    await page.getByTestId("new-folder-button").click();
    await page.getByTestId("new-item-input").fill("old-folder");
    await page.getByTestId("new-item-input").press("Enter");
    await expect(page.getByRole("treeitem", { name: "old-folder" })).toBeVisible({
      timeout: 8_000,
    });

    const folderRow = page.getByRole("treeitem", { name: "old-folder" });
    await folderRow.hover();
    await page.getByRole("button", { name: "Rename old-folder" }).click();

    const renameInput = page.getByLabel("Rename folder");
    await renameInput.selectText();
    await renameInput.fill("new-folder");
    await renameInput.press("Enter");

    await expect(page.getByRole("treeitem", { name: "new-folder" })).toBeVisible({
      timeout: 8_000,
    });
  });

  // ── Delete file ──────────────────────────────────────────────────────────────

  test("delete a file", async ({ page }) => {
    await freshWorkspace(page);

    await page.getByTestId("new-file-button").click();
    await page.getByTestId("new-item-input").fill("delete-me.ts");
    await page.getByTestId("new-item-input").press("Enter");
    await expect(page.getByRole("treeitem", { name: "delete-me.ts" })).toBeVisible({
      timeout: 8_000,
    });

    const fileRow = page.getByRole("treeitem", { name: "delete-me.ts" });
    await fileRow.hover();

    // Accept the window.confirm dialog
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete delete-me.ts" }).click();

    await expect(page.getByRole("treeitem", { name: "delete-me.ts" })).toBeHidden({
      timeout: 8_000,
    });
  });

  // ── Edit file in Monaco ──────────────────────────────────────────────────────

  test("edit file content in Monaco editor", async ({ page }) => {
    await freshWorkspace(page);

    // Create + open a file
    await page.getByTestId("new-file-button").click();
    await page.getByTestId("new-item-input").fill("edit-test.ts");
    await page.getByTestId("new-item-input").press("Enter");
    await page.getByRole("treeitem", { name: "edit-test.ts" }).click();

    // Wait for Monaco to mount
    await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
      timeout: 10_000,
    });

    // Monaco exposes a hidden textarea for keyboard input.
    // Select all existing content and replace it.
    const textarea = page.locator(".monaco-editor textarea").first();
    await textarea.press("Control+a");
    await textarea.pressSequentially("const e2e = true;");

    // Verify save-status shows "Unsaved".
    await expect(page.getByTestId("save-status")).toContainText("Unsaved", {
      timeout: 5_000,
    });
  });

  // ── Save with Cmd+S ──────────────────────────────────────────────────────────

  test("Cmd+S saves the active file and clears dirty state", async ({ page }) => {
    await freshWorkspace(page);

    await page.getByTestId("new-file-button").click();
    await page.getByTestId("new-item-input").fill("save-test.ts");
    await page.getByTestId("new-item-input").press("Enter");
    await page.getByRole("treeitem", { name: "save-test.ts" }).click();

    await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
      timeout: 10_000,
    });

    const textarea = page.locator(".monaco-editor textarea").first();
    await textarea.press("Control+a");
    await textarea.pressSequentially("const saved = true;");

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

    await page.getByTestId("new-file-button").click();
    await page.getByTestId("new-item-input").fill("persist-test.ts");
    await page.getByTestId("new-item-input").press("Enter");
    await page.getByRole("treeitem", { name: "persist-test.ts" }).click();

    await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
      timeout: 10_000,
    });

    const textarea = page.locator(".monaco-editor textarea").first();
    await textarea.press("Control+a");
    await textarea.pressSequentially("const persisted = 'yes';");

    // Save
    await page.keyboard.press("Meta+s");
    await expect(page.getByTestId("save-status")).toContainText("Saved", {
      timeout: 8_000,
    });

    // Reload
    await page.reload();
    await page.waitForURL("/workspace");
    await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });

    // Reopen the file
    await page.getByRole("treeitem", { name: "persist-test.ts" }).click();
    await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
      timeout: 10_000,
    });

    // Check content
    const editorContent = await page
      .locator(".monaco-editor .view-lines")
      .textContent();
    expect(editorContent).toContain("persisted");
  });
});
