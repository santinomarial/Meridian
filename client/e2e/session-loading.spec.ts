import { test, expect } from "@playwright/test";
import { BACKEND_URL } from "./helpers/auth.js";

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
