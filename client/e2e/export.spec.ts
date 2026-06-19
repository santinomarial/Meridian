/**
 * Workspace ZIP export E2E tests.
 *
 * Most tests require a running backend. Run with:
 *   E2E_TEST=true npm run start:dev   # in server/
 *   MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e  # in client/
 *
 * When the backend is absent the backend-required tests skip gracefully.
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import JSZip from "jszip";
import { isBackendAvailable } from "./helpers/auth.js";
import {
  acceptInvite,
  fileItem,
  freshWorkspace,
  getOwnerInviteLink,
  uid,
} from "./helpers/workspace.js";

/** Creates a file via the explorer, opens it, replaces its content, and saves. */
async function createFileWithContent(page: Page, name: string, content: string): Promise<void> {
  await page.getByTestId("new-file-button").click();
  const input = page.getByTestId("new-item-input");
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press("Enter");
  await expect(fileItem(page, name)).toBeVisible({ timeout: 8_000 });
  await fileItem(page, name).click();

  await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible({ timeout: 5_000 });
  // Focus Monaco, then select-all + delete any starter content so the file ends
  // up with exactly the content we type. page.keyboard fires the full
  // keydown+input sequence Monaco needs (locator.press does not).
  await page.locator(".monaco-editor .view-lines").click();
  await page.waitForTimeout(150);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(content);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 8_000 });
}

/** Reads a Playwright download into a parsed JSZip archive. */
async function downloadedZip(download: { path(): Promise<string> }): Promise<JSZip> {
  const path = await download.path();
  return JSZip.loadAsync(fs.readFileSync(path));
}

const exportCommand = (page: Page) =>
  page.locator('[data-testid="command-palette-command"][data-command-id="export-workspace"]');

// ── Demo mode (no backend) ──────────────────────────────────────────────────

test("export is disabled with a reason when no workspace is loaded", async ({ page }) => {
  await page.goto("/workspace");
  await page.waitForSelector('[data-testid="workspace-root"]', { timeout: 15_000 });
  await page.waitForTimeout(1_000);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 5_000 });
  await expect(exportCommand(page)).toHaveAttribute("data-disabled", "true");
  await expect(exportCommand(page)).toContainText("Open a workspace first");
});

// ── Backend required ─────────────────────────────────────────────────────────

test.describe("workspace export (backend required)", () => {
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      // eslint-disable-next-line no-console
      console.log("⚠  Backend not available — skipping export tests.");
    }
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available — skipping export tests");
  });

  test("File menu → Export Workspace as ZIP downloads the workspace files", async ({ page }) => {
    test.setTimeout(90_000);
    await freshWorkspace(page, `Export-${uid()}`);
    await createFileWithContent(page, "src/main.py", 'print("hello export")');

    await page.getByTestId("top-menu-file").click();
    const exportItem = page.getByRole("menuitem", { name: "Export Workspace as ZIP" });
    await expect(exportItem).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      exportItem.click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const zip = await downloadedZip(download);
    // Nested structure is preserved and the saved content is present.
    expect(zip.file("src/main.py")).not.toBeNull();
    expect(await zip.file("src/main.py")!.async("string")).toContain('print("hello export")');
    // No build/sandbox artifacts leak into the export.
    expect(Object.keys(zip.files).some((k) => k.startsWith(".meridian-build"))).toBe(false);
    expect(Object.keys(zip.files).some((k) => k.includes(".terminal-sandboxes"))).toBe(false);
    // Success notification appears.
    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(page.getByTestId("notifications-panel")).toContainText("Workspace export started", {
      timeout: 8_000,
    });
  });

  test("Command Palette → Export Workspace as ZIP downloads the workspace", async ({ page }) => {
    test.setTimeout(90_000);
    await freshWorkspace(page, `Export-${uid()}`);
    await createFileWithContent(page, "note.txt", "exported note content");

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 5_000 });
    const cmd = exportCommand(page);
    await expect(cmd).toBeVisible();
    await expect(cmd).toHaveAttribute("data-disabled", "false");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      cmd.click(),
    ]);

    const zip = await downloadedZip(download);
    expect(await zip.file("note.txt")!.async("string")).toBe("exported note content");
  });

  test("viewer can export the (read-only) workspace contents", async ({ browser }) => {
    test.setTimeout(150_000);
    const ownerCtx = await browser.newContext();
    const viewerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const viewer = await viewerCtx.newPage();

    try {
      await freshWorkspace(owner, `Owner-${uid()}`);
      await createFileWithContent(owner, "shared.txt", "viewer can read this");
      const inviteLink = await getOwnerInviteLink(owner, "VIEWER");

      await freshWorkspace(viewer, `Viewer-${uid()}`);
      await acceptInvite(viewer, inviteLink);
      await expect(viewer.getByTestId("viewer-readonly-banner")).toBeVisible({ timeout: 15_000 });

      await viewer.getByTestId("top-menu-file").click();
      const exportItem = viewer.getByRole("menuitem", { name: "Export Workspace as ZIP" });
      await expect(exportItem).toBeVisible();

      const [download] = await Promise.all([
        viewer.waitForEvent("download"),
        exportItem.click(),
      ]);

      const zip = await downloadedZip(download);
      expect(await zip.file("shared.txt")!.async("string")).toBe("viewer can read this");
    } finally {
      await ownerCtx.close();
      await viewerCtx.close();
    }
  });
});
