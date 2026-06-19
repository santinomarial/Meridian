/**
 * File import E2E tests — local file open and ZIP import.
 *
 * Requires a running backend.  The test ZIP fixture is generated in
 * e2e/global-setup.ts and written to e2e/fixtures/test-project.zip.
 */
import * as path from "path";
import { fileURLToPath } from "url";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { isBackendAvailable, uniqueEmail, signUpViaUI } from "./helpers/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");
const STRONG_PASSWORD = "Test@1234!";

/** Locate a file tree item by its exact displayed name. */
function fileItem(page: Page, name: string): Locator {
  return page.locator(`[data-testid="file-tree-item"][data-node-name="${name}"]`);
}

async function freshWorkspace(page: Page): Promise<void> {
  await page.goto("/");
  await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
  await page.waitForURL("/workspace", { timeout: 20_000 });
  await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  // Wait for backend status to resolve before running file operations so that
  // isBackendAvailable is true when openLocalFile / importZip are called.
  await page
    .waitForSelector('[data-testid="workspace-root"][data-backend-status="available"]', {
      timeout: 10_000,
    })
    .catch(() => {});
}

test.describe("file import (backend required)", () => {
  // Check backend availability once to avoid per-test GET /auth/me calls.
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      console.log("⚠  Backend not available — skipping file import tests.");
    }
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available — skipping file import tests");
  });

  // ── Open local file ──────────────────────────────────────────────────────────

  test("open a local .ts file via the file picker", async ({ page }) => {
    await freshWorkspace(page);

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      // The hidden file input is triggered by clicking the Open file button.
      page.getByTestId("open-file-button").click(),
    ]);

    // Create a synthetic .ts file from a Buffer
    await fileChooser.setFiles({
      name: "opened-local.ts",
      mimeType: "text/plain",
      buffer: Buffer.from("const local = 'opened';\n"),
    });

    // File should appear in the explorer (exactly once)
    const item = fileItem(page, "opened-local.ts");
    await expect(item).toBeVisible({ timeout: 10_000 });
    await expect(item).toHaveCount(1);
  });

  // ── Import ZIP ───────────────────────────────────────────────────────────────

  test("import a ZIP archive — files appear in the explorer", async ({ page }) => {
    await freshWorkspace(page);

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("import-zip-button").click(),
    ]);

    await fileChooser.setFiles(path.join(FIXTURES, "test-project.zip"));

    // The fixture ZIP contains hello.ts
    const item = fileItem(page, "hello.ts");
    await expect(item).toBeVisible({ timeout: 15_000 });
    await expect(item).toHaveCount(1);
  });

  // ── Imported file is openable ────────────────────────────────────────────────

  test("imported file can be opened in the editor", async ({ page }) => {
    await freshWorkspace(page);

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("import-zip-button").click(),
    ]);
    await fileChooser.setFiles(path.join(FIXTURES, "test-project.zip"));

    const treeItem = fileItem(page, "hello.ts");
    await expect(treeItem).toBeVisible({ timeout: 15_000 });
    await expect(treeItem).toHaveCount(1);
    await treeItem.click();

    await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
      timeout: 10_000,
    });
    // Editor should contain the file content from the fixture. Use a retrying
    // assertion (not a one-shot textContent read) so a slow Monaco worker init
    // doesn't flake the check before the text has rendered.
    await expect(page.locator(".monaco-editor .view-lines")).toContainText("hello", {
      timeout: 10_000,
    });
  });

  // ── Open local file via Header "File" menu ────────────────────────────────────

  test("open file via the File menu also works", async ({ page }) => {
    await freshWorkspace(page);

    // Open the File menu first (separate await so the dropdown is visible
    // before we register the filechooser listener).
    await page.getByTestId("top-menu-file").click();

    // Now race the filechooser event against clicking "Open File..." in the
    // dropdown.  The handler calls fileInputRef.current?.click() which
    // Playwright intercepts as a filechooser event.
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      // File menu entries are ARIA menuitems (the dropdown is role="menu").
      page.getByRole("menuitem", { name: "Open File..." }).click(),
    ]);

    await fileChooser.setFiles({
      name: "menu-opened.ts",
      mimeType: "text/plain",
      buffer: Buffer.from("const menu = true;\n"),
    });

    const item = fileItem(page, "menu-opened.ts");
    await expect(item).toBeVisible({ timeout: 10_000 });
    await expect(item).toHaveCount(1);
  });

  // ── TODO: import via Header File menu (ZIP) ───────────────────────────────────
  // TODO: add a test for "Import ZIP..." via the File menu once the header
  // zip input and explorer zip input share the same trigger path.
});
