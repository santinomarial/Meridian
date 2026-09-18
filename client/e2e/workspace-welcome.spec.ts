import { test, expect } from "@playwright/test";
import { isBackendAvailable, signUpViaUI, uniqueEmail } from "./helpers/auth.js";
import JSZip from "jszip";

test.describe("workspace starting actions", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await isBackendAvailable()), "Backend not available");
    await page.goto("/");
    await signUpViaUI(page, uniqueEmail(), "Test@1234!");
    await expect(page.getByTestId("workspace-welcome")).toBeVisible();
  });

  test("creates the first file, persists it, and reopens it from a shortcut", async ({ page }) => {
    await page.getByLabel("Create your first file").fill("main.ts");
    await page.getByRole("button", { name: "Create file", exact: true }).click();
    await expect(page.getByTestId("monaco-editor-wrapper")).toHaveAttribute("data-collaboration-ready", "true");
    await page.reload();
    await expect(page.getByTestId("file-tree-item").filter({ hasText: "main.ts" })).toBeVisible();
    await page.getByRole("button", { name: "Close main.ts", exact: true }).click();
    await page.getByTestId("workspace-welcome").getByRole("button", { name: "main.ts", exact: true }).click();
    await expect(page.getByTestId("monaco-editor-wrapper")).toHaveAttribute("data-collaboration-ready", "true");
  });

  test("shows validation and server errors without losing the filename", async ({ page }) => {
    const input = page.getByLabel("Create your first file");
    await input.fill("../main.ts");
    await page.getByRole("button", { name: "Create file", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("File path is invalid");
    await page.route("**/workspaces/*/documents", (route) => route.fulfill({ status: 500, body: "{}" }));
    await input.fill("main.ts");
    await page.getByRole("button", { name: "Create file", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Could not create the file");
    await expect(input).toHaveValue("main.ts");
    await expect(page.getByRole("button", { name: "Create file", exact: true })).toBeEnabled();
  });

  test("imports a project directly from the welcome view on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 640 });
    const zip = new JSZip().file("main.ts", "export const answer = 42;\n");
    const [picker] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Import a ZIP archive" }).click(),
    ]);
    await picker.setFiles({ name: "project.zip", mimeType: "application/zip", buffer: await zip.generateAsync({ type: "nodebuffer" }) });
    await expect(page.getByTestId("monaco-editor-wrapper")).toHaveAttribute("data-collaboration-ready", "true");
    await page.reload();
    await expect(page.getByRole("tab", { name: /main.ts/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("opens sharing from the welcome view", async ({ page }) => {
    await page.getByTestId("workspace-welcome").getByRole("button", { name: "Invite teammates" }).click();
    await expect(page.getByTestId("share-dialog")).toBeVisible();
    await expect(page.getByTestId("invite-link-display")).toContainText(/\/invite\//);
  });

  test("a viewer of an empty workspace receives no editing or sharing actions", async ({ page }) => {
    await page.route("**/workspaces/*/members", async (route) => {
      const response = await route.fetch();
      const members = await response.json() as { role: string }[];
      await route.fulfill({ response, json: members.map((member) => ({ ...member, role: "VIEWER" })) });
    });
    await page.reload();
    const welcome = page.getByTestId("workspace-welcome");
    await expect(welcome).toContainText("An editor can add the first file.");
    await expect(welcome.getByRole("button")).toHaveCount(0);
  });
});
