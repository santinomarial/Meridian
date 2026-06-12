/**
 * Shared auth helpers for E2E tests.
 */
import type { Page } from "@playwright/test";

export const BACKEND_URL =
  process.env["MERIDIAN_BACKEND_URL"] ?? "http://localhost:3000";

/** Generates a unique throwaway email address for each test run. */
export function uniqueEmail(): string {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 7);
  return `e2e-${ts}-${rnd}@example.com`;
}

/** Returns true when the backend is reachable (auth endpoint responds). */
export async function isBackendAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/auth/me`, {
      credentials: "include",
    });
    // 401 = backend up but not authenticated; anything else is also fine.
    return res.status !== 0;
  } catch {
    return false;
  }
}

/** Fills the login form and submits it. Assumes the page is at '/'. */
export async function fillLogin(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByTestId("auth-submit").click();
}

/**
 * Registers a new account through the UI.
 * Switches to sign-up mode, fills the form, and submits.
 */
export async function signUpViaUI(
  page: Page,
  email: string,
  password: string,
  name = "Test User",
): Promise<void> {
  await page.getByTestId("switch-to-signup").click();
  await page.getByLabel("Full Name").fill(name);
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel(/^Password$/).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByTestId("auth-submit").click();
}

/**
 * Calls the E2E-only backend endpoint to get a raw password reset token for
 * the given email without sending an email.  Only works when E2E_TEST=true.
 */
export async function getPasswordResetToken(
  page: Page,
  email: string,
): Promise<{ token: string; resetUrl: string }> {
  const url = `${BACKEND_URL}/auth/e2e/password-reset-token?email=${encodeURIComponent(email)}`;
  const response = await page.request.get(url);
  if (!response.ok()) {
    throw new Error(`E2E reset-token helper returned ${response.status()}`);
  }
  return response.json() as Promise<{ token: string; resetUrl: string }>;
}
