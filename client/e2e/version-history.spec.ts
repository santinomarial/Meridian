/**
 * Version history E2E tests.
 *
 * All tests require a running backend.  Run with:
 *   E2E_TEST=true npm run start:dev   # in server/
 *   MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e  # in client/
 *
 * When the backend is absent every test in this file is skipped gracefully.
 */
import { test, expect, type Page } from "@playwright/test";
import { isBackendAvailable, uniqueEmail, signUpViaUI } from "./helpers/auth.js";

const STRONG_PASSWORD = "Test@1234!";

const CONTENT_A = "const flavour = 'alpha';";
const CONTENT_B = "const flavour = 'bravo';";

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function freshWorkspace(page: Page, displayName = "Test User"): Promise<void> {
  await page.goto("/");
  await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD, displayName);
  await page.waitForURL("/workspace", { timeout: 20_000 });
  await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector(
    '[data-testid="workspace-root"][data-backend-status="available"]',
    { timeout: 20_000 },
  );
}

/** Selects all editor text and types the given content, then saves with Cmd+S. */
async function replaceAndSave(page: Page, content: string): Promise<void> {
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type(content);
  await page.keyboard.press("Meta+s");
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 8_000 });
}

async function createAndOpenFile(page: Page): Promise<string> {
  const name = `versions-${uid()}.ts`;
  await page.getByTestId("new-file-button").click();
  await page.getByTestId("new-item-input").fill(name);
  await page.getByTestId("new-item-input").press("Enter");
  const item = page.locator(`[data-testid="file-tree-item"][data-node-name="${name}"]`);
  await expect(item).toBeVisible({ timeout: 8_000 });
  await item.click();
  await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({ timeout: 10_000 });
  return name;
}

async function openVersionHistory(page: Page): Promise<void> {
  await page.getByTestId("top-menu-file").click();
  // File menu entries are ARIA menuitems (the dropdown is role="menu").
  await page.getByRole("menuitem", { name: "Version History" }).click();
  await expect(page.getByTestId("version-history-dialog")).toBeVisible({ timeout: 10_000 });
}

test.describe("version history (backend required)", () => {
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      console.log("⚠  Backend not available — skipping version history tests.");
    }
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available — skipping version history tests");
  });

  test("save → save → preview → diff → restore → persists across refresh", async ({ page }) => {
    test.setTimeout(120_000);

    await freshWorkspace(page);
    await createAndOpenFile(page);

    // Two meaningful saves produce two versions.
    await replaceAndSave(page, CONTENT_A);
    await replaceAndSave(page, CONTENT_B);

    await openVersionHistory(page);

    // Both versions are listed (newest first).
    const items = page.getByTestId("version-list-item");
    await expect(items).toHaveCount(2, { timeout: 10_000 });
    const v1 = page.locator('[data-testid="version-list-item"][data-version-number="1"]');
    await expect(v1).toBeVisible();

    // Preview version 1 (content A).
    await v1.click();
    const preview = page.getByTestId("version-preview");
    await expect(preview).toBeVisible({ timeout: 8_000 });
    await expect(preview).toContainText("alpha", { timeout: 8_000 });

    // Compare version 1 against the current file (content B).
    await page.getByTestId("version-compare-toggle").click();
    const diff = page.getByTestId("version-diff");
    await expect(diff).toBeVisible({ timeout: 8_000 });
    // The diff shows both the old (alpha) and current (bravo) content.
    await expect(diff).toContainText("alpha", { timeout: 8_000 });
    await expect(diff).toContainText("bravo", { timeout: 8_000 });

    // Restore version 1 (with confirmation).
    await page.getByTestId("version-restore-button").click();
    await page.getByTestId("version-restore-confirm").click();

    // Dialog refreshes its list; close it and confirm the editor now shows A.
    await page.getByTestId("version-history-close").click();
    await expect(
      page.locator('[data-testid="monaco-editor-wrapper"] .monaco-editor .view-lines'),
    ).toContainText("alpha", { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="monaco-editor-wrapper"] .monaco-editor .view-lines'),
    ).not.toContainText("bravo", { timeout: 8_000 });

    // The restore is persisted: reload and confirm A is still there.
    await page.reload();
    await page.waitForSelector(
      '[data-testid="workspace-root"][data-backend-status="available"]',
      { timeout: 20_000 },
    );
    await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="monaco-editor-wrapper"] .monaco-editor .view-lines'),
    ).toContainText("alpha", { timeout: 12_000 });
  });

  test("restored content adds a 'Restored from version' entry to the list", async ({ page }) => {
    test.setTimeout(120_000);

    await freshWorkspace(page);
    await createAndOpenFile(page);
    await replaceAndSave(page, CONTENT_A);
    await replaceAndSave(page, CONTENT_B);

    await openVersionHistory(page);
    await page.locator('[data-testid="version-list-item"][data-version-number="1"]').click();
    await page.getByTestId("version-restore-button").click();
    await page.getByTestId("version-restore-confirm").click();

    // A third version (the restore) now exists with the restore message.
    const v3 = page.locator('[data-testid="version-list-item"][data-version-number="3"]');
    await expect(v3).toBeVisible({ timeout: 10_000 });
    await expect(v3).toContainText("Restored from version 1");
  });

  test("viewer can open version history but cannot restore", async ({ browser }) => {
    test.setTimeout(150_000);

    const ownerCtx = await browser.newContext();
    const viewerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const viewer = await viewerCtx.newPage();

    try {
      // Owner creates a file with two versions, then invites a viewer.
      await freshWorkspace(owner, `Owner-${uid()}`);
      await createAndOpenFile(owner);
      await replaceAndSave(owner, CONTENT_A);
      await replaceAndSave(owner, CONTENT_B);

      await owner.getByTestId("share-button").click();
      await owner.getByLabel("Invite role").selectOption("VIEWER");
      const linkDisplay = owner.getByTestId("invite-link-display");
      await expect(linkDisplay).toBeVisible();
      await expect(linkDisplay).not.toContainText("/invite/demo", { timeout: 10_000 });
      const inviteLink = ((await linkDisplay.textContent()) ?? "").trim();
      await owner.keyboard.press("Escape");

      // Viewer joins and opens the shared file.
      await freshWorkspace(viewer, `Viewer-${uid()}`);
      await viewer.goto(inviteLink);
      await viewer.getByRole("button", { name: "Accept & Open Workspace" }).click({ timeout: 10_000 });
      await viewer.waitForURL(/\/workspace\/[^/?#]+(?:[?#].*)?$/, { timeout: 15_000 });
      await viewer.waitForSelector(
        '[data-testid="workspace-root"][data-backend-status="available"]',
        { timeout: 20_000 },
      );
      await expect(viewer.getByTestId("viewer-readonly-banner")).toBeVisible({ timeout: 10_000 });

      // Open the shared file from the explorer.
      const fileItem = viewer.locator('[data-testid="file-tree-item"]').first();
      await expect(fileItem).toBeVisible({ timeout: 15_000 });
      await fileItem.click();
      await expect(viewer.getByTestId("monaco-editor-wrapper")).toBeVisible({ timeout: 10_000 });

      // Viewer can open version history and preview a version…
      await openVersionHistory(viewer);
      await expect(viewer.getByTestId("version-list-item").first()).toBeVisible({ timeout: 10_000 });
      await viewer.getByTestId("version-list-item").first().click();
      await expect(viewer.getByTestId("version-preview")).toBeVisible({ timeout: 8_000 });

      // …but cannot restore: the restore control is replaced by an explanation.
      await expect(viewer.getByTestId("version-restore-disabled")).toContainText(
        "Viewer access cannot restore versions",
      );
      await expect(viewer.getByTestId("version-restore-button")).toHaveCount(0);
    } finally {
      await ownerCtx.close();
      await viewerCtx.close();
    }
  });
});
