# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: file-import.spec.ts >> file import (backend required) >> open a local .ts file via the file picker
- Location: e2e/file-import.spec.ts:41:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('treeitem', { name: 'opened-local.ts' })
Expected: visible
Error: strict mode violation: getByRole('treeitem', { name: 'opened-local.ts' }) resolved to 2 elements:
    1) <button type="button" tabindex="-1" role="treeitem" aria-selected="false" data-tree-item-id="cmqa3w7tb000f9254r1xgfva6" class="flex w-full items-center gap-0.5 border-l-2 py-[3px] pr-2 text-left text-[13px] leading-snug transition-colors duration-100 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 pr-14 border-transparent text-on-surface-variant hover:bg-surface-container-high/80">…</button> aka getByRole('treeitem', { name: 'description opened-local.ts' }).first()
    2) <button type="button" tabindex="-1" role="treeitem" aria-selected="true" data-tree-item-id="local-cd9671b3-942c-4b60-9afd-3a1022c9ca2d" class="flex w-full items-center gap-0.5 border-l-2 py-[3px] pr-2 text-left text-[13px] leading-snug transition-colors duration-100 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 pr-14 border-primary bg-primary/10 font-medium text-on-surface">…</button> aka getByRole('treeitem', { name: 'description opened-local.ts' }).nth(1)

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('treeitem', { name: 'opened-local.ts' })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - button [ref=e5]
    - button [ref=e6]
    - generic [ref=e7]:
      - generic [ref=e8]:
        - img [ref=e10]
        - generic [ref=e12]: Meridian
      - navigation "Main menu" [ref=e14]:
        - button "File" [ref=e16] [cursor=pointer]
        - button "Edit" [ref=e18] [cursor=pointer]
        - button "Selection" [ref=e20] [cursor=pointer]
        - button "View" [ref=e22] [cursor=pointer]
        - button "Go" [ref=e24] [cursor=pointer]
    - generic [ref=e25]:
      - button "Branch selector" [ref=e27] [cursor=pointer]:
        - generic [ref=e28]: account_tree
        - generic [ref=e29]: "branch:"
        - generic [ref=e30]: main
        - generic [ref=e31]: expand_more
      - button "View collaborators (0)" [ref=e33] [cursor=pointer]:
        - generic "No collaborators" [ref=e35]:
          - generic [ref=e36]: person_add
      - button "Start live session" [ref=e37] [cursor=pointer]:
        - generic [ref=e38]: wifi
        - text: Live Session
      - button "Share workspace — invite collaborators" [ref=e40] [cursor=pointer]: Share
      - generic [ref=e41]:
        - button "Switch to light mode" [ref=e42] [cursor=pointer]:
          - generic [ref=e43]: light_mode
        - button "Notifications" [ref=e45] [cursor=pointer]:
          - generic [ref=e46]: notifications
        - button "Account menu" [ref=e48] [cursor=pointer]:
          - generic [ref=e49]: account_circle
  - navigation "File breadcrumb" [ref=e50]:
    - generic [ref=e51]: folder_open
    - list [ref=e52]:
      - listitem [ref=e53]:
        - generic [ref=e54]: description
        - generic [ref=e55]: opened-local.ts
  - generic [ref=e56]:
    - navigation "Activity bar" [ref=e57]:
      - generic [ref=e58]:
        - button "Explorer" [pressed] [ref=e59] [cursor=pointer]:
          - generic [ref=e60]: folder_copy
        - button "Search" [ref=e61] [cursor=pointer]:
          - generic [ref=e62]: search
        - button "Source Control" [ref=e63] [cursor=pointer]:
          - generic [ref=e64]: account_tree
        - button "Run and Debug" [ref=e65] [cursor=pointer]:
          - generic [ref=e66]: play_arrow
        - button "Extensions" [ref=e67] [cursor=pointer]:
          - generic [ref=e68]: extension
      - generic [ref=e69]:
        - button "Account" [ref=e70] [cursor=pointer]:
          - generic [ref=e71]: account_circle
        - button "Settings" [ref=e72] [cursor=pointer]:
          - generic [ref=e73]: settings
    - complementary "Explorer" [ref=e74]:
      - generic [ref=e75]:
        - generic [ref=e76]: Explorer
        - generic [ref=e77]:
          - button "New file" [ref=e78] [cursor=pointer]:
            - generic [ref=e79]: note_add
          - button "New folder" [ref=e80] [cursor=pointer]:
            - generic [ref=e81]: create_new_folder
          - button "Open file from computer" [active] [ref=e82] [cursor=pointer]:
            - generic [ref=e83]: upload_file
          - button "Import ZIP archive" [ref=e84] [cursor=pointer]:
            - generic [ref=e85]: folder_zip
      - button "Choose File" [ref=e86]
      - button "Choose File" [ref=e87]
      - tree "Workspace files" [ref=e88]:
        - treeitem "description edit-test.ts" [ref=e89] [cursor=pointer]:
          - generic [ref=e90]: description
          - generic [ref=e91]: edit-test.ts
        - generic [ref=e92]:
          - button "Rename edit-test.ts" [ref=e93] [cursor=pointer]:
            - generic [ref=e94]: edit
          - button "Delete edit-test.ts" [ref=e95] [cursor=pointer]:
            - generic [ref=e96]: delete
        - treeitem "code hello.cpp" [ref=e97] [cursor=pointer]:
          - generic [ref=e98]: code
          - generic [ref=e99]: hello.cpp
        - generic [ref=e100]:
          - button "Rename hello.cpp" [ref=e101] [cursor=pointer]:
            - generic [ref=e102]: edit
          - button "Delete hello.cpp" [ref=e103] [cursor=pointer]:
            - generic [ref=e104]: delete
        - treeitem "code_blocks hello.py" [ref=e105] [cursor=pointer]:
          - generic [ref=e106]: code_blocks
          - generic [ref=e107]: hello.py
        - generic [ref=e108]:
          - button "Rename hello.py" [ref=e109] [cursor=pointer]:
            - generic [ref=e110]: edit
          - button "Delete hello.py" [ref=e111] [cursor=pointer]:
            - generic [ref=e112]: delete
        - treeitem "expand_more folder new-folder" [expanded] [ref=e113] [cursor=pointer]:
          - generic [ref=e114]: expand_more
          - generic [ref=e115]: folder
          - generic [ref=e116]: new-folder
        - generic [ref=e117]:
          - button "Rename new-folder" [ref=e118] [cursor=pointer]:
            - generic [ref=e119]: edit
          - button "Delete new-folder" [ref=e120] [cursor=pointer]:
            - generic [ref=e121]: delete
        - treeitem "description opened-local.ts" [ref=e122] [cursor=pointer]:
          - generic [ref=e123]: description
          - generic [ref=e124]: opened-local.ts
        - generic [ref=e125]:
          - button "Rename opened-local.ts" [ref=e126] [cursor=pointer]:
            - generic [ref=e127]: edit
          - button "Delete opened-local.ts" [ref=e128] [cursor=pointer]:
            - generic [ref=e129]: delete
        - treeitem "description persist-test.ts" [ref=e130] [cursor=pointer]:
          - generic [ref=e131]: description
          - generic [ref=e132]: persist-test.ts
        - generic [ref=e133]:
          - button "Rename persist-test.ts" [ref=e134] [cursor=pointer]:
            - generic [ref=e135]: edit
          - button "Delete persist-test.ts" [ref=e136] [cursor=pointer]:
            - generic [ref=e137]: delete
        - treeitem "description save-test.ts" [ref=e138] [cursor=pointer]:
          - generic [ref=e139]: description
          - generic [ref=e140]: save-test.ts
        - generic [ref=e141]:
          - button "Rename save-test.ts" [ref=e142] [cursor=pointer]:
            - generic [ref=e143]: edit
          - button "Delete save-test.ts" [ref=e144] [cursor=pointer]:
            - generic [ref=e145]: delete
        - treeitem "description opened-local.ts" [selected] [ref=e146] [cursor=pointer]:
          - generic [ref=e147]: description
          - generic [ref=e148]: opened-local.ts
        - generic [ref=e149]:
          - button "Rename opened-local.ts" [ref=e150] [cursor=pointer]:
            - generic [ref=e151]: edit
          - button "Delete opened-local.ts" [ref=e152] [cursor=pointer]:
            - generic [ref=e153]: delete
    - main [ref=e154]:
      - tablist "Open editors" [ref=e156]:
        - listitem [ref=e157]:
          - button "description edit-test.ts" [ref=e158] [cursor=pointer]:
            - generic [ref=e159]: description
            - generic [ref=e160]: edit-test.ts
          - button "Close edit-test.ts" [ref=e162] [cursor=pointer]:
            - generic [ref=e163]: close
        - listitem [ref=e164]:
          - button "description opened-local.ts" [ref=e165] [cursor=pointer]:
            - generic [ref=e166]: description
            - generic [ref=e167]: opened-local.ts
      - generic "Loading editor" [ref=e173]
      - region "Bottom panel" [ref=e184]:
        - generic [ref=e185]:
          - tablist "Panel tabs" [ref=e186]:
            - tab "TERMINAL" [selected] [ref=e187] [cursor=pointer]
            - tab "OUTPUT" [ref=e188] [cursor=pointer]
            - tab "DEBUG CONSOLE" [ref=e189] [cursor=pointer]
            - tab "bolt AI ASSISTANT" [ref=e190] [cursor=pointer]:
              - generic [ref=e191]: bolt
              - text: AI ASSISTANT
          - generic [ref=e192]:
            - button "Add panel tab" [ref=e193] [cursor=pointer]:
              - generic [ref=e194]: add
            - button "Collapse panel" [ref=e195] [cursor=pointer]:
              - generic [ref=e196]: keyboard_arrow_up
            - button "Close panel" [ref=e197] [cursor=pointer]:
              - generic [ref=e198]: close
        - tabpanel [ref=e199]:
          - generic [ref=e200]:
            - paragraph [ref=e201]: meridian-app@0.1.0 start
            - paragraph [ref=e202]: $ npm run start:dev
            - paragraph [ref=e203]: "[10:42:01 AM] Starting compilation in watch mode..."
            - paragraph [ref=e204]: "[10:42:05 AM] Found 0 errors. Watching for file changes."
            - paragraph [ref=e205]: Ready on http://localhost:3000
          - complementary [ref=e207]:
            - generic [ref=e208]:
              - generic [ref=e209]: Meridian AI
              - generic [ref=e210]: v0.1
            - generic [ref=e211]:
              - paragraph [ref=e212]: Missing JWT verification step.
              - button "Insert" [ref=e213] [cursor=pointer]
            - paragraph [ref=e214]: ⌘I deep dive
    - complementary "Collaboration" [ref=e215]:
      - heading "Collaborators" [level=2] [ref=e219]
      - generic [ref=e220]:
        - generic [ref=e221]: group_add
        - paragraph [ref=e222]: No collaborators yet.
        - paragraph [ref=e223]:
          - text: Use
          - strong [ref=e224]: Share
          - text: to invite someone.
      - generic [ref=e225]:
        - heading "Live Chat" [level=2] [ref=e227]
        - generic [ref=e229]:
          - generic [ref=e230]: chat_bubble_outline
          - paragraph [ref=e231]: No messages yet.
          - paragraph [ref=e232]: Start the conversation.
        - generic [ref=e233]:
          - textbox "Send a message…" [ref=e234]
          - button "Send message" [disabled] [ref=e235]:
            - generic [ref=e236]: send
      - generic [ref=e237]:
        - generic [ref=e238]:
          - heading "Review Notes" [level=2] [ref=e239]
          - generic [ref=e240]: "2"
        - list [ref=e241]:
          - listitem [ref=e242]:
            - paragraph [ref=e243]: Memory leak risk
            - paragraph [ref=e244]: "L128: Observable not unsubscribed."
          - listitem [ref=e245]:
            - paragraph [ref=e246]: Refactor request
            - paragraph [ref=e247]: Extract helper to shared service.
  - contentinfo "Status bar" [ref=e248]:
    - generic [ref=e249]:
      - generic [ref=e250]:
        - generic [ref=e251]: sync
        - generic [ref=e252]: main
      - generic [ref=e253]:
        - generic [ref=e254]: error_outline
        - generic [ref=e255]: "0"
        - generic [ref=e256]: warning_amber
        - generic [ref=e257]: "2"
    - generic [ref=e258]:
      - generic [ref=e259]: Ln 42, Col 12
      - generic [ref=e260]: "Spaces: 4"
      - generic [ref=e261]: UTF-8
      - generic [ref=e262]: TypeScript
      - generic [ref=e263]:
        - generic [ref=e264]: check_circle
        - text: Prettier
      - generic [ref=e265]: Unsaved
      - generic [ref=e266]: Meridian v0.1.0
```

# Test source

```ts
  1   | /**
  2   |  * File import E2E tests — local file open and ZIP import.
  3   |  *
  4   |  * Requires a running backend.  The test ZIP fixture is generated in
  5   |  * e2e/global-setup.ts and written to e2e/fixtures/test-project.zip.
  6   |  */
  7   | import * as path from "path";
  8   | import { fileURLToPath } from "url";
  9   | import { test, expect, type Page } from "@playwright/test";
  10  | import { isBackendAvailable, uniqueEmail, signUpViaUI } from "./helpers/auth.js";
  11  | 
  12  | const __dirname = path.dirname(fileURLToPath(import.meta.url));
  13  | const FIXTURES = path.join(__dirname, "fixtures");
  14  | const STRONG_PASSWORD = "Test@1234!";
  15  | 
  16  | async function freshWorkspace(page: Page): Promise<void> {
  17  |   await page.goto("/");
  18  |   await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
  19  |   await page.waitForURL("/workspace", { timeout: 20_000 });
  20  |   await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  21  | }
  22  | 
  23  | test.describe("file import (backend required)", () => {
  24  |   // Check backend availability once to avoid per-test GET /auth/me calls.
  25  |   let backendAvailable = false;
  26  | 
  27  |   test.beforeAll(async () => {
  28  |     backendAvailable = await isBackendAvailable();
  29  |     if (!backendAvailable) {
  30  |       // eslint-disable-next-line no-console
  31  |       console.log("⚠  Backend not available — skipping file import tests.");
  32  |     }
  33  |   });
  34  | 
  35  |   test.beforeEach(() => {
  36  |     test.skip(!backendAvailable, "Backend not available — skipping file import tests");
  37  |   });
  38  | 
  39  |   // ── Open local file ──────────────────────────────────────────────────────────
  40  | 
  41  |   test("open a local .ts file via the file picker", async ({ page }) => {
  42  |     await freshWorkspace(page);
  43  | 
  44  |     const [fileChooser] = await Promise.all([
  45  |       page.waitForEvent("filechooser"),
  46  |       // The hidden file input is triggered by clicking the Open file button.
  47  |       page.getByTestId("open-file-button").click(),
  48  |     ]);
  49  | 
  50  |     // Create a synthetic .ts file from a Buffer
  51  |     await fileChooser.setFiles({
  52  |       name: "opened-local.ts",
  53  |       mimeType: "text/plain",
  54  |       buffer: Buffer.from("const local = 'opened';\n"),
  55  |     });
  56  | 
  57  |     // File should appear in the explorer
  58  |     await expect(
  59  |       page.getByRole("treeitem", { name: "opened-local.ts" }),
> 60  |     ).toBeVisible({ timeout: 10_000 });
      |       ^ Error: expect(locator).toBeVisible() failed
  61  |   });
  62  | 
  63  |   // ── Import ZIP ───────────────────────────────────────────────────────────────
  64  | 
  65  |   test("import a ZIP archive — files appear in the explorer", async ({ page }) => {
  66  |     await freshWorkspace(page);
  67  | 
  68  |     const [fileChooser] = await Promise.all([
  69  |       page.waitForEvent("filechooser"),
  70  |       page.getByTestId("import-zip-button").click(),
  71  |     ]);
  72  | 
  73  |     await fileChooser.setFiles(path.join(FIXTURES, "test-project.zip"));
  74  | 
  75  |     // The fixture ZIP contains hello.ts
  76  |     await expect(
  77  |       page.getByRole("treeitem", { name: "hello.ts" }),
  78  |     ).toBeVisible({ timeout: 15_000 });
  79  |   });
  80  | 
  81  |   // ── Imported file is openable ────────────────────────────────────────────────
  82  | 
  83  |   test("imported file can be opened in the editor", async ({ page }) => {
  84  |     await freshWorkspace(page);
  85  | 
  86  |     const [fileChooser] = await Promise.all([
  87  |       page.waitForEvent("filechooser"),
  88  |       page.getByTestId("import-zip-button").click(),
  89  |     ]);
  90  |     await fileChooser.setFiles(path.join(FIXTURES, "test-project.zip"));
  91  | 
  92  |     const treeItem = page.getByRole("treeitem", { name: "hello.ts" });
  93  |     await expect(treeItem).toBeVisible({ timeout: 15_000 });
  94  |     await treeItem.click();
  95  | 
  96  |     await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
  97  |       timeout: 10_000,
  98  |     });
  99  |     // Editor should contain the file content from the fixture
  100 |     const editorLines = await page
  101 |       .locator(".monaco-editor .view-lines")
  102 |       .textContent();
  103 |     expect(editorLines).toContain("hello");
  104 |   });
  105 | 
  106 |   // ── Open local file via Header "File" menu ────────────────────────────────────
  107 | 
  108 |   test("open file via the File menu also works", async ({ page }) => {
  109 |     await freshWorkspace(page);
  110 | 
  111 |     // Open the File menu first (separate await so the dropdown is visible
  112 |     // before we register the filechooser listener).
  113 |     await page.getByRole("button", { name: "File" }).click();
  114 | 
  115 |     // Now race the filechooser event against clicking "Open File..." in the
  116 |     // dropdown.  The handler calls fileInputRef.current?.click() which
  117 |     // Playwright intercepts as a filechooser event.
  118 |     const [fileChooser] = await Promise.all([
  119 |       page.waitForEvent("filechooser"),
  120 |       page.getByRole("button", { name: "Open File..." }).click(),
  121 |     ]);
  122 | 
  123 |     await fileChooser.setFiles({
  124 |       name: "menu-opened.ts",
  125 |       mimeType: "text/plain",
  126 |       buffer: Buffer.from("const menu = true;\n"),
  127 |     });
  128 | 
  129 |     await expect(
  130 |       page.getByRole("treeitem", { name: "menu-opened.ts" }),
  131 |     ).toBeVisible({ timeout: 10_000 });
  132 |   });
  133 | 
  134 |   // ── TODO: import via Header File menu (ZIP) ───────────────────────────────────
  135 |   // TODO: add a test for "Import ZIP..." via the File menu once the header
  136 |   // zip input and explorer zip input share the same trigger path.
  137 | });
  138 | 
```