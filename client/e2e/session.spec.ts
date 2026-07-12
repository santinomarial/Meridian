/**
 * Session-expiry and auth-error E2E tests.
 *
 * Covers the long-idle scenario: sessions expire, stale cookies linger in the
 * browser, and the app must treat all of that as a normal logged-out state —
 * clean login screen, specific error messages, no vague "Something went wrong".
 *
 * The first block runs without a backend (requests are intercepted).
 * The second block requires a running backend and skips otherwise.
 */
import { test, expect } from "@playwright/test";
import {
  BACKEND_URL,
  isBackendAvailable,
  uniqueEmail,
  fillLogin,
  signUpViaUI,
} from "./helpers/auth.js";

const STRONG_PASSWORD = "Test@1234!";

/** Plants a stale/garbage auth cookie, as a browser would hold after weeks away. */
async function plantStaleAuthCookie(context: {
  addCookies: (
    cookies: { name: string; value: string; domain: string; path: string }[],
  ) => Promise<void>;
}): Promise<void> {
  await context.addCookies([
    {
      name: "auth_token",
      value: "stale-garbage-from-a-long-time-ago",
      domain: "localhost",
      path: "/",
    },
  ]);
}

// ── Error messages (no backend needed — requests intercepted) ─────────────────

test.describe("login error messages", () => {
  test("backend unreachable shows the server-unavailable message, not 'Something went wrong'", async ({
    page,
  }) => {
    await page.route(`${BACKEND_URL}/**`, (route) =>
      route.abort("connectionrefused"),
    );
    await page.goto("/");
    await fillLogin(page, "someone@example.com", STRONG_PASSWORD);

    const error = page.getByTestId("auth-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("Unable to connect to Meridian");
    await expect(error).not.toContainText("Something went wrong");
  });

  test("rate-limited login shows a clear too-many-attempts message", async ({
    page,
  }) => {
    await page.route(`${BACKEND_URL}/auth/login`, (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 429,
          message: "ThrottlerException: Too Many Requests",
        }),
      }),
    );
    await page.goto("/");
    await fillLogin(page, "someone@example.com", STRONG_PASSWORD);

    const error = page.getByTestId("auth-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("Too many login attempts");
    // The raw throttler text must never leak into the UI.
    await expect(error).not.toContainText("ThrottlerException");
  });

  test("server error (500) shows a server-error message, not raw details", async ({
    page,
  }) => {
    await page.route(`${BACKEND_URL}/auth/login`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: 500, message: "Internal server error" }),
      }),
    );
    await page.goto("/");
    await fillLogin(page, "someone@example.com", STRONG_PASSWORD);

    const error = page.getByTestId("auth-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("server error");
    await expect(error).not.toContainText("Something went wrong");
  });

  test("expired-session /auth/me on boot routes to login without a fatal error", async ({
    page,
    context,
  }) => {
    // Simulate a reachable backend that rejects the stale session: /auth/me
    // returns 401. The app must land on the login screen — no crash, no
    // misleading "backend unavailable" demo mode.
    await plantStaleAuthCookie(context);
    await page.route(`${BACKEND_URL}/**`, (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: 401, message: "Session expired" }),
      }),
    );

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/workspace");
    await expect(page).toHaveURL("/", { timeout: 15_000 });
    await expect(page.getByTestId("auth-card")).toBeVisible();
    await expect(page.getByTestId("auth-submit")).toContainText("Log in");
    expect(errors).toHaveLength(0);
  });
});

// ── Real backend: stale cookie recovery ───────────────────────────────────────

test.describe("stale session recovery (backend required)", () => {
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      console.log("⚠  Backend not available — skipping session recovery tests.");
    }
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available");
  });

  test("visiting /workspace with a stale cookie shows the login screen, not a crash", async ({
    page,
    context,
  }) => {
    await plantStaleAuthCookie(context);

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/workspace");
    // The backend rejects the garbage cookie with 401 → treated as logged out.
    await expect(page).toHaveURL("/", { timeout: 15_000 });
    await expect(page.getByTestId("auth-card")).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test("login still works after a stale cookie: fresh session replaces the dead one", async ({
    page,
    context,
  }) => {
    // Create a real account first.
    const email = uniqueEmail();
    await page.goto("/");
    await signUpViaUI(page, email, STRONG_PASSWORD);
    await page.waitForURL("/workspace", { timeout: 15_000 });

    // Sign out, then plant a garbage cookie over the (cleared) real one —
    // exactly the state a browser is in weeks after the session expired.
    await page.getByTestId("account-menu-button").click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/");
    await plantStaleAuthCookie(context);

    // Logging in must succeed and replace the stale cookie with a fresh one.
    await fillLogin(page, email, STRONG_PASSWORD);
    await expect(page).toHaveURL("/workspace", { timeout: 15_000 });
    await expect(page.getByTestId("workspace-root")).toBeVisible();

    // The workspace loads with a real backend session (not demo mode).
    await page.waitForSelector(
      '[data-testid="workspace-root"][data-backend-status="available"]',
      { timeout: 15_000 },
    );

    // And the app survives a refresh — the new session cookie is valid.
    await page.reload();
    await expect(page.getByTestId("workspace-root")).toBeVisible({ timeout: 15_000 });
    await page.waitForSelector(
      '[data-testid="workspace-root"][data-backend-status="available"]',
      { timeout: 15_000 },
    );
  });

  test("wrong password after time away shows 'Invalid email or password.'", async ({
    page,
    context,
  }) => {
    await plantStaleAuthCookie(context);
    await page.goto("/");
    await fillLogin(page, "nobody-here@example.com", "WrongPass@1!");
    await expect(page.getByTestId("auth-error")).toContainText(
      "Invalid email or password",
    );
    // Password reset entry point still reachable from this state.
    await expect(page.getByTestId("forgot-password-link")).toBeVisible();
  });
});
