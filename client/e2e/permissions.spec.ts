/**
 * Permission E2E tests — viewer / editor / owner role enforcement.
 *
 * All tests require a running backend. Run with:
 *   E2E_TEST=true npm run start:dev   # in server/
 *   npm run test:e2e                  # in client/
 *
 * When the backend is absent every test in this file is skipped gracefully.
 */
import { test, expect, type Page } from "@playwright/test";
import { isBackendAvailable, uniqueEmail, signUpViaUI } from "./helpers/auth.js";

const STRONG_PASSWORD = "Test@1234!";

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function freshWorkspace(page: Page, displayName: string): Promise<void> {
  await page.goto("/");
  await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD, displayName);
  await page.waitForURL("/workspace", { timeout: 20_000 });
  await page.waitForSelector(
    '[data-testid="workspace-root"][data-backend-status="available"]',
    { timeout: 20_000 },
  );
}

async function getInviteLink(page: Page, role: "EDITOR" | "VIEWER"): Promise<string> {
  await page.getByTestId("share-button").click();
  if (role === "VIEWER") {
    await page.getByLabel("Invite role").selectOption("VIEWER");
  }
  const linkDisplay = page.getByTestId("invite-link-display");
  await expect(linkDisplay).toBeVisible();
  // Wait for the backend-generated token to replace the /invite/demo fallback.
  await expect(linkDisplay).not.toContainText("/invite/demo", { timeout: 10_000 });
  const inviteLink = ((await linkDisplay.textContent()) ?? "").trim();
  expect(inviteLink).toMatch(/\/invite\/.+/);
  await page.keyboard.press("Escape");
  return inviteLink;
}

async function acceptInvite(page: Page, inviteLink: string): Promise<void> {
  await page.goto(inviteLink);
  await page
    .getByRole("button", { name: "Accept & Open Workspace" })
    .click({ timeout: 10_000 });
  await page.waitForURL("/workspace", { timeout: 15_000 });
  await page.waitForSelector(
    '[data-testid="workspace-root"][data-backend-status="available"]',
    { timeout: 20_000 },
  );
}

test.describe("permissions (backend required)", () => {
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      console.log("⚠  Backend not available — skipping permission tests.");
    }
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available — skipping permission tests");
  });

  // ── Viewer ─────────────────────────────────────────────────────────────────

  test("viewer: sees view-only banner and has no write controls", async ({ browser }) => {
    test.setTimeout(120_000);

    const ownerCtx = await browser.newContext();
    const viewerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const viewer = await viewerCtx.newPage();

    try {
      await freshWorkspace(owner, `Owner-${uid()}`);
      const inviteLink = await getInviteLink(owner, "VIEWER");

      await freshWorkspace(viewer, `Viewer-${uid()}`);
      await acceptInvite(viewer, inviteLink);

      // View-only banner is visible
      await expect(viewer.getByTestId("viewer-readonly-banner")).toBeVisible({
        timeout: 10_000,
      });

      // No write controls in the file explorer header
      await expect(viewer.getByTestId("new-file-button")).not.toBeVisible();
      await expect(viewer.getByTestId("new-folder-button")).not.toBeVisible();
      await expect(viewer.getByTestId("open-file-button")).not.toBeVisible();
      await expect(viewer.getByTestId("import-zip-button")).not.toBeVisible();

      // No Share button
      await expect(viewer.getByTestId("share-button")).not.toBeVisible();
    } finally {
      await ownerCtx.close();
      await viewerCtx.close();
    }
  });

  test("viewer: File menu hides write actions", async ({ browser }) => {
    test.setTimeout(120_000);

    const ownerCtx = await browser.newContext();
    const viewerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const viewer = await viewerCtx.newPage();

    try {
      await freshWorkspace(owner, `Owner-${uid()}`);
      const inviteLink = await getInviteLink(owner, "VIEWER");

      await freshWorkspace(viewer, `Viewer-${uid()}`);
      await acceptInvite(viewer, inviteLink);

      await viewer.getByTestId("top-menu-file").click();
      // Write items must be absent
      await expect(viewer.getByRole("menuitem", { name: /New File/i })).not.toBeVisible();
      await expect(viewer.getByRole("menuitem", { name: /New Folder/i })).not.toBeVisible();
      await expect(viewer.getByRole("menuitem", { name: /Save/i })).not.toBeVisible();
      // Read-only items and sign-out remain
      await expect(viewer.getByRole("menuitem", { name: /Sign out/i })).toBeVisible();
    } finally {
      await ownerCtx.close();
      await viewerCtx.close();
    }
  });

  // ── Editor ─────────────────────────────────────────────────────────────────

  test("editor: no view-only banner, can create files, no share button", async ({ browser }) => {
    test.setTimeout(120_000);

    const ownerCtx = await browser.newContext();
    const editorCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const editor = await editorCtx.newPage();

    try {
      await freshWorkspace(owner, `Owner-${uid()}`);
      const inviteLink = await getInviteLink(owner, "EDITOR");

      await freshWorkspace(editor, `Editor-${uid()}`);
      await acceptInvite(editor, inviteLink);

      // No view-only banner
      await expect(editor.getByTestId("viewer-readonly-banner")).not.toBeVisible();

      // Write controls are present
      await expect(editor.getByTestId("new-file-button")).toBeVisible({ timeout: 10_000 });
      await expect(editor.getByTestId("new-folder-button")).toBeVisible();

      // Share button is absent (editors cannot invite)
      await expect(editor.getByTestId("share-button")).not.toBeVisible();

      // Actually create a file to prove write access works end-to-end
      const fileName = `editor-${uid()}.ts`;
      await editor.getByTestId("new-file-button").click();
      const input = editor.getByTestId("new-item-input");
      await expect(input).toBeVisible();
      await input.fill(fileName);
      await input.press("Enter");
      await expect(
        editor.locator(`[data-testid="file-tree-item"][data-node-name="${fileName}"]`),
      ).toBeVisible({ timeout: 8_000 });
    } finally {
      await ownerCtx.close();
      await editorCtx.close();
    }
  });

  // ── Owner ──────────────────────────────────────────────────────────────────

  test("owner: share button visible, full write controls, no view-only banner", async ({ page }) => {
    test.setTimeout(60_000);

    await freshWorkspace(page, `Owner-${uid()}`);

    // Share button is visible
    await expect(page.getByTestId("share-button")).toBeVisible({ timeout: 10_000 });

    // Full file explorer controls
    await expect(page.getByTestId("new-file-button")).toBeVisible();
    await expect(page.getByTestId("new-folder-button")).toBeVisible();

    // No view-only banner
    await expect(page.getByTestId("viewer-readonly-banner")).not.toBeVisible();
  });
});
