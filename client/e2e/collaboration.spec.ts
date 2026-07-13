/**
 * Multi-user collaboration E2E tests.
 *
 * Drives two isolated browser contexts (Alice and Bob) through the full
 * collaboration loop: invite link → join workspace → live presence → chat
 * → realtime co-editing over Yjs.
 *
 * All tests require a running backend. Run with:
 *   E2E_TEST=true npm run start:dev   # in server/
 *   npm run test:e2e                  # in client/
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { isBackendAvailable, uniqueEmail, signUpViaUI } from "./helpers/auth.js";

const STRONG_PASSWORD = "Test@1234!";

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function fileItem(page: Page, name: string): Locator {
  return page.locator(`[data-testid="file-tree-item"][data-node-name="${name}"]`);
}

/** Signs up a fresh user and waits for the workspace + backend to be ready. */
async function freshWorkspace(page: Page, displayName: string): Promise<void> {
  await page.goto("/");
  await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD, displayName);
  await page.waitForURL("/workspace", { timeout: 20_000 });
  await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector(
    '[data-testid="workspace-root"][data-backend-status="available"]',
    { timeout: 20_000 },
  );
}

test.describe("collaboration (backend required)", () => {
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      console.log("⚠  Backend not available — skipping collaboration tests.");
    }
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available — skipping collaboration tests");
  });

  test("invite → join → presence, chat, and live editing sync between two users", async ({
    browser,
  }) => {
    test.setTimeout(150_000);

    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();

    try {
      // ── Alice: fresh workspace with one file ──────────────────────────────
      await freshWorkspace(alice, "Alice E2E");

      const fileName = `collab-${uid()}.ts`;
      await alice.getByTestId("new-file-button").click();
      const input = alice.getByTestId("new-item-input");
      await expect(input).toBeVisible();
      await input.fill(fileName);
      await input.press("Enter");
      await expect(fileItem(alice, fileName)).toBeVisible({ timeout: 8_000 });

      // ── Alice: grab a real invite link from the Share dialog ──────────────
      await alice.getByTestId("share-button").click();
      const linkDisplay = alice.getByTestId("invite-link-display");
      await expect(linkDisplay).toBeVisible();
      // Wait for the backend invite to replace the /invite/demo fallback.
      await expect(linkDisplay).not.toContainText("/invite/demo", { timeout: 10_000 });
      const inviteLink = ((await linkDisplay.textContent()) ?? "").trim();
      expect(inviteLink).toMatch(/\/invite\/.+/);
      await alice.keyboard.press("Escape");

      // ── Bob: sign up, then accept Alice's invite ───────────────────────────
      await freshWorkspace(bob, "Bob E2E");
      await bob.goto(inviteLink);
      await expect(
        bob.getByRole("button", { name: "Accept & Open Workspace" }),
      ).toBeVisible({ timeout: 10_000 });
      // The invite page shows the inviter and workspace context.
      await expect(bob.locator("body")).toContainText("Alice E2E");
      await bob.getByRole("button", { name: "Accept & Open Workspace" }).click();
      await bob.waitForURL(/\/workspace\/[^/?#]+(?:[?#].*)?$/, { timeout: 15_000 });
      await bob.waitForSelector(
        '[data-testid="workspace-root"][data-backend-status="available"]',
        { timeout: 20_000 },
      );

      // Bob lands in Alice's (older) workspace and sees her file.
      await expect(fileItem(bob, fileName)).toBeVisible({ timeout: 10_000 });

      // ── Both open the same document ────────────────────────────────────────
      await fileItem(bob, fileName).click();
      await fileItem(alice, fileName).click();

      // ── Presence: each side sees the other in the collaboration panel ──────
      await expect(alice.getByTestId("collaboration-panel")).toContainText("Bob E2E", {
        timeout: 20_000,
      });
      await expect(bob.getByTestId("collaboration-panel")).toContainText("Alice E2E", {
        timeout: 20_000,
      });

      // ── Chat: Alice sends a message, Bob receives it live ─────────────────
      const chatText = `hello from alice ${uid()}`;
      const aliceChatInput = alice.getByPlaceholder("Send a message…");
      await aliceChatInput.fill(chatText);
      await aliceChatInput.press("Enter");
      // Sender sees their own message immediately…
      await expect(alice.getByTestId("collaboration-panel")).toContainText(chatText);
      // …and it arrives at Bob over the socket.
      await expect(bob.getByTestId("collaboration-panel")).toContainText(chatText, {
        timeout: 15_000,
      });

      // ── Live editing: Alice types, Bob's editor converges via Yjs ─────────
      const editToken = `yjs${uid()}`;
      await alice.locator(".monaco-editor .view-lines").first().click();
      await alice.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
      await alice.keyboard.type(`// ${editToken}`);
      // Sanity check: the edit landed in Alice's editor…
      await expect(
        alice.getByTestId("monaco-editor-wrapper"),
      ).toContainText(editToken, { timeout: 10_000 });
      // …and converges in Bob's editor via Yjs.
      await expect(
        bob.getByTestId("monaco-editor-wrapper"),
      ).toContainText(editToken, { timeout: 20_000 });
    } finally {
      await aliceContext.close();
      await bobContext.close();
    }
  });
});
