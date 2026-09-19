import { test, expect, type Locator, type Page } from "@playwright/test";
import { freshWorkspace } from "./helpers/workspace.js";

async function expectFocusInside(dialog: Locator): Promise<void> {
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
}

async function checkTabCycle(page: Page, dialog: Locator): Promise<void> {
  await expectFocusInside(dialog);
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press(key);
      await expectFocusInside(dialog);
    }
  }
}

test("settings contains keyboard focus and restores it when dismissed", async ({ page }) => {
  await freshWorkspace(page);
  const trigger = page.getByRole("button", { name: "Settings", exact: true });
  await trigger.click();
  await checkTabCycle(page, page.getByTestId("settings-dialog"));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("settings fits a short viewport and its controls remain reachable", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await freshWorkspace(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const card = page.getByTestId("settings-dialog").locator(":scope > div");
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(16);
  expect(box!.y + box!.height).toBeLessThanOrEqual(374);
  await page.getByTestId("settings-reset-password").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("settings-reset-password")).toBeInViewport();
  await page.getByTestId("settings-close").click();
  await expect(card).toHaveCount(0);
});

test("command palette traps focus and returns to its trigger", async ({ page }) => {
  await freshWorkspace(page);
  const trigger = page.getByRole("button", { name: "Settings", exact: true });
  await trigger.focus();
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByTestId("command-palette");
  await checkTabCycle(page, dialog);
  await page.getByRole("button", { name: "Close command palette" }).click();
  await expect(trigger).toBeFocused();
});

test("version history remains readable on a narrow screen", async ({ page }) => {
  await freshWorkspace(page);
  await page.getByTestId("new-file-button").click();
  await page.getByTestId("new-item-input").fill("mobile.ts");
  await page.getByTestId("new-item-input").press("Enter");
  await expect(page.getByTestId("monaco-editor-wrapper")).toHaveAttribute("data-collaboration-ready", "true");
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("const readable = true;");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-save-status", "saved");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-palette-input").fill("Version History");
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("version-history-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("version-list-item").click();
  const preview = page.getByTestId("version-preview");
  await expect(preview).toContainText("readable");
  expect((await preview.boundingBox())!.width).toBeGreaterThan(300);
  await page.getByTestId("version-history-close").focus();
  await checkTabCycle(page, dialog);
});
