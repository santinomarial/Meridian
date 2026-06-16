/**
 * Product-finish E2E tests.
 *
 * Verifies that the app contains no fake "coming soon" controls, that the
 * settings panel is real, notifications reflect real state, and Live Session
 * reports real connection state instead of navigating to a fake demo route.
 *
 * Demo-mode tests block the backend API so they run without a server.
 * Backend-gated tests skip gracefully when no server is available.
 */
import { test, expect, type Page } from "@playwright/test";
import { isBackendAvailable, uniqueEmail, signUpViaUI } from "./helpers/auth.js";

const STRONG_PASSWORD = "Test@1234!";
const API_BASE = process.env["MERIDIAN_BACKEND_URL"] ?? "http://localhost:3000";

/** Force demo mode by blocking the backend, then open the workspace. */
async function openDemoWorkspace(page: Page): Promise<void> {
  await page.route(`${API_BASE}/**`, (route) => route.abort("connectionrefused"));
  await page.goto("/workspace");
  await page.waitForSelector('[data-testid="backend-unavailable-banner"]', {
    timeout: 10_000,
  });
}

test.describe("no fake / coming-soon controls (demo mode)", () => {
  test("workspace has no 'coming soon' text", async ({ page }) => {
    await openDemoWorkspace(page);
    const bodyText = (await page.locator("body").textContent()) ?? "";
    expect(bodyText.toLowerCase()).not.toContain("coming soon");
  });

  test("the fake git branch selector is gone", async ({ page }) => {
    await openDemoWorkspace(page);
    // The old header showed a "branch:" selector with no real git integration.
    await expect(page.locator("header")).not.toContainText("branch:");
  });

  test("account → Settings opens a real settings dialog (not a toast)", async ({
    page,
  }) => {
    await openDemoWorkspace(page);
    await page.getByTestId("account-menu-button").click();
    const accountMenu = page.getByTestId("account-menu");
    await expect(accountMenu).toBeVisible();
    await accountMenu.getByRole("button", { name: "Settings" }).click();

    const dialog = page.getByTestId("settings-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Theme");
    // It must not be a "coming soon" placeholder.
    expect((await dialog.textContent())?.toLowerCase()).not.toContain("coming soon");
  });

  test("settings theme toggle changes the theme", async ({ page }) => {
    await openDemoWorkspace(page);
    // Open settings from the activity bar (icon button labelled "Settings").
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByTestId("settings-dialog")).toBeVisible();

    const startsDark =
      (await page.locator("html").getAttribute("class"))?.includes("dark") ?? false;
    await page.getByTestId("settings-theme-toggle").click();
    const nowDark =
      (await page.locator("html").getAttribute("class"))?.includes("dark") ?? false;
    expect(nowDark).toBe(!startsDark);
  });

  test("notifications panel shows a real empty state in a fresh session", async ({
    page,
  }) => {
    await openDemoWorkspace(page);
    await page.getByRole("button", { name: "Notifications" }).click();
    const panel = page.getByTestId("notifications-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("notifications-empty")).toBeVisible();
    await expect(panel).toContainText("No notifications");
    // No fake "Collaborator joined" / hardcoded entries.
    expect((await panel.textContent()) ?? "").not.toContain("Collaborator joined");
  });

  test("Live Session in demo mode reports real state, no fake /session/demo nav", async ({
    page,
  }) => {
    await openDemoWorkspace(page);
    await page.getByRole("button", { name: /Live session/i }).click();
    // Must NOT navigate to a fabricated session route.
    await expect(page).toHaveURL(/\/workspace$/);
    // Should surface the real backend-unavailable state via a toast.
    await expect(page.getByRole("status").filter({ hasText: /Live session/i })).toBeVisible();
  });
});

test.describe("settings + notifications (backend required)", () => {
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available");
  });

  test("updating display name in settings persists to the account menu", async ({
    page,
  }) => {
    await page.goto("/");
    await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD, "Original Name");
    await page.waitForURL("/workspace", { timeout: 20_000 });
    await page.waitForSelector(
      '[data-testid="workspace-root"][data-backend-status="available"]',
      { timeout: 20_000 },
    );

    await page.getByTestId("account-menu-button").click();
    await page.getByTestId("account-menu").getByRole("button", { name: "Settings" }).click();
    await expect(page.getByTestId("settings-dialog")).toBeVisible();

    const nameInput = page.getByTestId("settings-display-name");
    await expect(nameInput).toHaveValue("Original Name");
    await nameInput.fill("Renamed Person");
    await page.getByTestId("settings-save-name").click();

    // Close the dialog and confirm the account menu reflects the new name.
    await page.getByTestId("settings-close").click();
    await page.getByTestId("account-menu-button").click();
    await expect(page.getByTestId("account-menu")).toContainText("Renamed Person", {
      timeout: 8_000,
    });
  });

  test("saving a file produces a real notification", async ({ page }) => {
    await page.goto("/");
    await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
    await page.waitForURL("/workspace", { timeout: 20_000 });
    await page.waitForSelector(
      '[data-testid="workspace-root"][data-backend-status="available"]',
      { timeout: 20_000 },
    );
    await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });

    // Create + open a file.
    const name = `notif-${Date.now().toString(36)}.ts`;
    await page.getByTestId("new-file-button").click();
    await page.getByTestId("new-item-input").fill(name);
    await page.getByTestId("new-item-input").press("Enter");
    const item = page.locator(
      `[data-testid="file-tree-item"][data-node-name="${name}"]`,
    );
    await expect(item).toBeVisible({ timeout: 8_000 });
    await item.click();

    await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({ timeout: 10_000 });
    await page.locator(".monaco-editor .view-lines").click();
    await page.keyboard.type("const n = 1;");
    await page.keyboard.press("Meta+s");
    await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 8_000 });

    // The save event should appear in the notifications panel.
    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(page.getByTestId("notifications-panel")).toContainText("Saved", {
      timeout: 8_000,
    });
  });
});
