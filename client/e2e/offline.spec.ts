/**
 * Backend-unavailable E2E tests.
 *
 * These tests simulate the backend being unreachable and verify the frontend
 * hard-gates instead of silently opening a mock workspace.
 *
 * All tests here run with network calls to the backend API blocked, so they
 * do NOT require a real backend to be running.
 */
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const apiBase =
    process.env["MERIDIAN_BACKEND_URL"] ?? "http://localhost:3000";
  await page.route(`${apiBase}/**`, (route) => route.abort("connectionrefused"));
});

test("workspace loads without crashing when backend is unreachable", async ({ page }) => {
  await page.goto("/workspace");
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.waitForSelector('[data-testid="workspace-root"]', { timeout: 15_000 });
  expect(errors).toHaveLength(0);
});

test("unavailable gate appears when API is unreachable", async ({ page }) => {
  await page.goto("/workspace");
  await page.waitForSelector('[data-testid="workspace-root"]', { timeout: 15_000 });
  await page.waitForSelector('[data-testid="backend-unavailable-gate"]', {
    timeout: 10_000,
  });
  await expect(page.getByTestId("backend-unavailable-banner")).toContainText(
    "Can't reach Meridian",
  );
  await expect(page.getByTestId("backend-retry-button")).toBeVisible();
  // Must not silently show mock workspace files.
  await expect(page.getByTestId("file-tree-item")).toHaveCount(0);
  await expect(page.getByTestId("collaboration-panel")).toHaveCount(0);
});

test("landing/auth page loads without crashing when backend is unreachable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/");
  await expect(page.getByTestId("auth-card")).toBeVisible();
  expect(errors).toHaveLength(0);
});

test("navigating / → /workspace → / does not crash the app", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.getByTestId("auth-card")).toBeVisible();

  await page.goto("/workspace");
  await page.waitForSelector('[data-testid="backend-unavailable-gate"]', { timeout: 15_000 });

  await page.goto("/");
  await expect(page.getByTestId("auth-card")).toBeVisible();

  expect(errors).toHaveLength(0);
});

test("invite route /invite/demo loads without crashing when backend offline", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/invite/demo");
  await expect(page.locator("body")).not.toBeEmpty();
  expect(errors).toHaveLength(0);
});
