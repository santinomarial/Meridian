/**
 * Product-finish E2E tests.
 *
 * Verifies that the app contains no fake "coming soon" controls, that the
 * settings panel is real, notifications reflect real state, and Live Session
 * reports real connection state instead of navigating to a fake demo route.
 *
 * Offline tests hit the unavailable gate. Backend-gated tests skip when no
 * server is available.
 */
import { test, expect, type Page } from "@playwright/test";
import { isBackendAvailable, uniqueEmail, signUpViaUI } from "./helpers/auth.js";

const STRONG_PASSWORD = "Test@1234!";
const API_BASE = process.env["MERIDIAN_BACKEND_URL"] ?? "http://localhost:3000";

/** Force the unavailable gate by blocking the backend. */
async function openUnavailableGate(page: Page): Promise<void> {
  await page.route(`${API_BASE}/**`, (route) => route.abort("connectionrefused"));
  await page.goto("/workspace");
  await page.waitForSelector('[data-testid="backend-unavailable-gate"]', {
    timeout: 10_000,
  });
}

test.describe("no fake / coming-soon controls (unavailable gate)", () => {
  test("workspace has no 'coming soon' text", async ({ page }) => {
    await openUnavailableGate(page);
    const bodyText = (await page.locator("body").textContent()) ?? "";
    expect(bodyText.toLowerCase()).not.toContain("coming soon");
  });

  test("the fake git branch selector is gone", async ({ page }) => {
    await openUnavailableGate(page);
    await expect(page.locator("header")).not.toContainText("branch:");
  });

  test("settings opens a real settings dialog (not a toast)", async ({ page }) => {
    await openUnavailableGate(page);
    await page.getByRole("button", { name: "Settings" }).click();

    const dialog = page.getByTestId("settings-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Theme");
    expect((await dialog.textContent())?.toLowerCase()).not.toContain("coming soon");
  });

  test("settings theme toggle changes the theme", async ({ page }) => {
    await openUnavailableGate(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByTestId("settings-dialog")).toBeVisible();

    const startsDark =
      (await page.locator("html").getAttribute("class"))?.includes("dark") ?? false;
    await page.getByTestId("settings-theme-toggle").click();
    const nowDark =
      (await page.locator("html").getAttribute("class"))?.includes("dark") ?? false;
    expect(nowDark).toBe(!startsDark);
  });

  test("unavailable gate does not invent a live session route", async ({ page }) => {
    await openUnavailableGate(page);
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByTestId("backend-unavailable-banner")).toContainText(
      "Can't reach Meridian",
    );
    await expect(page.getByTestId("file-tree-item")).toHaveCount(0);
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

  test("unavailable server features stay out of navigation and commands", async ({ page }) => {
    await page.route("**/auth/me", async (route) => {
      const response = await route.fetch();
      const user = await response.json();
      await route.fulfill({ response, json: { ...user, capabilities: { terminal: false } } });
    });
    await page.goto("/");
    await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
    await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Toggle Terminal" })).toHaveCount(0);
    await page.getByTestId("top-menu-file").click();
    await expect(page.getByRole("menuitem", { name: "Run Active File" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(page.locator('[data-command-id="toggle-terminal"]')).toHaveCount(0);
    await expect(page.locator('[data-command-id="run-active-file"]')).toHaveCount(0);
    await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
  });

  test("notifications panel shows a real empty state in a fresh session", async ({
    page,
  }) => {
    await page.goto("/");
    await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
    await page.waitForURL("/workspace", { timeout: 20_000 });
    await page.waitForSelector('[data-testid="workspace-root"][data-backend-status="available"]', {
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Notifications" }).click();
    const panel = page.getByTestId("notifications-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("notifications-empty")).toBeVisible();
    await expect(panel).toContainText("No notifications");
    expect((await panel.textContent()) ?? "").not.toContain("Collaborator joined");
  });

  test("Collaborate opens the collaboration panel without starting a new session", async ({
    page,
  }) => {
    await page.goto("/");
    await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
    await page.waitForURL("/workspace", { timeout: 20_000 });
    await page.waitForSelector('[data-testid="workspace-root"][data-backend-status="available"]', {
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Collaboration", exact: true }).click();
    await expect(page.getByTestId("collaboration-panel")).toHaveCount(0);
    await page.getByRole("button", { name: "Show collaboration" }).click();
    await expect(page).toHaveURL(/\/workspace/);
    await expect(page.getByTestId("collaboration-panel")).toBeVisible();
  });
});
