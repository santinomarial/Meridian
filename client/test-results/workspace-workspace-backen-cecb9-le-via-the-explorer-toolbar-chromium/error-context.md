# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> workspace (backend required) >> create a new file via the explorer toolbar
- Location: e2e/workspace.spec.ts:55:3

# Error details

```
TimeoutError: page.waitForURL: Timeout 20000ms exceeded.
=========================== logs ===========================
waiting for navigation to "/workspace" until "load"
============================================================
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e7]: polymer
      - generic [ref=e8]: Meridian
    - navigation "Site" [ref=e9]:
      - link "Docs" [ref=e10] [cursor=pointer]:
        - /url: "#"
      - link "Pricing" [ref=e11] [cursor=pointer]:
        - /url: "#"
      - link "Changelog" [ref=e12] [cursor=pointer]:
        - /url: "#"
    - button "Get Started" [ref=e13] [cursor=pointer]
  - main [ref=e14]:
    - generic [ref=e15]:
      - generic [ref=e16]:
        - generic [ref=e17]: Start Coding
        - heading "Create your workspace" [level=1] [ref=e18]
        - paragraph [ref=e19]: Sign up to join the collaborative IDE environment.
      - generic [ref=e20]:
        - generic [ref=e21]:
          - text: Full Name
          - generic [ref=e22]:
            - generic [ref=e23]: person
            - textbox "Full Name" [ref=e24]:
              - /placeholder: John Doe
              - text: Test User
        - generic [ref=e25]:
          - text: Email Address
          - generic [ref=e26]:
            - generic [ref=e27]: alternate_email
            - textbox "Email Address" [ref=e28]:
              - /placeholder: name@company.com
              - text: e2e-1781219172749-cnqx6@example.com
        - generic [ref=e29]:
          - text: Password
          - generic [ref=e30]:
            - generic [ref=e31]: lock
            - textbox "Password" [ref=e32]:
              - /placeholder: ••••••••
              - text: Test@1234!
          - list "Password requirements" [ref=e39]:
            - listitem [ref=e40]:
              - generic [ref=e41]: check_circle
              - text: At least 8 characters
            - listitem [ref=e42]:
              - generic [ref=e43]: check_circle
              - text: 1 uppercase letter
            - listitem [ref=e44]:
              - generic [ref=e45]: check_circle
              - text: 1 lowercase letter
            - listitem [ref=e46]:
              - generic [ref=e47]: check_circle
              - text: 1 number
            - listitem [ref=e48]:
              - generic [ref=e49]: check_circle
              - text: 1 special character
        - generic [ref=e50]:
          - text: Confirm Password
          - generic [ref=e51]:
            - generic [ref=e52]: lock
            - textbox "Confirm Password" [ref=e53]:
              - /placeholder: ••••••••
              - text: Test@1234!
        - alert [ref=e54]:
          - paragraph [ref=e55]: "ThrottlerException: Too Many Requests"
        - button "Create account arrow_forward" [ref=e56] [cursor=pointer]:
          - text: Create account
          - generic [ref=e57]: arrow_forward
      - generic [ref=e60]: OR
      - button "terminal Sign up with GitHub" [ref=e61] [cursor=pointer]:
        - generic [ref=e62]: terminal
        - text: Sign up with GitHub
      - generic [ref=e63]:
        - paragraph [ref=e64]:
          - text: Already have an account?
          - button "Log in" [ref=e65] [cursor=pointer]
        - paragraph [ref=e66]:
          - text: By creating an account, you agree to our
          - link "Terms of Service" [ref=e67] [cursor=pointer]:
            - /url: "#"
          - text: and
          - link "Privacy Policy" [ref=e68] [cursor=pointer]:
            - /url: "#"
          - text: .
  - contentinfo [ref=e69]:
    - generic [ref=e71]: © 2024 Meridian Systems Inc.
    - generic [ref=e72]:
      - link "Privacy Policy" [ref=e73] [cursor=pointer]:
        - /url: "#"
      - link "Terms of Service" [ref=e74] [cursor=pointer]:
        - /url: "#"
      - link "Status" [ref=e75] [cursor=pointer]:
        - /url: "#"
```

# Test source

```ts
  1   | /**
  2   |  * Workspace E2E tests.
  3   |  *
  4   |  * All tests require a running backend.  Run with:
  5   |  *   MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e
  6   |  *
  7   |  * When the backend is absent every test in this file is skipped gracefully.
  8   |  */
  9   | import { test, expect, type Page } from "@playwright/test";
  10  | import {
  11  |   isBackendAvailable,
  12  |   uniqueEmail,
  13  |   signUpViaUI,
  14  | } from "./helpers/auth.js";
  15  | 
  16  | const STRONG_PASSWORD = "Test@1234!";
  17  | 
  18  | // ── Shared setup ───────────────────────────────────────────────────────────────
  19  | 
  20  | /** Signs up a fresh user and waits for the workspace to load. */
  21  | async function freshWorkspace(page: Page): Promise<void> {
  22  |   await page.goto("/");
  23  |   await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
> 24  |   await page.waitForURL("/workspace", { timeout: 20_000 });
      |              ^ TimeoutError: page.waitForURL: Timeout 20000ms exceeded.
  25  |   // Wait for the file explorer to be present (workspace ready)
  26  |   await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  27  | }
  28  | 
  29  | test.describe("workspace (backend required)", () => {
  30  |   test.beforeEach(async () => {
  31  |     const available = await isBackendAvailable();
  32  |     if (!available) {
  33  |       test.skip(true, "Backend not available — skipping workspace tests");
  34  |     }
  35  |   });
  36  | 
  37  |   // ── Workspace loads ──────────────────────────────────────────────────────────
  38  | 
  39  |   test("workspace page opens after sign-up", async ({ page }) => {
  40  |     await freshWorkspace(page);
  41  |     await expect(page.getByTestId("workspace-root")).toBeVisible();
  42  |   });
  43  | 
  44  |   test("workspace auto-creates when user has no existing workspace", async ({ page }) => {
  45  |     // A brand-new account will trigger auto-create on the backend hook.
  46  |     await page.goto("/");
  47  |     await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
  48  |     await page.waitForURL("/workspace", { timeout: 20_000 });
  49  |     // The file explorer should be present — workspace was auto-created.
  50  |     await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  51  |   });
  52  | 
  53  |   // ── Create file ──────────────────────────────────────────────────────────────
  54  | 
  55  |   test("create a new file via the explorer toolbar", async ({ page }) => {
  56  |     await freshWorkspace(page);
  57  | 
  58  |     await page.getByTestId("new-file-button").click();
  59  |     const input = page.getByTestId("new-item-input");
  60  |     await expect(input).toBeVisible();
  61  |     await input.fill("e2e-test-file.ts");
  62  |     await input.press("Enter");
  63  | 
  64  |     // File should appear in the tree
  65  |     await expect(
  66  |       page.getByRole("treeitem", { name: "e2e-test-file.ts" }),
  67  |     ).toBeVisible({ timeout: 8_000 });
  68  |   });
  69  | 
  70  |   // ── Create folder ────────────────────────────────────────────────────────────
  71  | 
  72  |   test("create a new folder via the explorer toolbar", async ({ page }) => {
  73  |     await freshWorkspace(page);
  74  | 
  75  |     await page.getByTestId("new-folder-button").click();
  76  |     const input = page.getByTestId("new-item-input");
  77  |     await expect(input).toBeVisible();
  78  |     await input.fill("e2e-folder");
  79  |     await input.press("Enter");
  80  | 
  81  |     await expect(
  82  |       page.getByRole("treeitem", { name: "e2e-folder" }),
  83  |     ).toBeVisible({ timeout: 8_000 });
  84  |   });
  85  | 
  86  |   // ── Rename file ──────────────────────────────────────────────────────────────
  87  | 
  88  |   test("rename a file", async ({ page }) => {
  89  |     await freshWorkspace(page);
  90  | 
  91  |     // Create a file first
  92  |     await page.getByTestId("new-file-button").click();
  93  |     await page.getByTestId("new-item-input").fill("rename-me.ts");
  94  |     await page.getByTestId("new-item-input").press("Enter");
  95  |     await expect(page.getByRole("treeitem", { name: "rename-me.ts" })).toBeVisible({
  96  |       timeout: 8_000,
  97  |     });
  98  | 
  99  |     // Hover over the file to reveal the rename button
  100 |     const fileRow = page.getByRole("treeitem", { name: "rename-me.ts" });
  101 |     await fileRow.hover();
  102 |     await page.getByRole("button", { name: "Rename rename-me.ts" }).click();
  103 | 
  104 |     const renameInput = page.getByLabel("Rename file");
  105 |     await renameInput.selectText();
  106 |     await renameInput.fill("renamed.ts");
  107 |     await renameInput.press("Enter");
  108 | 
  109 |     await expect(page.getByRole("treeitem", { name: "renamed.ts" })).toBeVisible({
  110 |       timeout: 8_000,
  111 |     });
  112 |   });
  113 | 
  114 |   // ── Rename folder ────────────────────────────────────────────────────────────
  115 | 
  116 |   test("rename a folder", async ({ page }) => {
  117 |     await freshWorkspace(page);
  118 | 
  119 |     await page.getByTestId("new-folder-button").click();
  120 |     await page.getByTestId("new-item-input").fill("old-folder");
  121 |     await page.getByTestId("new-item-input").press("Enter");
  122 |     await expect(page.getByRole("treeitem", { name: "old-folder" })).toBeVisible({
  123 |       timeout: 8_000,
  124 |     });
```