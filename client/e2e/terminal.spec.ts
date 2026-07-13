/**
 * Terminal E2E tests.
 *
 * These tests require a backend started with the terminal feature enabled:
 *   E2E_TEST=true ENABLE_TERMINAL=true npm run start:dev   # in server/
 *   MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e  # in client/
 *
 * When the backend is absent every test in this file is skipped gracefully.
 * The terminal auto-starts an interactive PTY shell when an editor/owner opens
 * the panel, so these tests drive it like a real terminal (type → output).
 */
import { test, expect, type Page } from "@playwright/test";
import { isBackendAvailable } from "./helpers/auth.js";
import {
  acceptInvite,
  fileItem,
  freshWorkspace,
  getOwnerInviteLink,
} from "./helpers/workspace.js";

/** Opens the terminal panel via the ActivityBar button (available to all roles). */
async function openTerminalPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Toggle Terminal" }).click();
  await expect(page.getByTestId("terminal-panel")).toBeVisible({ timeout: 5_000 });
}

/** Locator for the xterm rendered text rows (DOM renderer). */
function terminalRows(page: Page) {
  return page.locator(".xterm-rows");
}

/** Clicks into the terminal and types a command followed by Enter. */
async function runInTerminal(page: Page, command: string): Promise<void> {
  await page.getByTestId("terminal-xterm").click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

/** Creates a file via the explorer, opens it, replaces its content, and saves. */
async function createFileWithContent(page: Page, name: string, content: string): Promise<void> {
  const displayedName = name.replace(/\\/g, "/").split("/").pop()!;
  await page.getByTestId("new-file-button").click();
  const input = page.getByTestId("new-item-input");
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press("Enter");
  await expect(fileItem(page, displayedName)).toBeVisible({ timeout: 8_000 });
  await fileItem(page, displayedName).click();

  await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({ timeout: 10_000 });
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(content);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 8_000 });
}

test.describe("terminal (backend required)", () => {
  let backendAvailable = false;

  test.beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      console.log("⚠  Backend not available — skipping terminal tests.");
    }
  });

  test.beforeEach(() => {
    test.skip(!backendAvailable, "Backend not available — skipping terminal tests");
  });

  // ── Panel visibility ────────────────────────────────────────────────────────

  test("terminal panel opens and closes via ActivityBar button", async ({ page }) => {
    test.setTimeout(60_000);
    await freshWorkspace(page, `TermUser-${Date.now()}`);

    await expect(page.getByTestId("terminal-panel")).not.toBeVisible();
    await openTerminalPanel(page);

    await page.getByRole("button", { name: "Close terminal" }).click();
    await expect(page.getByTestId("terminal-panel")).not.toBeVisible();
  });

  test("terminal panel opens via View menu toggle", async ({ page }) => {
    test.setTimeout(60_000);
    await freshWorkspace(page, `TermUser-${Date.now()}`);

    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: "Toggle Terminal" }).click();
    await expect(page.getByTestId("terminal-panel")).toBeVisible({ timeout: 5_000 });
  });

  // ── Focus ─────────────────────────────────────────────────────────────────────

  test("terminal receives focus after opening", async ({ page }) => {
    test.setTimeout(60_000);
    await freshWorkspace(page, `TermUser-${Date.now()}`);
    await openTerminalPanel(page);

    // The hidden xterm textarea is the focus target; it gets focus on open and
    // again once the shell is ready.
    await expect(page.locator(".xterm-helper-textarea")).toBeFocused({ timeout: 10_000 });
  });

  // ── Interactivity ──────────────────────────────────────────────────────────────

  test("owner: can type a command, press Enter, and see real shell output", async ({ page }) => {
    test.setTimeout(60_000);
    await freshWorkspace(page, `TermOwner-${Date.now()}`);
    await openTerminalPanel(page);

    // Wait for the auto-started shell to render its prompt.
    await expect(page.locator(".xterm")).toBeVisible({ timeout: 10_000 });

    // The literal command from the acceptance script — proves keystrokes reach
    // the shell and are echoed.
    await runInTerminal(page, "echo meridian-terminal-ready");
    await expect(terminalRows(page)).toContainText("meridian-terminal-ready", { timeout: 10_000 });

    // Arithmetic the shell must evaluate — proves real execution/output, not a
    // mere echo of typed input.
    await runInTerminal(page, "echo OUT_$((6*7))");
    await expect(terminalRows(page)).toContainText("OUT_42", { timeout: 10_000 });
  });

  test("owner: can run a second command after the first", async ({ page }) => {
    test.setTimeout(60_000);
    await freshWorkspace(page, `TermOwner-${Date.now()}`);
    await openTerminalPanel(page);
    await expect(page.locator(".xterm")).toBeVisible({ timeout: 10_000 });

    await runInTerminal(page, "echo first_$((1+1))");
    await expect(terminalRows(page)).toContainText("first_2", { timeout: 10_000 });

    await runInTerminal(page, "echo second_$((2+3))");
    await expect(terminalRows(page)).toContainText("second_5", { timeout: 10_000 });
  });

  test("terminal stays interactive after closing and reopening it", async ({ page }) => {
    test.setTimeout(60_000);
    await freshWorkspace(page, `TermUser-${Date.now()}`);
    await openTerminalPanel(page);
    await expect(page.locator(".xterm")).toBeVisible({ timeout: 10_000 });

    await runInTerminal(page, "echo reopen_$((1+2))");
    await expect(terminalRows(page)).toContainText("reopen_3", { timeout: 10_000 });

    // Close, then reopen via the ActivityBar.
    await page.getByRole("button", { name: "Close terminal" }).click();
    await expect(page.getByTestId("terminal-panel")).not.toBeVisible();
    await openTerminalPanel(page);

    await runInTerminal(page, "echo reopen_$((4+5))");
    await expect(terminalRows(page)).toContainText("reopen_9", { timeout: 10_000 });
  });

  test("terminal remains usable after a theme toggle", async ({ page }) => {
    test.setTimeout(60_000);
    await freshWorkspace(page, `TermUser-${Date.now()}`);
    await openTerminalPanel(page);
    await expect(page.locator(".xterm")).toBeVisible({ timeout: 10_000 });

    await runInTerminal(page, "echo before_$((4+4))");
    await expect(terminalRows(page)).toContainText("before_8", { timeout: 10_000 });

    // Toggle the app theme (must not dispose/recreate the terminal).
    await page.getByTestId("theme-toggle").click();

    await runInTerminal(page, "echo after_$((5+5))");
    await expect(terminalRows(page)).toContainText("after_10", { timeout: 10_000 });
  });

  // ── Roles ───────────────────────────────────────────────────────────────────

  test("editor: terminal auto-starts and is interactive (no viewer restriction)", async ({ browser }) => {
    test.setTimeout(120_000);

    const ownerCtx = await browser.newContext();
    const editorCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const editor = await editorCtx.newPage();

    try {
      await freshWorkspace(owner, `TermOwner-${Date.now()}`);
      const inviteLink = await getOwnerInviteLink(owner, "EDITOR");

      await freshWorkspace(editor, `TermEditor-${Date.now()}`);
      await acceptInvite(editor, inviteLink);

      await openTerminalPanel(editor);

      // No viewer restriction for an editor.
      await expect(
        editor.getByTestId("terminal-panel").getByText(/terminal requires editor access/i),
      ).not.toBeVisible();

      await expect(editor.locator(".xterm")).toBeVisible({ timeout: 10_000 });
      await runInTerminal(editor, "echo editor_$((7+8))");
      await expect(editor.locator(".xterm-rows")).toContainText("editor_15", { timeout: 10_000 });
    } finally {
      await ownerCtx.close();
      await editorCtx.close();
    }
  });

  test("viewer: sees the restriction message and cannot start/type into a shell", async ({ browser }) => {
    test.setTimeout(120_000);

    const ownerCtx = await browser.newContext();
    const viewerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const viewer = await viewerCtx.newPage();

    try {
      await freshWorkspace(owner, `TermOwner-${Date.now()}`);
      const inviteLink = await getOwnerInviteLink(owner, "VIEWER");

      await freshWorkspace(viewer, `TermViewer-${Date.now()}`);
      await acceptInvite(viewer, inviteLink);

      await openTerminalPanel(viewer);

      // The viewer sees the editor-access message and has no Start/Stop controls.
      await expect(
        viewer.getByTestId("terminal-panel").getByText(/terminal requires editor access/i),
      ).toBeVisible({ timeout: 5_000 });
      await expect(viewer.getByRole("button", { name: "Start terminal" })).not.toBeVisible();
      await expect(viewer.getByRole("button", { name: "Stop terminal" })).not.toBeVisible();

      // Typing never produces shell output (no session is created for viewers).
      await runInTerminal(viewer, "echo should_not_run_$((9+9))");
      await viewer.waitForTimeout(1_000);
      await expect(viewer.locator(".xterm-rows")).not.toContainText("should_not_run_18");
    } finally {
      await ownerCtx.close();
      await viewerCtx.close();
    }
  });

  // ── Workspace file integration ──────────────────────────────────────────────

  test("materializes a created file and runs it; re-runs updated content after a save", async ({ page }) => {
    test.setTimeout(90_000);
    await freshWorkspace(page, `TermOwner-${Date.now()}`);
    await createFileWithContent(page, "main.py", 'print("hello from Meridian")');

    await openTerminalPanel(page);
    await expect(page.locator(".xterm")).toBeVisible({ timeout: 10_000 });

    // The editor file is materialized into the sandbox: ls shows it, and it runs.
    await runInTerminal(page, "ls");
    await expect(terminalRows(page)).toContainText("main.py", { timeout: 10_000 });
    await runInTerminal(page, "python3 main.py");
    await expect(terminalRows(page)).toContainText("hello from Meridian", { timeout: 10_000 });

    // Edit + save, then re-run: the sandbox reflects the updated content.
    await page.locator(".monaco-editor .view-lines").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type('print("updated from Meridian")');
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 8_000 });

    await runInTerminal(page, "python3 main.py");
    await expect(terminalRows(page)).toContainText("updated from Meridian", { timeout: 10_000 });
  });

  test("runs a nested file from its correct sandbox path", async ({ page }) => {
    test.setTimeout(90_000);
    await freshWorkspace(page, `TermOwner-${Date.now()}`);
    await createFileWithContent(page, "pkg/nested.py", 'print("nested ok")');

    await openTerminalPanel(page);
    await expect(page.locator(".xterm")).toBeVisible({ timeout: 10_000 });

    await runInTerminal(page, "python3 pkg/nested.py");
    await expect(terminalRows(page)).toContainText("nested ok", { timeout: 10_000 });
  });

  test("Command Palette → Run Active File runs the current file", async ({ page }) => {
    test.setTimeout(90_000);
    await freshWorkspace(page, `TermOwner-${Date.now()}`);
    await createFileWithContent(page, "palette_run.py", 'print("palette run ok")');

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="command-palette-command"][data-command-id="run-active-file"]').click();

    await expect(page.getByTestId("terminal-panel")).toBeVisible({ timeout: 5_000 });
    await expect(terminalRows(page)).toContainText("palette run ok", { timeout: 15_000 });
  });

  test("Run Active File is disabled with a reason for an unsupported file type", async ({ page }) => {
    test.setTimeout(60_000);
    await freshWorkspace(page, `TermOwner-${Date.now()}`);
    await createFileWithContent(page, "notes.md", "# just markdown");

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 5_000 });
    const cmd = page.locator('[data-testid="command-palette-command"][data-command-id="run-active-file"]');
    await expect(cmd).toHaveAttribute("data-disabled", "true");
    await expect(cmd).toContainText("This file type is not executable");
  });

  test("terminal theme follows the app light/dark theme and stays usable", async ({ page }) => {
    test.setTimeout(60_000);
    await freshWorkspace(page, `TermUser-${Date.now()}`);
    await openTerminalPanel(page);
    await expect(page.locator(".xterm")).toBeVisible({ timeout: 10_000 });

    // Default dark theme → dark terminal background.
    await expect(page.getByTestId("terminal-panel")).toHaveCSS("background-color", "rgb(30, 30, 30)");

    // Toggle to light → light terminal background, live.
    await page.getByTestId("theme-toggle").click();
    await expect(page.getByTestId("terminal-panel")).toHaveCSS("background-color", "rgb(255, 255, 255)");

    // Still interactive after the theme change (session not destroyed).
    await runInTerminal(page, "echo theme_$((2+2))");
    await expect(terminalRows(page)).toContainText("theme_4", { timeout: 10_000 });
  });
});
