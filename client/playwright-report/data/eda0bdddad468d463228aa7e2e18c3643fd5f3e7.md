# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: file-import.spec.ts >> file import (backend required) >> open file via the File menu also works
- Location: e2e/file-import.spec.ts:108:3

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'File' }) resolved to 5 elements:
    1) <button type="button" aria-haspopup="menu" aria-expanded="false" class="inline-flex h-8 items-center rounded-[4px] px-2.5 text-xs font-medium leading-none text-on-surface-variant transition-colors duration-100 ease-out hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 ">File</button> aka getByRole('button', { name: 'File', exact: true })
    2) <button type="button" title="New File" aria-label="New file" data-testid="new-file-button" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] transition-colors duration-100 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface">…</button> aka getByTestId('new-file-button')
    3) <button type="button" title="Open File" data-testid="open-file-button" aria-label="Open file from computer" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] transition-colors duration-100 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface">…</button> aka getByTestId('open-file-button')
    4) <input type="file" class="sr-only" data-testid="file-picker-input" accept=".ts,.tsx,.js,.jsx,.py,.java,.go,.rs,.cpp,.cc,.cxx,.c,.h,.html,.css,.scss,.json,.md,.yml,.yaml,.sql,.sh,.bash,.txt"/> aka getByTestId('file-picker-input')
    5) <input type="file" accept=".zip" class="sr-only" data-testid="zip-picker-input"/> aka getByTestId('zip-picker-input')

Call log:
  - waiting for getByRole('button', { name: 'File' })

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
      - button "Live session unavailable — backend offline" [ref=e37] [cursor=pointer]:
        - generic [ref=e38]: wifi_off
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
        - generic [ref=e54]: src
        - generic [ref=e55]: chevron_right
      - listitem [ref=e56]:
        - generic [ref=e57]: services
        - generic [ref=e58]: chevron_right
      - listitem [ref=e59]:
        - generic [ref=e60]: description
        - generic [ref=e61]: auth.ts
  - generic [ref=e62]:
    - navigation "Activity bar" [ref=e63]:
      - generic [ref=e64]:
        - button "Explorer" [pressed] [ref=e65] [cursor=pointer]:
          - generic [ref=e66]: folder_copy
        - button "Search" [ref=e67] [cursor=pointer]:
          - generic [ref=e68]: search
        - button "Source Control" [ref=e69] [cursor=pointer]:
          - generic [ref=e70]: account_tree
        - button "Run and Debug" [ref=e71] [cursor=pointer]:
          - generic [ref=e72]: play_arrow
        - button "Extensions" [ref=e73] [cursor=pointer]:
          - generic [ref=e74]: extension
      - generic [ref=e75]:
        - button "Account" [ref=e76] [cursor=pointer]:
          - generic [ref=e77]: account_circle
        - button "Settings" [ref=e78] [cursor=pointer]:
          - generic [ref=e79]: settings
    - complementary "Explorer" [ref=e80]:
      - generic [ref=e81]:
        - generic [ref=e82]: Explorer
        - generic [ref=e83]:
          - button "New file" [ref=e84] [cursor=pointer]:
            - generic [ref=e85]: note_add
          - button "New folder" [ref=e86] [cursor=pointer]:
            - generic [ref=e87]: create_new_folder
          - button "Open file from computer" [ref=e88] [cursor=pointer]:
            - generic [ref=e89]: upload_file
          - button "Import ZIP archive" [ref=e90] [cursor=pointer]:
            - generic [ref=e91]: folder_zip
      - button "Choose File" [ref=e92]
      - button "Choose File" [ref=e93]
      - tree "Workspace files" [ref=e94]:
        - generic "Loading panel" [ref=e95]
    - main [ref=e123]:
      - tablist "Open editors" [ref=e125]:
        - listitem [ref=e126]:
          - button "description auth.ts" [ref=e127] [cursor=pointer]:
            - generic [ref=e128]: description
            - generic [ref=e129]: auth.ts
          - button "Close auth.ts" [ref=e131] [cursor=pointer]:
            - generic [ref=e132]: close
        - listitem [ref=e133]:
          - button "description database.ts" [ref=e134] [cursor=pointer]:
            - generic [ref=e135]: description
            - generic [ref=e136]: database.ts
          - button "Close database.ts" [ref=e138] [cursor=pointer]:
            - generic [ref=e139]: close
      - generic "Loading editor" [ref=e143]
      - region "Bottom panel" [ref=e154]:
        - generic [ref=e155]:
          - tablist "Panel tabs" [ref=e156]:
            - tab "TERMINAL" [selected] [ref=e157] [cursor=pointer]
            - tab "OUTPUT" [ref=e158] [cursor=pointer]
            - tab "DEBUG CONSOLE" [ref=e159] [cursor=pointer]
            - tab "bolt AI ASSISTANT" [ref=e160] [cursor=pointer]:
              - generic [ref=e161]: bolt
              - text: AI ASSISTANT
          - generic [ref=e162]:
            - button "Add panel tab" [ref=e163] [cursor=pointer]:
              - generic [ref=e164]: add
            - button "Collapse panel" [ref=e165] [cursor=pointer]:
              - generic [ref=e166]: keyboard_arrow_up
            - button "Close panel" [ref=e167] [cursor=pointer]:
              - generic [ref=e168]: close
        - tabpanel [ref=e169]:
          - generic [ref=e170]:
            - paragraph [ref=e171]: meridian-app@0.1.0 start
            - paragraph [ref=e172]: $ npm run start:dev
            - paragraph [ref=e173]: "[10:42:01 AM] Starting compilation in watch mode..."
            - paragraph [ref=e174]: "[10:42:05 AM] Found 0 errors. Watching for file changes."
            - paragraph [ref=e175]: Ready on http://localhost:3000
          - complementary [ref=e177]:
            - generic [ref=e178]:
              - generic [ref=e179]: Meridian AI
              - generic [ref=e180]: v0.1
            - generic [ref=e181]:
              - paragraph [ref=e182]: Missing JWT verification step.
              - button "Insert" [ref=e183] [cursor=pointer]
            - paragraph [ref=e184]: ⌘I deep dive
    - complementary "Collaboration" [ref=e185]:
      - heading "Collaborators" [level=2] [ref=e189]
      - generic "Loading panel" [ref=e190]
      - generic [ref=e197]:
        - heading "Live Chat" [level=2] [ref=e199]
        - generic [ref=e201]:
          - generic [ref=e202]: chat_bubble_outline
          - paragraph [ref=e203]: No messages yet.
          - paragraph [ref=e204]: Start the conversation.
        - generic [ref=e205]:
          - textbox "Send a message…" [ref=e206]
          - button "Send message" [disabled] [ref=e207]:
            - generic [ref=e208]: send
      - generic [ref=e209]:
        - generic [ref=e210]:
          - heading "Review Notes" [level=2] [ref=e211]
          - generic [ref=e212]: "2"
        - list [ref=e213]:
          - listitem [ref=e214]:
            - paragraph [ref=e215]: Memory leak risk
            - paragraph [ref=e216]: "L128: Observable not unsubscribed."
          - listitem [ref=e217]:
            - paragraph [ref=e218]: Refactor request
            - paragraph [ref=e219]: Extract helper to shared service.
  - contentinfo "Status bar" [ref=e220]:
    - generic [ref=e221]:
      - generic [ref=e222]:
        - generic [ref=e223]: sync
        - generic [ref=e224]: main
      - generic [ref=e225]:
        - generic [ref=e226]: error_outline
        - generic [ref=e227]: "0"
        - generic [ref=e228]: warning_amber
        - generic [ref=e229]: "2"
    - generic [ref=e230]:
      - generic [ref=e231]: Ln 42, Col 12
      - generic [ref=e232]: "Spaces: 4"
      - generic [ref=e233]: UTF-8
      - generic [ref=e234]: TypeScript
      - generic [ref=e235]:
        - generic [ref=e236]: check_circle
        - text: Prettier
      - generic [ref=e237]: Saved
      - generic [ref=e238]: Meridian v0.1.0
```

# Test source

```ts
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
  60  |     ).toBeVisible({ timeout: 10_000 });
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
> 113 |     await page.getByRole("button", { name: "File" }).click();
      |                                                      ^ Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'File' }) resolved to 5 elements:
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