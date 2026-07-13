/**
 * Auth E2E tests — cover the landing page auth flow.
 *
 * Tests 1–6 run fully offline (no backend required).
 * Tests 7–10 require a running backend (skipped otherwise).
 */
import { test, expect } from "@playwright/test";
import {
  isBackendAvailable,
  uniqueEmail,
  fillLogin,
  signUpViaUI,
  getPasswordResetToken,
} from "./helpers/auth.js";

// Strong password that satisfies all client-side rules.
const STRONG_PASSWORD = "Test@1234!";

// ── 1. Landing page loads ──────────────────────────────────────────────────────

test("landing page loads with Meridian branding", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Meridian/);
  await expect(page.getByTestId("auth-card")).toBeVisible();
});

// ── 2. Login is the default form ───────────────────────────────────────────────

test("login is the default auth mode on page load", async ({ page }) => {
  await page.goto("/");
  const submitBtn = page.getByTestId("auth-submit");
  await expect(submitBtn).toBeVisible();
  await expect(submitBtn).toContainText("Log in");
  // Sign-up switch link is visible below
  await expect(page.getByTestId("switch-to-signup")).toBeVisible();
});

// ── 3. Sign-up is secondary ────────────────────────────────────────────────────

test("clicking sign-up switches to the sign-up form", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("switch-to-signup").click();
  await expect(page.getByTestId("auth-submit")).toContainText("Create account");
  // Should now show a "Log in" link to go back
  await expect(page.getByTestId("switch-to-login")).toBeVisible();
});

// ── 4. Weak password blocked (client-side) ─────────────────────────────────────

test("weak password is rejected before calling backend", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("switch-to-signup").click();

  // Intercept any outgoing network requests to assert none are made.
  const requests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/auth/")) requests.push(req.url());
  });

  await page.getByLabel("Full Name").fill("Test User");
  await page.getByLabel("Email Address").fill(uniqueEmail());
  // Deliberately weak — only lowercase, no digits/symbols
  await page.getByLabel(/^Password$/).fill("weakpass");
  await page.getByLabel("Confirm Password").fill("weakpass");
  await page.getByTestId("auth-submit").click();

  // Error shown, no network call made
  await expect(page.getByTestId("auth-error")).toBeVisible();
  expect(requests).toHaveLength(0);
});

// ── 5. Confirm password mismatch blocked ────────────────────────────────────────

test("password mismatch is rejected before calling backend", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("switch-to-signup").click();

  const requests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/auth/")) requests.push(req.url());
  });

  await page.getByLabel("Full Name").fill("Test User");
  await page.getByLabel("Email Address").fill(uniqueEmail());
  await page.getByLabel(/^Password$/).fill(STRONG_PASSWORD);
  await page.getByLabel("Confirm Password").fill("Different@1!");
  await page.getByTestId("auth-submit").click();

  await expect(page.getByTestId("auth-error")).toContainText("do not match");
  expect(requests).toHaveLength(0);
});

// ── 6. Password strength indicator visible on sign-up ──────────────────────────

test("password requirements list is visible in sign-up mode", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("switch-to-signup").click();
  await page.getByLabel(/^Password$/).fill("a");
  // Each requirement should now be rendered
  await expect(page.getByLabel("Password requirements")).toBeVisible();
});

// ── 7. Forgot password flow (no backend needed) ────────────────────────────────

test("forgot password flow shows professional success message", async ({ page }) => {
  await page.route("**/auth/forgot-password", (route) =>
    route.abort("connectionrefused"),
  );
  await page.goto("/forgot-password");

  await expect(page.getByTestId("auth-submit")).toContainText("Send reset link");
  await page.getByLabel("Email Address").fill("person@example.com");
  await page.getByTestId("auth-submit").click();

  await expect(page.getByTestId("forgot-success")).toContainText(
    "reset link has been sent",
  );
  await page.getByTestId("back-to-login").click();
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("auth-submit")).toContainText("Log in");
});

// ── 8–10. Backend-required tests ───────────────────────────────────────────────

test.describe("backend required — auth", () => {
  // Check once for the whole describe block — avoids per-test GET /auth/me calls
  // that would otherwise exhaust the auth rate limiter.
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      console.log("⚠  Backend not available — skipping backend auth tests.");
    }
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available");
  });

  test("strong password sign-up creates account and redirects to workspace", async ({ page }) => {
    const email = uniqueEmail();
    await page.goto("/");
    await signUpViaUI(page, email, STRONG_PASSWORD);
    await expect(page).toHaveURL("/workspace", { timeout: 15_000 });
    await expect(page.getByTestId("workspace-root")).toBeVisible();
  });

  test("sign out navigates back to landing page", async ({ page }) => {
    const email = uniqueEmail();
    await page.goto("/");
    await signUpViaUI(page, email, STRONG_PASSWORD);
    await page.waitForURL("/workspace", { timeout: 15_000 });

    // Open account menu and sign out
    await page.getByTestId("account-menu-button").click();
    await expect(page.getByTestId("account-menu")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/");
    // Login form shown again
    await expect(page.getByTestId("auth-submit")).toContainText("Log in");
  });

  test("wrong credentials show 'Invalid email or password' and forgot-password link", async ({
    page,
  }) => {
    await page.goto("/");
    await fillLogin(page, "nobody@example.com", "WrongPass@1!");
    await expect(page.getByTestId("auth-error")).toContainText(
      "Invalid email or password",
    );
    await expect(page.getByTestId("forgot-password-link")).toBeVisible();
  });

  test("forgot password flow: enter email, get success message", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email Address").fill("nobody@example.com");
    await page.getByTestId("forgot-password-link").click();

    // Should switch to the forgot-password form, email pre-filled
    await expect(page.getByTestId("auth-submit")).toContainText("Send reset link");
    const emailInput = page.getByLabel("Email Address");
    await expect(emailInput).toHaveValue("nobody@example.com");

    // Submit
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("forgot-success")).toBeVisible();
    await expect(page.getByTestId("forgot-success")).toContainText(
      "reset link has been sent",
    );
  });

  test("log back in after sign-out", async ({ page }) => {
    const email = uniqueEmail();
    // Create account
    await page.goto("/");
    await signUpViaUI(page, email, STRONG_PASSWORD);
    await page.waitForURL("/workspace", { timeout: 15_000 });

    // Sign out
    await page.getByTestId("account-menu-button").click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/");

    // Log back in
    await fillLogin(page, email, STRONG_PASSWORD);
    await expect(page).toHaveURL("/workspace", { timeout: 15_000 });
    await expect(page.getByTestId("workspace-root")).toBeVisible();
  });

  // ── Full password-reset flow ─────────────────────────────────────────────────

  test("full password-reset flow: reset works, old password fails, new password works", async ({
    page,
  }) => {
    const email = uniqueEmail();
    const newPassword = "NewPass@9876!";

    // Create account and sign out
    await page.goto("/");
    await signUpViaUI(page, email, STRONG_PASSWORD);
    await page.waitForURL("/workspace", { timeout: 15_000 });
    await page.getByTestId("account-menu-button").click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/");

    // Get a raw reset token via the E2E-only endpoint (no email sent)
    const { token } = await getPasswordResetToken(page, email);

    // Navigate to the reset URL
    await page.goto(`/reset-password/${token}`);
    await expect(page.getByTestId("reset-password-form")).toBeVisible({ timeout: 10_000 });

    // Weak password is blocked client-side before any network call
    const requests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/auth/")) requests.push(req.url());
    });
    await page.getByLabel("New Password").fill("weakpass");
    await page.getByLabel("Confirm Password").fill("weakpass");
    await page.getByTestId("reset-submit").click();
    await expect(page.getByTestId("reset-error")).toBeVisible();
    expect(requests.filter((u) => u.includes("reset-password"))).toHaveLength(0);

    // Mismatched confirm password is also blocked client-side
    await page.getByLabel("New Password").fill(newPassword);
    await page.getByLabel("Confirm Password").fill("Different@1!");
    await page.getByTestId("reset-submit").click();
    await expect(page.getByTestId("reset-error")).toContainText("do not match");
    expect(requests.filter((u) => u.includes("reset-password"))).toHaveLength(0);

    // Valid submission succeeds
    await page.getByLabel("New Password").fill(newPassword);
    await page.getByLabel("Confirm Password").fill(newPassword);
    await page.getByTestId("reset-submit").click();
    await expect(page.getByTestId("reset-success")).toBeVisible({ timeout: 10_000 });

    // Follow the "Log in" link back to the landing page
    await page.getByTestId("back-to-login").click();
    await expect(page).toHaveURL("/");

    // Old password no longer works
    await fillLogin(page, email, STRONG_PASSWORD);
    await expect(page.getByTestId("auth-error")).toBeVisible({ timeout: 8_000 });

    // New password works
    await fillLogin(page, email, newPassword);
    await expect(page).toHaveURL("/workspace", { timeout: 15_000 });
    await expect(page.getByTestId("workspace-root")).toBeVisible();
  });

  test("invalid reset token shows error and link back to forgot-password", async ({ page }) => {
    await page.goto("/reset-password/this-is-not-a-valid-token");
    await expect(page.getByTestId("reset-password-form")).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("New Password").fill(STRONG_PASSWORD);
    await page.getByLabel("Confirm Password").fill(STRONG_PASSWORD);
    await page.getByTestId("reset-submit").click();

    // Backend returns 400 with "invalid or expired" message
    const errorEl = page.getByTestId("reset-error");
    await expect(errorEl).toBeVisible({ timeout: 8_000 });
    await expect(errorEl).toContainText(/invalid|expired/i);
    // Link back to request a new reset is shown
    await expect(page.getByTestId("back-to-forgot")).toBeVisible();
  });
});
