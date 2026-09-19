import { test, expect } from "@playwright/test";
import { BACKEND_URL } from "./helpers/auth.js";

const recoveryUser = { id: "recovery-owner", email: "owner@example.com", displayName: "Owner", capabilities: { terminal: false } };
const recoveryWorkspace = { id: "recovery-workspace", name: "Recovery workspace", ownerId: recoveryUser.id };

for (const failedPath of ["/auth/me", "/workspaces", `/workspaces/${recoveryWorkspace.id}/documents/tree`]) {
  test(`automatically recovers after a brief outage at ${failedPath}`, async ({ page }) => {
    let available = false;
    await page.route(`${BACKEND_URL}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === failedPath && !available) return route.abort("connectionrefused");
      if (path === "/auth/me") return route.fulfill({ json: recoveryUser });
      if (path === "/workspaces") return route.fulfill({ json: [recoveryWorkspace] });
      if (path.endsWith("/members")) return route.fulfill({ json: [{ userId: recoveryUser.id, role: "OWNER", user: recoveryUser }] });
      return route.fulfill({ json: [] });
    });

    await page.goto("/workspace");
    await expect(page.getByTestId("backend-unavailable-gate")).toBeVisible();
    available = true;
    await expect(page.getByTestId("workspace-root")).toHaveAttribute("data-backend-status", "available");
    await expect(page.getByLabel("Create your first file")).toBeVisible();
  });
}

test("stops automatic retries after a sustained outage and recovers when the connection returns", async ({ page }) => {
  let available = false;
  let sessionRequests = 0;
  await page.clock.install();
  await page.route(`${BACKEND_URL}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me") {
      sessionRequests += 1;
      return route.fulfill(available ? { json: recoveryUser } : { status: 503, json: { message: "Unavailable" } });
    }
    if (path === "/workspaces") return route.fulfill({ json: [recoveryWorkspace] });
    if (path.endsWith("/members")) return route.fulfill({ json: [{ userId: recoveryUser.id, role: "OWNER", user: recoveryUser }] });
    return route.fulfill({ json: [] });
  });
  await page.goto("/workspace");
  await expect(page.getByTestId("backend-unavailable-gate")).toBeVisible();
  const initialRequests = sessionRequests; // Development StrictMode may load twice.
  for (const delay of [2_000, 5_000, 10_000]) {
    const before = sessionRequests;
    await page.clock.runFor(delay + 100);
    await expect.poll(() => sessionRequests).toBe(before + 1);
  }
  await page.clock.runFor(60_000);
  expect(sessionRequests).toBe(initialRequests + 3);
  available = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("workspace-root")).toHaveAttribute("data-backend-status", "available");
});

test("does not create a duplicate workspace when the creation response is lost", async ({ page }) => {
  let creates = 0;
  await page.route(`${BACKEND_URL}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me") return route.fulfill({ json: recoveryUser });
    if (path === "/workspaces") {
      if (route.request().method() === "POST") {
        creates += 1;
        return route.abort("connectionreset");
      }
      return route.fulfill({ json: creates ? [recoveryWorkspace] : [] });
    }
    if (path.endsWith("/members")) return route.fulfill({ json: [{ userId: recoveryUser.id, role: "OWNER", user: recoveryUser }] });
    return route.fulfill({ json: [] });
  });
  await page.goto("/workspace");
  await expect(page.getByTestId("backend-unavailable-gate")).toBeVisible();
  await expect(page.getByTestId("workspace-root")).toHaveAttribute("data-backend-status", "available");
  expect(creates).toBe(1);
});

test("redirects to sign in when the session expires during workspace loading", async ({ page }) => {
  await page.route(`${BACKEND_URL}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me") return route.fulfill({ json: recoveryUser });
    return route.fulfill({ status: 401, json: { message: "Unauthorized" } });
  });
  await page.goto("/workspace");
  await expect(page.getByTestId("auth-card")).toBeVisible();
  await expect(page.getByTestId("backend-unavailable-gate")).toHaveCount(0);
});

test("leaving the unavailable workspace cancels scheduled retries", async ({ page }) => {
  let requests = 0;
  await page.clock.install();
  await page.route(`${BACKEND_URL}/**`, async (route) => {
    requests += 1;
    return route.abort("connectionrefused");
  });
  await page.goto("/workspace");
  await expect(page.getByTestId("backend-unavailable-gate")).toBeVisible();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.getByTestId("auth-card")).toBeVisible();
  const afterNavigation = requests;
  await page.clock.runFor(30_000);
  expect(requests).toBe(afterNavigation);
});

for (const failure of [429, 500, "network"] as const) {
  test(`session ${failure} shows a retry gate and recovers with owner controls`, async ({ page }) => {
    let failSession = true;
    let workspaceRequests = 0;
    const user = { id: "session-owner", email: "owner@example.com", displayName: "Owner", capabilities: { terminal: true } };
    const workspace = { id: "session-workspace", name: "Session workspace", ownerId: user.id };
    await page.route(`${BACKEND_URL}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/auth/me") {
        if (failSession) {
          if (failure === "network") return route.abort("connectionrefused");
          return route.fulfill({ status: failure, json: { message: "Session check unavailable" } });
        }
        return route.fulfill({ json: user });
      }
      if (path === "/workspaces") {
        workspaceRequests += 1;
        return route.fulfill({ json: [workspace] });
      }
      if (path.endsWith("/members")) {
        return route.fulfill({ json: [{ userId: user.id, role: "OWNER", user }] });
      }
      return route.fulfill({ json: [] });
    });

    await page.goto("/workspace");
    await expect(page.getByTestId("backend-unavailable-gate")).toBeVisible();
    expect(workspaceRequests).toBe(0);
    await expect(page.getByTestId("workspace-welcome")).toHaveCount(0);

    failSession = false;
    await page.getByTestId("backend-retry-button").click();
    await expect(page.getByTestId("workspace-root")).toHaveAttribute("data-backend-status", "available");
    await expect(page.getByLabel("Create your first file")).toBeVisible();
    await expect(page.getByTestId("backend-unavailable-gate")).toHaveCount(0);
  });
}
