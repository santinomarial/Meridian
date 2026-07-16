/**
 * UI controls E2E tests.
 *
 * Offline tests hit the unavailable gate. Share / collaboration panel behavior
 * that needs a real workspace runs only when the backend is available.
 */
import { test, expect, type Page } from "@playwright/test";
import { isBackendAvailable, uniqueEmail, signUpViaUI } from "./helpers/auth.js";
import { STRONG_PASSWORD, freshWorkspace } from "./helpers/workspace.js";

/** Block the API and open the hard-gated unavailable screen. */
async function openUnavailableGate(page: Page): Promise<void> {
  const apiBase = process.env["MERIDIAN_BACKEND_URL"] ?? "http://localhost:3000";
  await page.route(`${apiBase}/**`, (route) => route.abort("connectionrefused"));
  await page.goto("/workspace");
  await page.waitForSelector('[data-testid="workspace-root"]', { timeout: 15_000 });
  await page.waitForSelector('[data-testid="backend-unavailable-gate"]', {
    timeout: 10_000,
  });
}

// ── Theme toggle (available on the unavailable gate) ──────────────────────────

test.describe("theme toggle", () => {
  test("clicking theme toggle switches between dark and light", async ({ page }) => {
    await openUnavailableGate(page);
    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle).toBeVisible();

    const labelBefore = await toggle.getAttribute("aria-label");
    await toggle.click();
    const labelAfter = await toggle.getAttribute("aria-label");

    expect(labelBefore).not.toBe(labelAfter);
    expect(["Switch to light mode", "Switch to dark mode"]).toContain(labelAfter);
  });

  test("theme change is reflected on the html element class", async ({ page }) => {
    await openUnavailableGate(page);
    const toggle = page.getByTestId("theme-toggle");

    const htmlClasses = await page.locator("html").getAttribute("class");
    const startsDark = htmlClasses?.includes("dark") ?? false;

    await toggle.click();

    const htmlClassesAfter = await page.locator("html").getAttribute("class");
    if (startsDark) {
      expect(htmlClassesAfter).not.toContain("dark");
    } else {
      expect(htmlClassesAfter).toContain("dark");
    }
  });

  test("theme is toggled and gate remains mounted", async ({ page }) => {
    await openUnavailableGate(page);
    await page.getByTestId("theme-toggle").click();
    await expect(page.getByTestId("workspace-root")).toBeVisible();
    await expect(page.getByTestId("backend-unavailable-gate")).toBeVisible();
  });
});

// ── Share dialog ──────────────────────────────────────────────────────────────

test.describe("share / invite dialog", () => {
  test("unavailable gate does not expose a Share button", async ({ page }) => {
    await openUnavailableGate(page);
    await expect(page.getByTestId("share-button")).toHaveCount(0);
    await expect(page.getByTestId("share-dialog")).toHaveCount(0);
  });

  test("invite route /invite/demo loads without crashing", async ({ page }) => {
    await page.goto("/invite/demo");
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.locator("body")).not.toContainText("Cannot GET");
  });

  test.describe("backend owner (backend required)", () => {
    let backendAvailable = false;

    test.beforeAll(async () => {
      backendAvailable = await isBackendAvailable();
    });

    test.beforeEach(() => {
      test.skip(!backendAvailable, "Backend not available — skipping owner share tests");
    });

    test("owner: clicking Share opens the real invite dialog", async ({ page }) => {
      await freshWorkspace(page);
      await page.getByTestId("share-button").click();
      await expect(page.getByTestId("share-dialog")).toBeVisible();
    });

    test("owner: share dialog shows a real backend invite link", async ({ page }) => {
      await freshWorkspace(page);
      await page.getByTestId("share-button").click();
      const linkDisplay = page.getByTestId("invite-link-display");
      await expect(linkDisplay).toBeVisible();
      await expect(linkDisplay).not.toContainText("/invite/demo", { timeout: 10_000 });
      expect((await linkDisplay.textContent()) ?? "").toMatch(/\/invite\/.+/);
    });

    test("owner: copy invite link button shows 'Copied!' feedback", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await freshWorkspace(page);
      await page.getByTestId("share-button").click();

      await expect(page.getByTestId("invite-link-display")).not.toContainText(
        "/invite/demo",
        { timeout: 10_000 },
      );
      const copyBtn = page.getByTestId("copy-invite-link");
      await copyBtn.click();
      await expect(copyBtn).toHaveText("Copied!", { timeout: 3_000 });
    });

    test("owner: closing share dialog by clicking outside dismisses it", async ({ page }) => {
      await freshWorkspace(page);
      await page.getByTestId("share-button").click();
      await expect(page.getByTestId("share-dialog")).toBeVisible();

      await page.mouse.click(50, 200);
      await expect(page.getByTestId("share-dialog")).toBeHidden({ timeout: 3_000 });
    });
  });
});

// ── Collaboration panel ───────────────────────────────────────────────────────

test.describe("collaboration panel", () => {
  test("unavailable gate does not show mock collaborators", async ({ page }) => {
    await openUnavailableGate(page);
    await expect(page.getByTestId("collaboration-panel")).toHaveCount(0);
    await expect(page.getByText(/demo collaborators/i)).toHaveCount(0);
  });

  test.describe("backend mode collab panel", () => {
    let backendAvailable = false;

    test.beforeAll(async () => {
      backendAvailable = await isBackendAvailable();
    });

    test.beforeEach(() => {
      test.skip(!backendAvailable, "Backend not available");
    });

    test("tablet layout opens only one drawer at a time", async ({ page }) => {
      await page.setViewportSize({ width: 800, height: 900 });
      await freshWorkspace(page);

      await expect(page.getByRole("dialog", { name: "Explorer" })).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "Collaboration" })).toHaveCount(0);

      await page.getByRole("button", { name: "Explorer", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Explorer" })).toBeVisible();

      await page.getByRole("button", { name: "Collaboration", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Explorer" })).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "Collaboration" })).toBeVisible();
    });

    test("activity bar toggles the desktop collaboration panel", async ({ page }) => {
      await freshWorkspace(page);

      const toggle = page.getByRole("button", { name: "Collaboration", exact: true });
      const panel = page.getByTestId("collaboration-panel");

      if (!(await panel.isVisible().catch(() => false))) {
        await toggle.click();
      }
      await expect(panel).toBeVisible();
      await toggle.click();
      await expect(panel).toHaveCount(0);
      await expect(toggle).toHaveAttribute("aria-pressed", "false");

      await toggle.click();
      await expect(panel).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
    });

    test("backend mode shows 'No collaborators yet' when no collaborators joined", async ({
      page,
    }) => {
      await page.goto("/");
      await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
      await page.waitForURL("/workspace", { timeout: 20_000 });

      await page.waitForSelector('[data-testid="workspace-root"][data-backend-status="available"]', {
        timeout: 15_000,
      });

      const noCollabEl = page.getByTestId("collab-no-collaborators");
      const panelVisible = await page
        .getByTestId("collaboration-panel")
        .isVisible()
        .catch(() => false);
      if (!panelVisible) {
        await page.getByRole("button", { name: "View", exact: true }).click();
        await page.getByRole("menuitem", { name: "Toggle Collaboration" }).click();
      }

      await expect(noCollabEl).toBeVisible({ timeout: 8_000 });
      await expect(noCollabEl).toContainText("No collaborators yet");
    });
  });
});
