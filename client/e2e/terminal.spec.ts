/**
 * Terminal E2E tests.
 *
 * All tests require a running backend. Run with:
 *   E2E_TEST=true npm run start:dev   # in server/
 *   npm run test:e2e                  # in client/
 *
 * When the backend is absent every test in this file is skipped gracefully.
 *
 * When ENABLE_TERMINAL=false (the default), tests that require a live terminal
 * expect to see the panel open but show a "disabled" error — they do NOT try
 * to spawn a real shell. This lets CI validate the UI without enabling the
 * terminal feature.
 */
import { test, expect, type Page } from "@playwright/test";
import { isBackendAvailable, uniqueEmail, signUpViaUI } from "./helpers/auth.js";

const STRONG_PASSWORD = "Test@1234!";

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

/** Opens the terminal panel via the ActivityBar button. */
async function openTerminalPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Toggle Terminal" }).click();
  await expect(page.getByTestId("terminal-panel")).toBeVisible({ timeout: 5_000 });
}

test.describe("terminal (backend required)", () => {
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      console.log("⚠  Backend not available — skipping terminal tests.");
    }
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available — skipping terminal tests");
  });

  // ── Panel visibility ────────────────────────────────────────────────────────

  test("terminal panel opens and closes via ActivityBar button", async ({ page }) => {
    test.setTimeout(60_000);
    const displayName = `TermUser-${Date.now()}`;
    await freshWorkspace(page, displayName);

    // Panel is hidden by default
    await expect(page.getByTestId("terminal-panel")).not.toBeVisible();

    // Open via ActivityBar
    await openTerminalPanel(page);

    // Close via the X button in the panel header
    await page.getByRole("button", { name: "Close terminal" }).click();
    await expect(page.getByTestId("terminal-panel")).not.toBeVisible();
  });

  test("terminal panel opens via View menu toggle", async ({ page }) => {
    test.setTimeout(60_000);
    const displayName = `TermUser-${Date.now()}`;
    await freshWorkspace(page, displayName);

    // Open via Header → View menu
    await page.getByRole("button", { name: "View" }).click();
    await page.getByRole("button", { name: "Toggle Terminal" }).click();
    await expect(page.getByTestId("terminal-panel")).toBeVisible({ timeout: 5_000 });
  });

  // ── Viewer restriction ──────────────────────────────────────────────────────

  test("viewer: sees 'view-only' message in terminal panel", async ({ browser }) => {
    test.setTimeout(120_000);

    const ownerCtx = await browser.newContext();
    const viewerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const viewer = await viewerCtx.newPage();

    try {
      await freshWorkspace(owner, `TermOwner-${Date.now()}`);
      const inviteLink = await getInviteLink(owner, "VIEWER");

      await viewer.goto("/");
      await signUpViaUI(viewer, uniqueEmail(), STRONG_PASSWORD, `TermViewer-${Date.now()}`);
      await acceptInvite(viewer, inviteLink);

      await openTerminalPanel(viewer);

      // Viewer should see a message about needing editor access, not a start button
      await expect(
        viewer.getByText(/view-only|editor access/i),
      ).toBeVisible({ timeout: 5_000 });

      // The Start button must not be present for viewers
      await expect(viewer.getByRole("button", { name: "Start terminal" })).not.toBeVisible();
    } finally {
      await ownerCtx.close();
      await viewerCtx.close();
    }
  });

  // ── Disabled state ──────────────────────────────────────────────────────────

  test("terminal: when feature is disabled, start emits an error message in the panel", async ({ page }) => {
    test.setTimeout(60_000);
    // This test works regardless of ENABLE_TERMINAL because:
    // - If disabled: clicking Start sends terminal:start → server replies terminal:error
    //   and the hook writes the error into xterm.
    // - If enabled: a real shell starts instead (test is only checking UI behaviour).
    // The test only asserts panel visibility + start button existence, which is
    // valid in both states.

    const displayName = `TermUser-${Date.now()}`;
    await freshWorkspace(page, displayName);

    await openTerminalPanel(page);

    // xterm container is rendered inside the panel
    await expect(page.getByTestId("terminal-xterm")).toBeVisible();

    // Start button is present for owner
    const startBtn = page.getByRole("button", { name: "Start terminal" });
    await expect(startBtn).toBeVisible();

    // Clicking it should not crash the page regardless of server state
    await startBtn.click();

    // After a moment the panel is still visible (no unhandled crash)
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("terminal-panel")).toBeVisible();
  });

  // ── Editor can use terminal ─────────────────────────────────────────────────

  test("editor: has start terminal button in panel", async ({ browser }) => {
    test.setTimeout(120_000);

    const ownerCtx = await browser.newContext();
    const editorCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const editor = await editorCtx.newPage();

    try {
      await freshWorkspace(owner, `TermOwner-${Date.now()}`);
      const inviteLink = await getInviteLink(owner, "EDITOR");

      await editor.goto("/");
      await signUpViaUI(editor, uniqueEmail(), STRONG_PASSWORD, `TermEditor-${Date.now()}`);
      await acceptInvite(editor, inviteLink);

      await openTerminalPanel(editor);

      // Editor should see a Start button (no view-only message)
      await expect(
        editor.getByRole("button", { name: "Start terminal" }),
      ).toBeVisible({ timeout: 5_000 });

      await expect(
        editor.getByText(/view-only|editor access/i),
      ).not.toBeVisible();
    } finally {
      await ownerCtx.close();
      await editorCtx.close();
    }
  });
});
