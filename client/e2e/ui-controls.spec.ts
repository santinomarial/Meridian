/**
 * UI controls E2E tests.
 *
 * Theme toggle, share dialog, invite link, and collaboration panel tests.
 * These tests use the demo/offline workspace (no backend needed) unless
 * otherwise noted.
 */
import { test, expect, type Page } from "@playwright/test";
import { isBackendAvailable, uniqueEmail, signUpViaUI } from "./helpers/auth.js";
import { STRONG_PASSWORD, freshWorkspace } from "./helpers/workspace.js";

/**
 * Navigate to the workspace in demo mode. The backend API is blocked so the
 * app reliably falls into the offline/demo state — an unauthenticated visit
 * with a reachable backend now redirects to the login page instead.
 */
async function openDemoWorkspace(page: Page): Promise<void> {
  const apiBase = process.env["MERIDIAN_BACKEND_URL"] ?? "http://localhost:3000";
  await page.route(`${apiBase}/**`, (route) => route.abort("connectionrefused"));
  await page.goto("/workspace");
  // Wait for the workspace to settle — backend-unavailable banner will show.
  await page.waitForSelector('[data-testid="workspace-root"]', { timeout: 15_000 });
  await page.waitForSelector('[data-testid="backend-unavailable-banner"]', {
    timeout: 10_000,
  });
}

// ── Theme toggle ──────────────────────────────────────────────────────────────

test.describe("theme toggle", () => {
  test("clicking theme toggle switches between dark and light", async ({ page }) => {
    await openDemoWorkspace(page);
    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle).toBeVisible();

    // Read the current aria-label to determine initial theme
    const labelBefore = await toggle.getAttribute("aria-label");
    await toggle.click();
    const labelAfter = await toggle.getAttribute("aria-label");

    // Labels should be inverses of each other
    expect(labelBefore).not.toBe(labelAfter);
    // One of the two known values
    expect(["Switch to light mode", "Switch to dark mode"]).toContain(
      labelAfter,
    );
  });

  test("theme change is reflected on the html element class", async ({ page }) => {
    await openDemoWorkspace(page);
    const toggle = page.getByTestId("theme-toggle");

    // The workspace always starts in dark mode.
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

  test("theme is toggled and editor wrapper does not disappear after toggle", async ({
    page,
  }) => {
    // Regression guard: theme toggle must not unmount the editor.
    // TODO: Strengthen once we can assert Monaco instance doesn't re-mount.
    await openDemoWorkspace(page);
    await page.getByTestId("theme-toggle").click();
    // The workspace root should still be in the DOM
    await expect(page.getByTestId("workspace-root")).toBeVisible();
  });
});

// ── Share dialog ──────────────────────────────────────────────────────────────
//
// Share is owner-gated: it appears only when the backend is available, the
// workspace is loaded, and the current user is an owner. Demo/offline mode
// establishes no real ownership, so the control is honestly absent there — it
// is never faked. The real dialog is covered against a backend owner below.

test.describe("share / invite dialog", () => {
  test("demo mode does not expose a Share button (owner-gated, not faked)", async ({ page }) => {
    await openDemoWorkspace(page);
    // No Share control and no share dialog in demo mode — the honest state.
    await expect(page.getByTestId("share-button")).toHaveCount(0);
    await expect(page.getByTestId("share-dialog")).toHaveCount(0);
  });

  test("invite route /invite/demo loads without crashing", async ({ page }) => {
    await page.goto("/invite/demo");
    // InvitePage should render — it shows either an accept UI or a
    // not-signed-in prompt.  Either way the page must not be blank/errored.
    await expect(page.locator("body")).not.toBeEmpty();
    // Must not be a blank error page
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
      // A real, persisted invite token — not the /invite/demo fallback.
      await expect(linkDisplay).not.toContainText("/invite/demo", { timeout: 10_000 });
      expect((await linkDisplay.textContent()) ?? "").toMatch(/\/invite\/.+/);
    });

    test("owner: copy invite link button shows 'Copied!' feedback", async ({ page, context }) => {
      // Grant clipboard-write permission so the copy actually succeeds.
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await freshWorkspace(page);
      await page.getByTestId("share-button").click();

      const copyBtn = page.getByTestId("copy-invite-link");
      await copyBtn.click();
      // Button text changes to "Copied!" for 2 seconds.
      await expect(copyBtn).toHaveText("Copied!", { timeout: 3_000 });
    });

    test("owner: closing share dialog by clicking outside dismisses it", async ({ page }) => {
      await freshWorkspace(page);
      await page.getByTestId("share-button").click();
      await expect(page.getByTestId("share-dialog")).toBeVisible();

      // Click somewhere neutral (outside the dialog).
      await page.mouse.click(50, 200);
      await expect(page.getByTestId("share-dialog")).toBeHidden({ timeout: 3_000 });
    });
  });
});

// ── Collaboration panel ───────────────────────────────────────────────────────

test.describe("collaboration panel", () => {
  test("tablet layout opens only one drawer at a time", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openDemoWorkspace(page);

    await expect(page.getByRole("dialog", { name: "Explorer" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Collaboration" })).toHaveCount(0);

    await page.getByRole("button", { name: "Explorer", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Explorer" })).toBeVisible();

    await page.getByRole("button", { name: "Collaboration", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Explorer" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Collaboration" })).toBeVisible();
  });

  test("activity bar toggles the desktop collaboration panel", async ({ page }) => {
    await openDemoWorkspace(page);

    const toggle = page.getByRole("button", { name: "Collaboration", exact: true });
    const panel = page.getByTestId("collaboration-panel");

    await expect(panel).toBeVisible();
    await toggle.click();
    await expect(panel).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  test("demo mode shows demo-labelled collaborators, not real users", async ({ page }) => {
    // Block the backend API to force demo mode unconditionally, regardless of
    // whether the server is running.  Mirrors the pattern in offline.spec.ts.
    const apiBase = process.env["MERIDIAN_BACKEND_URL"] ?? "http://localhost:3000";
    await page.route(`${apiBase}/**`, (route) => route.abort("connectionrefused"));

    await page.goto("/workspace");
    // Wait for the backend-unavailable banner — guaranteed because the API is blocked.
    await page.waitForSelector('[data-testid="backend-unavailable-banner"]', {
      timeout: 10_000,
    });

    // The collaboration panel should show mock/demo collaborators clearly
    // labelled as "demo".  Verify the panel heading or badge contains "demo".
    const panel = page.getByTestId("collaboration-panel");
    await expect(panel).toBeVisible();
    const panelText = (await panel.textContent()) ?? "";
    expect(panelText.toLowerCase()).toContain("demo");
  });

  test.describe("backend mode collab panel", () => {
    // Check backend availability once for this describe block.
    let backendAvailable = false;

    test.beforeAll(async () => {
      backendAvailable = await isBackendAvailable();
    });

    test.beforeEach(() => {
      test.skip(!backendAvailable, "Backend not available");
    });

    test("backend mode shows 'No collaborators yet' when no collaborators joined", async ({
      page,
    }) => {
      // Sign up so we're in real backend mode
      await page.goto("/");
      await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
      await page.waitForURL("/workspace", { timeout: 20_000 });

      // Wait for backend status to resolve
      await page.waitForSelector('[data-testid="workspace-root"][data-backend-status="available"]', {
        timeout: 15_000,
      });

      const noCollabEl = page.getByTestId("collab-no-collaborators");
      // Collaboration panel may not be open by default — toggle it if needed.
      const panelVisible = await page
        .getByTestId("collaboration-panel")
        .isVisible()
        .catch(() => false);
      if (!panelVisible) {
        // Open via View menu (exact name avoids the "View collaborators" button;
        // menu entries are ARIA menuitems).
        await page.getByRole("button", { name: "View", exact: true }).click();
        await page.getByRole("menuitem", { name: "Toggle Collaboration" }).click();
      }

      await expect(noCollabEl).toBeVisible({ timeout: 8_000 });
      await expect(noCollabEl).toContainText("No collaborators yet");
    });
  });
});
