# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: file-import.spec.ts >> file import (backend required) >> open file via the File menu also works
- Location: e2e/file-import.spec.ts:105:3

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
  24  |   test.beforeEach(async () => {
  25  |     const available = await isBackendAvailable();
  26  |     if (!available) {
  27  |       test.skip(true, "Backend not available — skipping file import tests");
  28  |     }
  29  |   });
  30  | 
  31  |   // ── Open local file ──────────────────────────────────────────────────────────
  32  | 
  33  |   test("open a local .ts file via the file picker", async ({ page }) => {
  34  |     await freshWorkspace(page);
  35  | 
  36  |     // Create a temporary file on disk to pick — reuse the fixture.
  37  |     const localFile = path.join(FIXTURES, "test-project.zip");
  38  |     // Instead pick a real .ts text file we can construct inline via a
  39  |     // Playwright file-chooser.  We provide a Buffer as the file content.
  40  | 
  41  |     const [fileChooser] = await Promise.all([
  42  |       page.waitForEvent("filechooser"),
  43  |       // The hidden file input is triggered by clicking the Open file button.
  44  |       page.getByTestId("open-file-button").click(),
  45  |     ]);
  46  | 
  47  |     // Create a synthetic .ts file from a Buffer
  48  |     await fileChooser.setFiles({
  49  |       name: "opened-local.ts",
  50  |       mimeType: "text/plain",
  51  |       buffer: Buffer.from("const local = 'opened';\n"),
  52  |     });
  53  | 
  54  |     // File should appear in the explorer
  55  |     await expect(
  56  |       page.getByRole("treeitem", { name: "opened-local.ts" }),
  57  |     ).toBeVisible({ timeout: 10_000 });
  58  |   });
  59  | 
  60  |   // ── Import ZIP ───────────────────────────────────────────────────────────────
  61  | 
  62  |   test("import a ZIP archive — files appear in the explorer", async ({ page }) => {
  63  |     await freshWorkspace(page);
  64  | 
  65  |     const [fileChooser] = await Promise.all([
  66  |       page.waitForEvent("filechooser"),
  67  |       page.getByTestId("import-zip-button").click(),
  68  |     ]);
  69  | 
  70  |     await fileChooser.setFiles(path.join(FIXTURES, "test-project.zip"));
  71  | 
  72  |     // The fixture ZIP contains hello.ts
  73  |     await expect(
  74  |       page.getByRole("treeitem", { name: "hello.ts" }),
  75  |     ).toBeVisible({ timeout: 15_000 });
  76  |   });
  77  | 
  78  |   // ── Imported file is openable ────────────────────────────────────────────────
  79  | 
  80  |   test("imported file can be opened in the editor", async ({ page }) => {
  81  |     await freshWorkspace(page);
  82  | 
  83  |     const [fileChooser] = await Promise.all([
  84  |       page.waitForEvent("filechooser"),
  85  |       page.getByTestId("import-zip-button").click(),
  86  |     ]);
  87  |     await fileChooser.setFiles(path.join(FIXTURES, "test-project.zip"));
  88  | 
  89  |     const treeItem = page.getByRole("treeitem", { name: "hello.ts" });
  90  |     await expect(treeItem).toBeVisible({ timeout: 15_000 });
  91  |     await treeItem.click();
  92  | 
  93  |     await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
  94  |       timeout: 10_000,
  95  |     });
  96  |     // Editor should contain the file content from the fixture
  97  |     const editorLines = await page
  98  |       .locator(".monaco-editor .view-lines")
  99  |       .textContent();
  100 |     expect(editorLines).toContain("hello");
  101 |   });
  102 | 
  103 |   // ── Open local file via Header "File" menu ────────────────────────────────────
  104 | 
  105 |   test("open file via the File menu also works", async ({ page }) => {
  106 |     await freshWorkspace(page);
  107 | 
  108 |     // Use the File menu in the header instead of the explorer toolbar button.
  109 |     const [fileChooser] = await Promise.all([
  110 |       page.waitForEvent("filechooser"),
  111 |       (async () => {
> 112 |         await page.getByRole("button", { name: "File" }).click();
      |                                                          ^ Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'File' }) resolved to 5 elements:
  113 |         await page.getByRole("button", { name: "Open File..." }).click();
  114 |       })(),
  115 |     ]);
  116 | 
  117 |     await fileChooser.setFiles({
  118 |       name: "menu-opened.ts",
  119 |       mimeType: "text/plain",
  120 |       buffer: Buffer.from("const menu = true;\n"),
  121 |     });
  122 | 
  123 |     await expect(
  124 |       page.getByRole("treeitem", { name: "menu-opened.ts" }),
  125 |     ).toBeVisible({ timeout: 10_000 });
  126 |   });
  127 | 
  128 |   // ── TODO: import via Header File menu (ZIP) ───────────────────────────────────
  129 |   // TODO: add a test for "Import ZIP..." via the File menu once the header
  130 |   // zip input and explorer zip input share the same trigger path.
  131 | });
  132 | 
```