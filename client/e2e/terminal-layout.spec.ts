import { test, expect } from "@playwright/test";
import { BACKEND_URL, isBackendAvailable, uniqueEmail } from "./helpers/auth";

test("terminal stays usable across mobile resizing and theme changes", async ({ page }) => {
  test.skip(!(await isBackendAvailable()), "Backend required");
  const registration = await page.request.post(`${BACKEND_URL}/auth/register`, {
    data: { email: uniqueEmail(), password: "Layout-test-2026!", displayName: "Layout Review" },
  });
  expect(registration.status()).toBe(201);
  const { user } = await registration.json() as { user: { id: string } };

  try {
    await page.goto("/workspace");
    await expect(page.getByTestId("workspace-root")).toHaveAttribute("data-backend-status", "available");
    await page.getByRole("button", { name: "Toggle Terminal", exact: true }).click();
    await expect(page.getByTestId("terminal-status-label")).toContainText("Connected");
    const panel = page.getByTestId("terminal-panel");
    const rows = page.locator(".xterm-rows");

    // A shell variable proves that resizing/theme changes preserve the actual
    // session, not just a stale copy of its rendered output.
    await page.getByTestId("terminal-xterm").click();
    await page.keyboard.insertText("MERIDIAN_LAYOUT_CHECK=alive");
    await page.keyboard.press("Enter");

    for (const size of [{ width: 390, height: 740 }, { width: 320, height: 568 }, { width: 1440, height: 960 }]) {
      await page.setViewportSize(size);
      await expect.poll(async () => (await panel.boundingBox())!.height).toBeLessThanOrEqual(size.width < 640 ? 240 : 260);
      const closeButton = page.getByRole("button", { name: "Close terminal", exact: true });
      await expect(closeButton).toBeInViewport();
      await expect(page.getByRole("button", { name: "Stop terminal", exact: true })).toBeInViewport();
      const collaborators = page.getByRole("button", { name: /^View collaborators/ });
      const brand = await page.locator('header > div').first().boundingBox();
      const controls = await collaborators.boundingBox();
      expect(controls!.x).toBeGreaterThan(brand!.x + brand!.width);
      if (size.width < 640) {
        for (const [trigger, dialog] of [
          [collaborators, page.getByRole("dialog", { name: "Collaborators", exact: true })],
          [page.getByTestId("share-button"), page.getByTestId("share-dialog")],
        ]) {
          await trigger.click();
          await expect(dialog).toBeVisible();
          const bounds = (await dialog.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
          await page.keyboard.press("Escape");
        }
      }

      for (const [theme, color] of [["dark", "rgb(10, 10, 10)"], ["light", "rgb(255, 255, 255)"]]) {
        await page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true }).click();
        // xterm leaves a partial row at the bottom; its viewport must match
        // the panel rather than expose the library's default black background.
        await expect(page.locator(".xterm-viewport")).toHaveCSS("background-color", color);
        await expect(panel).toHaveCSS("background-color", color);
      }

      await page.getByTestId("terminal-xterm").click();
      await page.keyboard.insertText("echo $MERIDIAN_LAYOUT_CHECK");
      await page.keyboard.press("Enter");
      await expect(rows).toContainText("alive");
      await page.getByRole("button", { name: "Clear terminal", exact: true }).click();
      await expect(rows).not.toContainText("alive");
    }
  } finally {
    const removed = await page.request.delete(`${BACKEND_URL}/users/${user.id}`);
    expect(removed.status()).toBe(204);
  }
});
