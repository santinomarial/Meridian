/**
 * Command palette E2E tests.
 *
 * All tests require a running backend. Run with:
 *   E2E_TEST=true ENABLE_TERMINAL=true npm run start:dev   # in server/
 *   MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e  # in client/
 *
 * When the backend is absent every test in this file is skipped gracefully.
 */
import { test, expect, type Page } from "@playwright/test";
import { isBackendAvailable } from "./helpers/auth.js";
import {
  acceptInvite,
  fileItem,
  freshWorkspace,
  getOwnerInviteLink,
  uid,
} from "./helpers/workspace.js";

/** Opens the command palette via the keyboard shortcut. */
async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 5_000 });
}

/** Creates a file through the explorer toolbar (the editor-only flow). */
async function createFileViaExplorer(page: Page, name: string): Promise<void> {
  await page.getByTestId("new-file-button").click();
  const input = page.getByTestId("new-item-input");
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press("Enter");
  await expect(fileItem(page, name)).toBeVisible({ timeout: 8_000 });
}

function command(page: Page, id: string) {
  return page.locator(`[data-testid="command-palette-command"][data-command-id="${id}"]`);
}

test.describe("command palette (backend required)", () => {
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      console.log("⚠  Backend not available — skipping command palette tests.");
    }
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available — skipping command palette tests");
  });

  // ── Open / close ─────────────────────────────────────────────────────────────

  test("Cmd+K opens the palette and Escape closes it", async ({ page }) => {
    await freshWorkspace(page);

    await openPalette(page);
    await expect(page.getByTestId("command-palette-input")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toBeHidden();
  });

  // ── File search ──────────────────────────────────────────────────────────────

  // Locates the currently-active editor tab (aria-selected button in the tablist).
  function activeTab(page: Page) {
    return page.getByRole("tablist").locator('button[aria-selected="true"]');
  }

  test("typing a file name filters results and selecting opens the file", async ({ page }) => {
    await freshWorkspace(page);
    const target = `palette-find-${uid()}.ts`;
    const other = `palette-other-${uid()}.ts`;
    await createFileViaExplorer(page, target);
    // Create a second file so it (not the target) is the active tab.
    await createFileViaExplorer(page, other);
    await expect(activeTab(page)).toContainText(other);

    await openPalette(page);
    await page.getByTestId("command-palette-input").fill("palette-find");

    const result = page.getByTestId("command-palette-file").first();
    await expect(result).toBeVisible();
    await expect(result).toContainText("palette-find");
    await result.click();

    // Selecting the file opens it: the palette closes and it becomes active.
    await expect(page.getByTestId("command-palette")).toBeHidden();
    await expect(activeTab(page)).toContainText(target, { timeout: 10_000 });
  });

  test("Enter runs the highlighted result", async ({ page }) => {
    await freshWorkspace(page);
    const target = `palette-enter-${uid()}.ts`;
    const other = `palette-enter-other-${uid()}.ts`;
    await createFileViaExplorer(page, target);
    await createFileViaExplorer(page, other);
    await expect(activeTab(page)).toContainText(other);

    await openPalette(page);
    // The full target stem matches only the target file.
    await page.getByTestId("command-palette-input").fill(target.replace(".ts", ""));
    await expect(page.getByTestId("command-palette-file").first()).toContainText(target);
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("command-palette")).toBeHidden();
    await expect(activeTab(page)).toContainText(target, { timeout: 10_000 });
  });

  // ── Commands ─────────────────────────────────────────────────────────────────

  test("New File command creates a file for an owner", async ({ page }) => {
    await freshWorkspace(page);
    const name = `palette-new-${uid()}.ts`;
    page.once("dialog", (d) => void d.accept(name));

    await openPalette(page);
    await page.getByTestId("command-palette-input").fill("New File");
    await command(page, "new-file").click();

    await expect(fileItem(page, name)).toBeVisible({ timeout: 10_000 });
  });

  test("Save Active File command saves after an edit", async ({ page }) => {
    await freshWorkspace(page);
    const name = `palette-save-${uid()}.ts`;
    await createFileViaExplorer(page, name);

    await page.locator(".monaco-editor .view-lines").click();
    await page.keyboard.type("const palette = true;");

    await openPalette(page);
    await command(page, "save-file").click();

    await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 8_000 });
  });

  test("Open Version History command opens the real dialog", async ({ page }) => {
    await freshWorkspace(page);
    const name = `palette-vh-${uid()}.ts`;
    await createFileViaExplorer(page, name);

    await openPalette(page);
    await command(page, "version-history").click();

    await expect(page.getByTestId("version-history-dialog")).toBeVisible({ timeout: 10_000 });
  });

  test("Toggle Terminal command opens the terminal panel", async ({ page }) => {
    await freshWorkspace(page);

    await expect(page.getByTestId("terminal-panel")).not.toBeVisible();
    await openPalette(page);
    await command(page, "toggle-terminal").click();

    await expect(page.getByTestId("terminal-panel")).toBeVisible({ timeout: 5_000 });
  });

  test("owner sees the Share Workspace command; no fake/dead commands appear", async ({ page }) => {
    await freshWorkspace(page);
    await openPalette(page);

    // Share is owner-only — present here.
    await expect(command(page, "share-workspace")).toBeVisible();

    // Every rendered command is either enabled or disabled WITH a reason —
    // there are no dead/placeholder entries.
    const items = page.getByTestId("command-palette-command");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const disabled = await item.getAttribute("data-disabled");
      if (disabled === "true") {
        expect(((await item.textContent()) ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  // ── Permissions ──────────────────────────────────────────────────────────────

  test("viewer: write commands are disabled with a reason; no Share command", async ({ browser }) => {
    test.setTimeout(150_000);

    const ownerCtx = await browser.newContext();
    const viewerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const viewer = await viewerCtx.newPage();

    try {
      await freshWorkspace(owner, `Owner-${uid()}`);
      const name = `shared-${uid()}.ts`;
      await createFileViaExplorer(owner, name);
      const inviteLink = await getOwnerInviteLink(owner, "VIEWER");

      await freshWorkspace(viewer, `Viewer-${uid()}`);
      await acceptInvite(viewer, inviteLink);

      // Gate on the view-only banner so we know the VIEWER role has loaded
      // before asserting permission-dependent command states.
      await expect(viewer.getByTestId("viewer-readonly-banner")).toBeVisible({ timeout: 15_000 });

      // Open the shared file so version history has an active backend file.
      await fileItem(viewer, name).click();
      await expect(viewer.getByTestId("monaco-editor-wrapper")).toBeVisible({ timeout: 10_000 });

      await openPalette(viewer);

      // Write commands present but disabled, with a clear reason.
      const newFile = command(viewer, "new-file");
      await expect(newFile).toBeVisible();
      await expect(newFile).toHaveAttribute("data-disabled", "true");
      await expect(newFile).toContainText("Requires editor access");

      await expect(command(viewer, "save-file")).toHaveAttribute("data-disabled", "true");

      // Run Active File is disabled for a viewer, with a clear reason.
      const runCmd = command(viewer, "run-active-file");
      await expect(runCmd).toHaveAttribute("data-disabled", "true");
      await expect(runCmd).toContainText("Requires editor access");

      // Share is owner-only — absent for a viewer.
      await expect(command(viewer, "share-workspace")).toHaveCount(0);

      // Viewer CAN open version history (view/diff only).
      await expect(command(viewer, "version-history")).toHaveAttribute("data-disabled", "false");

      // A disabled command does not execute when clicked. (force:true bypasses
      // Playwright's actionability wait, which already honors aria-disabled —
      // itself proof the control is genuinely disabled.)
      await newFile.click({ force: true });
      await expect(viewer.getByTestId("command-palette")).toBeVisible();
    } finally {
      await ownerCtx.close();
      await viewerCtx.close();
    }
  });
});
