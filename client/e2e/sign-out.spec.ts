import { test, expect } from "@playwright/test";
import { freshWorkspace } from "./helpers/workspace.js";

const API = process.env["MERIDIAN_BACKEND_URL"] ?? "http://localhost:3000";

for (const entry of ["account menu", "command palette"] as const) {
  test(`${entry}: failed sign-out preserves the workspace and allows retry`, async ({ page }) => {
    await freshWorkspace(page);
    const signOut = async () => {
      if (entry === "account menu") {
        await page.getByTestId("account-menu-button").click();
        await page.getByRole("button", { name: /Sign out$/ }).click();
      } else {
        await page.keyboard.press("ControlOrMeta+k");
        await page.getByTestId("command-palette-input").fill("Sign Out");
        await page.keyboard.press("Enter");
      }
    };
    await page.route("**/auth/logout", (route) => route.abort("connectionrefused"));
    await signOut();
    await expect(page.getByRole("status").filter({ hasText: "Could not sign out" })).toBeVisible();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByTestId("workspace-root")).toHaveAttribute("data-backend-status", "available");
    expect((await page.request.get(`${API}/auth/me`)).status()).toBe(200);

    await page.unroute("**/auth/logout");
    await signOut();
    await expect(page).toHaveURL("/");
    expect((await page.request.get(`${API}/auth/me`)).status()).toBe(401);
    await page.goto("/workspace");
    await expect(page).toHaveURL("/");
  });
}
