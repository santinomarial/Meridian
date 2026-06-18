/**
 * Shared workspace / invite E2E helpers.
 *
 * Centralizes the signup → ready-workspace → invite → accept flow so individual
 * specs don't each re-implement (and subtly diverge on) the readiness waits that
 * make multi-user tests reliable. All helpers assume a real backend; gate with
 * `isBackendAvailable()` from ./auth before using them.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { signUpViaUI, uniqueEmail } from "./auth.js";

export const STRONG_PASSWORD = "Test@1234!";

/** Short unique suffix so file/folder/workspace names never collide across runs. */
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Locate a file-tree item by its exact displayed name. */
export function fileItem(page: Page, name: string): Locator {
  return page.locator(`[data-testid="file-tree-item"][data-node-name="${name}"]`);
}

/**
 * Signs up a fresh user and waits until the backend workspace is fully ready.
 *
 * The readiness wait is deliberate: navigating away (e.g. to an invite link)
 * before the session cookie and auto-created workspace settle lands the user on
 * the unauthenticated invite screen, which has no "Accept & Open Workspace"
 * button — the classic source of multi-user flakiness.
 */
export async function freshWorkspace(page: Page, displayName = "Test User"): Promise<void> {
  await page.goto("/");
  await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD, displayName);
  await page.waitForURL("/workspace", { timeout: 20_000 });
  await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector(
    '[data-testid="workspace-root"][data-backend-status="available"]',
    { timeout: 20_000 },
  );
}

/**
 * Owner-only: opens the Share dialog and returns a real backend invite link.
 * Share is owner-gated, so the caller must currently be a workspace owner.
 */
export async function getOwnerInviteLink(
  page: Page,
  role: "EDITOR" | "VIEWER" = "EDITOR",
): Promise<string> {
  await page.getByTestId("share-button").click();
  if (role === "VIEWER") {
    await page.getByLabel("Invite role").selectOption("VIEWER");
  }
  const linkDisplay = page.getByTestId("invite-link-display");
  await expect(linkDisplay).toBeVisible();
  // Wait for the backend-generated token to replace the /invite/demo fallback.
  await expect(linkDisplay).not.toContainText("/invite/demo", { timeout: 10_000 });
  const inviteLink = ((await linkDisplay.textContent()) ?? "").trim();
  expect(inviteLink).toMatch(/\/invite\/.+/);
  await page.keyboard.press("Escape");
  return inviteLink;
}

/**
 * Accepts an invite as an already-signed-in user.
 * Waits for the authenticated accept button before clicking so it never races
 * the invite page's session check.
 */
export async function acceptInvite(page: Page, inviteLink: string): Promise<void> {
  await page.goto(inviteLink);
  const acceptBtn = page.getByRole("button", { name: "Accept & Open Workspace" });
  await expect(acceptBtn).toBeVisible({ timeout: 10_000 });
  await acceptBtn.click();
  await page.waitForURL("/workspace", { timeout: 15_000 });
  await page.waitForSelector(
    '[data-testid="workspace-root"][data-backend-status="available"]',
    { timeout: 20_000 },
  );
}

/** Signs up a second user and joins the given workspace invite in one step. */
export async function signUpAndAcceptInvite(
  page: Page,
  inviteLink: string,
  displayName: string,
): Promise<void> {
  await freshWorkspace(page, displayName);
  await acceptInvite(page, inviteLink);
}
