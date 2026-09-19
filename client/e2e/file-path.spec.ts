import { test, expect } from "@playwright/test";
import { freshWorkspace } from "./helpers/workspace.js";

test("Copy Path preserves nested folders and exposes a clean control label", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await freshWorkspace(page);
  await page.getByTestId("new-file-button").click();
  await page.getByTestId("new-item-input").fill("src/utils/format.ts");
  await page.getByTestId("new-item-input").press("Enter");
  await expect(page.getByRole("tab", { name: "format.ts", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const copy = page.getByRole("menuitem", { name: /Copy Path$/ });
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("src/utils/format.ts");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(copy).toHaveAccessibleName("Copy Path");
});
