/**
 * UI controls E2E tests.
 *
 * Theme toggle, share dialog, invite link, and collaboration panel tests.
 * These tests use the demo/offline workspace (no backend needed) unless
 * otherwise noted.
 */
import { test, expect, type Page } from "@playwright/test";
import { isBackendAvailable, uniqueEmail, signUpViaUI } from "./helpers/auth.js";

const STRONG_PASSWORD = "Test@1234!";

/** Navigate to the workspace in demo mode (no auth required). */
async function openDemoWorkspace(page: Page): Promise<void> {
  await page.goto("/workspace");
  // Wait for the workspace to settle — backend-unavailable banner will show.
  await page.waitForSelector('[data-testid="workspace-root"]', { timeout: 15_000 });
  // Give the backend check a moment to resolve before asserting.
  await page.waitForTimeout(1_000);
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

test.describe("share / invite dialog", () => {
  test("clicking Share opens the invite dialog", async ({ page }) => {
    await openDemoWorkspace(page);
    await page.getByTestId("share-button").click();
    await expect(page.getByTestId("share-dialog")).toBeVisible();
  });

  test("share dialog shows an invite link", async ({ page }) => {
    await openDemoWorkspace(page);
    await page.getByTestId("share-button").click();
    const linkDisplay = page.getByTestId("invite-link-display");
    await expect(linkDisplay).toBeVisible();
    const linkText = await linkDisplay.textContent();
    expect(linkText).toMatch(/\/invite\//);
  });

  test("copy invite link button shows 'Copied!' feedback", async ({ page, context }) => {
    // Grant clipboard-write permission so the copy actually succeeds.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openDemoWorkspace(page);
    await page.getByTestId("share-button").click();

    const copyBtn = page.getByTestId("copy-invite-link");
    await copyBtn.click();
    // Button text changes to "Copied!" for 2 seconds
    await expect(copyBtn).toHaveText("Copied!", { timeout: 3_000 });
  });

  test("invite route /invite/demo loads without crashing", async ({ page }) => {
    await page.goto("/invite/demo");
    // InvitePage should render — it shows either an accept UI or a
    // not-signed-in prompt.  Either way the page must not be blank/errored.
    await expect(page.locator("body")).not.toBeEmpty();
    // Must not be a blank error page
    await expect(page.locator("body")).not.toContainText("Cannot GET");
  });

  test("closing share dialog by clicking outside dismisses it", async ({ page }) => {
    await openDemoWorkspace(page);
    await page.getByTestId("share-button").click();
    await expect(page.getByTestId("share-dialog")).toBeVisible();

    // Click somewhere neutral (the workspace root, outside the dialog)
    await page.mouse.click(50, 200);
    await expect(page.getByTestId("share-dialog")).toBeHidden({ timeout: 3_000 });
  });
});

// ── Collaboration panel ───────────────────────────────────────────────────────

test.describe("collaboration panel", () => {
  test("demo mode shows demo-labelled collaborators, not real users", async ({ page }) => {
    await openDemoWorkspace(page);
    const banner = page.getByTestId("backend-unavailable-banner");

    // Only test collab panel state when backend is actually unavailable
    const isMock = await banner.isVisible();
    if (!isMock) {
      // Backend is up — this test is only meaningful in demo mode.
      test.skip(true, "Workspace is in backend mode — skipping demo collab test");
      return;
    }

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
        // Open via View menu
        await page.getByRole("button", { name: "View" }).click();
        await page.getByRole("button", { name: "Toggle Collaboration" }).click();
      }

      await expect(noCollabEl).toBeVisible({ timeout: 8_000 });
      await expect(noCollabEl).toContainText("No collaborators yet");
    });
  });
});
