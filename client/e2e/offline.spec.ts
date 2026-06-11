/**
 * Backend-unavailable E2E tests.
 *
 * These tests simulate the backend being unreachable and verify the frontend
 * degrades gracefully — no crash, useful fallback, demo mode clearly labelled.
 *
 * All tests here run with network calls to the backend API blocked, so they
 * do NOT require a real backend to be running.
 */
import { test, expect } from "@playwright/test";

// Block all requests to the backend API before each test so the app falls
// into demo mode regardless of whether the server is actually running.
test.beforeEach(async ({ page }) => {
  const apiBase =
    process.env["MERIDIAN_BACKEND_URL"] ?? "http://localhost:3000";
  await page.route(`${apiBase}/**`, (route) => route.abort("connectionrefused"));
});

// ── App does not crash ─────────────────────────────────────────────────────────

test("workspace loads without crashing when backend is unreachable", async ({ page }) => {
  await page.goto("/workspace");
  // No JS errors should crash the page
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.waitForSelector('[data-testid="workspace-root"]', { timeout: 15_000 });
  expect(errors).toHaveLength(0);
});

// ── Fallback banner visible ────────────────────────────────────────────────────

test("backend-unavailable banner appears when API is unreachable", async ({ page }) => {
  await page.goto("/workspace");
  await page.waitForSelector('[data-testid="workspace-root"]', { timeout: 15_000 });
  // Give the backend-status probe time to fail and update the store.
  await page.waitForSelector('[data-testid="backend-unavailable-banner"]', {
    timeout: 10_000,
  });
  await expect(page.getByTestId("backend-unavailable-banner")).toContainText(
    "Backend unavailable",
  );
});

// ── Demo collaborators labelled clearly ───────────────────────────────────────

test("demo collaborators are labelled as 'Demo', not shown as real users", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.waitForSelector('[data-testid="backend-unavailable-banner"]', {
    timeout: 10_000,
  });

  // The collaboration panel heading/badge should say "Demo" when in demo mode.
  const panel = page.getByTestId("collaboration-panel");
  await expect(panel).toBeVisible();
  const text = (await panel.textContent()) ?? "";
  // Must explicitly call them demo, not pretend they are real collaborators.
  expect(text.toLowerCase()).toContain("demo");
});

// ── Auth page still loads ─────────────────────────────────────────────────────

test("landing/auth page loads without crashing when backend is unreachable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/");
  await expect(page.getByTestId("auth-card")).toBeVisible();
  expect(errors).toHaveLength(0);
});

// ── Navigation between routes does not crash ──────────────────────────────────

test("navigating / → /workspace → / does not crash the app", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.getByTestId("auth-card")).toBeVisible();

  await page.goto("/workspace");
  await page.waitForSelector('[data-testid="workspace-root"]', { timeout: 15_000 });

  await page.goto("/");
  await expect(page.getByTestId("auth-card")).toBeVisible();

  expect(errors).toHaveLength(0);
});

// ── Invite route loads without crashing ───────────────────────────────────────

test("invite route /invite/demo loads without crashing when backend offline", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/invite/demo");
  await expect(page.locator("body")).not.toBeEmpty();
  expect(errors).toHaveLength(0);
});
