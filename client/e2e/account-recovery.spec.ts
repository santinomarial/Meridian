import { test, expect } from "@playwright/test";
import { freshWorkspace } from "./helpers/workspace.js";

test("failed password recovery stays on the form and allows retry", async ({ page }) => {
  await page.route("**/auth/forgot-password", (route) => route.abort("connectionrefused"));
  await page.goto("/");
  await page.getByText("Forgot password?", { exact: true }).click();
  await page.getByLabel("Email Address").fill("recovery@example.com");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("forgot-success")).toHaveCount(0);
  await expect(page.getByTestId("auth-error")).toContainText("Unable to connect to Meridian");
  await expect(page.getByTestId("auth-submit")).toBeEnabled();

  await page.route("**/auth/forgot-password", (route) => route.fulfill({
    json: { message: "If the account exists, a reset link has been sent." },
  }));
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("forgot-success")).toBeVisible();
});

test("settings keeps password recovery retryable after an HTTP failure", async ({ page }) => {
  await freshWorkspace(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.route("**/auth/forgot-password", (route) => route.fulfill({
    status: 503, json: { message: "Temporarily unavailable" },
  }));
  const reset = page.getByTestId("settings-reset-password");
  await reset.click();
  await expect(page.getByRole("status").filter({ hasText: "Could not request a reset link" })).toBeVisible();
  await expect(reset).toBeEnabled();
  await expect(reset).toHaveText("Reset password");

  await page.route("**/auth/forgot-password", (route) => route.fulfill({
    json: { message: "Reset requested", previewResetUrl: "/reset-password?token=preview-test" },
  }));
  await reset.click();
  await expect(page.getByTestId("settings-preview-reset-link")).toBeVisible();
  await expect(reset).toHaveText("Link ready");
  await expect(reset).toBeDisabled();
});

test("settings prevents duplicate password reset requests while waiting", async ({ page }) => {
  await freshWorkspace(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/auth/forgot-password", async (route) => {
    requests += 1;
    await pending;
    await route.fulfill({ json: { message: "Reset requested" } });
  });
  const reset = page.getByTestId("settings-reset-password");
  try {
    await reset.click();
    await expect(reset).toBeDisabled();
    await expect(reset).toHaveText("Requesting…");
    await expect.poll(() => requests).toBe(1);
  } finally {
    release();
  }
  await expect(reset).toHaveText("Reset requested");
});
