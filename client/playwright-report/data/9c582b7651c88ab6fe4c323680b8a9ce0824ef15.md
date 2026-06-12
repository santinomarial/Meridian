# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> workspace (backend required) >> rename a folder
- Location: e2e/workspace.spec.ts:136:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('treeitem', { name: 'new-folder' })
Expected: visible
Error: strict mode violation: getByRole('treeitem', { name: 'new-folder' }) resolved to 2 elements:
    1) <button type="button" tabindex="-1" role="treeitem" aria-expanded="true" data-tree-item-id="cmqa3xxy600129254wwjkgh4f" class="flex w-full items-center gap-0.5 border-l-2 py-[3px] pr-2 text-left text-[13px] leading-snug transition-colors duration-100 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 border-transparent text-on-surface-variant hover:bg-surface-container-high/80 pr-14">…</button> aka getByRole('treeitem', { name: 'expand_more folder new-folder' }).first()
    2) <button type="button" tabindex="-1" role="treeitem" aria-expanded="true" data-tree-item-id="cmqa4qrbl001furpr8dyklbml" class="flex w-full items-center gap-0.5 border-l-2 py-[3px] pr-2 text-left text-[13px] leading-snug transition-colors duration-100 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 border-transparent text-on-surface-variant hover:bg-surface-container-high/80 pr-14">…</button> aka getByRole('treeitem', { name: 'expand_more folder new-folder' }).nth(1)

Call log:
  - Expect "toBeVisible" with timeout 8000ms
  - waiting for getByRole('treeitem', { name: 'new-folder' })

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
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
          - generic [ref=e55]: e2e-test-file.ts
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
            - button "Open file from computer" [ref=e82] [cursor=pointer]:
              - generic [ref=e83]: upload_file
            - button "Import ZIP archive" [ref=e84] [cursor=pointer]:
              - generic [ref=e85]: folder_zip
        - button "Choose File" [ref=e86]
        - button "Choose File" [ref=e87]
        - tree "Workspace files" [ref=e88]:
          - treeitem "expand_more folder e2e-folder" [expanded] [ref=e89] [cursor=pointer]:
            - generic [ref=e90]: expand_more
            - generic [ref=e91]: folder
            - generic [ref=e92]: e2e-folder
          - generic [ref=e93]:
            - button "Rename e2e-folder" [ref=e94] [cursor=pointer]:
              - generic [ref=e95]: edit
            - button "Delete e2e-folder" [ref=e96] [cursor=pointer]:
              - generic [ref=e97]: delete
          - treeitem "description e2e-test-file.ts" [selected] [ref=e98] [cursor=pointer]:
            - generic [ref=e99]: description
            - generic [ref=e100]: e2e-test-file.ts
          - generic [ref=e101]:
            - button "Rename e2e-test-file.ts" [ref=e102] [cursor=pointer]:
              - generic [ref=e103]: edit
            - button "Delete e2e-test-file.ts" [ref=e104] [cursor=pointer]:
              - generic [ref=e105]: delete
          - treeitem "description edit-test.ts" [ref=e106] [cursor=pointer]:
            - generic [ref=e107]: description
            - generic [ref=e108]: edit-test.ts
          - generic [ref=e109]:
            - button "Rename edit-test.ts" [ref=e110] [cursor=pointer]:
              - generic [ref=e111]: edit
            - button "Delete edit-test.ts" [ref=e112] [cursor=pointer]:
              - generic [ref=e113]: delete
          - treeitem "code hello.cpp" [ref=e114] [cursor=pointer]:
            - generic [ref=e115]: code
            - generic [ref=e116]: hello.cpp
          - generic [ref=e117]:
            - button "Rename hello.cpp" [ref=e118] [cursor=pointer]:
              - generic [ref=e119]: edit
            - button "Delete hello.cpp" [ref=e120] [cursor=pointer]:
              - generic [ref=e121]: delete
          - treeitem "code_blocks hello.py" [ref=e122] [cursor=pointer]:
            - generic [ref=e123]: code_blocks
            - generic [ref=e124]: hello.py
          - generic [ref=e125]:
            - button "Rename hello.py" [ref=e126] [cursor=pointer]:
              - generic [ref=e127]: edit
            - button "Delete hello.py" [ref=e128] [cursor=pointer]:
              - generic [ref=e129]: delete
          - treeitem "expand_more folder new-folder" [expanded] [ref=e130] [cursor=pointer]:
            - generic [ref=e131]: expand_more
            - generic [ref=e132]: folder
            - generic [ref=e133]: new-folder
          - generic [ref=e134]:
            - button "Rename new-folder" [ref=e135] [cursor=pointer]:
              - generic [ref=e136]: edit
            - button "Delete new-folder" [ref=e137] [cursor=pointer]:
              - generic [ref=e138]: delete
          - treeitem "description opened-local.ts" [ref=e139] [cursor=pointer]:
            - generic [ref=e140]: description
            - generic [ref=e141]: opened-local.ts
          - generic [ref=e142]:
            - button "Rename opened-local.ts" [ref=e143] [cursor=pointer]:
              - generic [ref=e144]: edit
            - button "Delete opened-local.ts" [ref=e145] [cursor=pointer]:
              - generic [ref=e146]: delete
          - treeitem "description persist-test.ts" [ref=e147] [cursor=pointer]:
            - generic [ref=e148]: description
            - generic [ref=e149]: persist-test.ts
          - generic [ref=e150]:
            - button "Rename persist-test.ts" [ref=e151] [cursor=pointer]:
              - generic [ref=e152]: edit
            - button "Delete persist-test.ts" [ref=e153] [cursor=pointer]:
              - generic [ref=e154]: delete
          - treeitem "description renamed.ts" [ref=e155] [cursor=pointer]:
            - generic [ref=e156]: description
            - generic [ref=e157]: renamed.ts
          - generic [ref=e158]:
            - button "Rename renamed.ts" [ref=e159] [cursor=pointer]:
              - generic [ref=e160]: edit
            - button "Delete renamed.ts" [ref=e161] [cursor=pointer]:
              - generic [ref=e162]: delete
          - treeitem "description save-test.ts" [ref=e163] [cursor=pointer]:
            - generic [ref=e164]: description
            - generic [ref=e165]: save-test.ts
          - generic [ref=e166]:
            - button "Rename save-test.ts" [ref=e167] [cursor=pointer]:
              - generic [ref=e168]: edit
            - button "Delete save-test.ts" [ref=e169] [cursor=pointer]:
              - generic [ref=e170]: delete
          - treeitem "expand_more folder new-folder" [expanded] [ref=e171] [cursor=pointer]:
            - generic [ref=e172]: expand_more
            - generic [ref=e173]: folder
            - generic [ref=e174]: new-folder
          - generic [ref=e175]:
            - button "Rename new-folder" [ref=e176] [cursor=pointer]:
              - generic [ref=e177]: edit
            - button "Delete new-folder" [ref=e178] [cursor=pointer]:
              - generic [ref=e179]: delete
        - generic [ref=e180]:
          - generic [ref=e181]: error_outline
          - generic [ref=e182]: Renamed locally. Could not sync rename to backend.
          - button "Dismiss error" [ref=e183] [cursor=pointer]:
            - generic [ref=e184]: close
      - main [ref=e185]:
        - tablist "Open editors" [ref=e187]:
          - listitem [ref=e188]:
            - button "description e2e-test-file.ts" [ref=e189] [cursor=pointer]:
              - generic [ref=e190]: description
              - generic [ref=e191]: e2e-test-file.ts
            - button "Close e2e-test-file.ts" [ref=e193] [cursor=pointer]:
              - generic [ref=e194]: close
        - code [ref=e198]:
          - generic [ref=e199]:
            - textbox "Editor content"
            - textbox [ref=e200]
            - generic [ref=e202]:
              - generic [ref=e205]: "1"
              - generic [ref=e207]: "2"
              - generic [ref=e209]: "3"
              - generic [ref=e211]: "4"
            - generic [ref=e219]:
              - generic [ref=e221]: "export function E2e_test_file(): void {"
              - generic [ref=e225]: "}"
        - region "Bottom panel" [ref=e227]:
          - generic [ref=e228]:
            - tablist "Panel tabs" [ref=e229]:
              - tab "TERMINAL" [selected] [ref=e230] [cursor=pointer]
              - tab "OUTPUT" [ref=e231] [cursor=pointer]
              - tab "DEBUG CONSOLE" [ref=e232] [cursor=pointer]
              - tab "bolt AI ASSISTANT" [ref=e233] [cursor=pointer]:
                - generic [ref=e234]: bolt
                - text: AI ASSISTANT
            - generic [ref=e235]:
              - button "Add panel tab" [ref=e236] [cursor=pointer]:
                - generic [ref=e237]: add
              - button "Collapse panel" [ref=e238] [cursor=pointer]:
                - generic [ref=e239]: keyboard_arrow_up
              - button "Close panel" [ref=e240] [cursor=pointer]:
                - generic [ref=e241]: close
          - tabpanel [ref=e242]:
            - generic [ref=e243]:
              - paragraph [ref=e244]: meridian-app@0.1.0 start
              - paragraph [ref=e245]: $ npm run start:dev
              - paragraph [ref=e246]: "[10:42:01 AM] Starting compilation in watch mode..."
              - paragraph [ref=e247]: "[10:42:05 AM] Found 0 errors. Watching for file changes."
              - paragraph [ref=e248]: Ready on http://localhost:3000
            - complementary [ref=e250]:
              - generic [ref=e251]:
                - generic [ref=e252]: Meridian AI
                - generic [ref=e253]: v0.1
              - generic [ref=e254]:
                - paragraph [ref=e255]: Missing JWT verification step.
                - button "Insert" [ref=e256] [cursor=pointer]
              - paragraph [ref=e257]: ⌘I deep dive
      - complementary "Collaboration" [ref=e258]:
        - heading "Collaborators" [level=2] [ref=e262]
        - generic [ref=e263]:
          - generic [ref=e264]: group_add
          - paragraph [ref=e265]: No collaborators yet.
          - paragraph [ref=e266]:
            - text: Use
            - strong [ref=e267]: Share
            - text: to invite someone.
        - generic [ref=e268]:
          - heading "Live Chat" [level=2] [ref=e270]
          - generic [ref=e272]:
            - generic [ref=e273]: chat_bubble_outline
            - paragraph [ref=e274]: No messages yet.
            - paragraph [ref=e275]: Start the conversation.
          - generic [ref=e276]:
            - textbox "Send a message…" [ref=e277]
            - button "Send message" [disabled] [ref=e278]:
              - generic [ref=e279]: send
        - generic [ref=e280]:
          - generic [ref=e281]:
            - heading "Review Notes" [level=2] [ref=e282]
            - generic [ref=e283]: "2"
          - list [ref=e284]:
            - listitem [ref=e285]:
              - paragraph [ref=e286]: Memory leak risk
              - paragraph [ref=e287]: "L128: Observable not unsubscribed."
            - listitem [ref=e288]:
              - paragraph [ref=e289]: Refactor request
              - paragraph [ref=e290]: Extract helper to shared service.
    - contentinfo "Status bar" [ref=e291]:
      - generic [ref=e292]:
        - generic [ref=e293]:
          - generic [ref=e294]: sync
          - generic [ref=e295]: main
        - generic [ref=e296]:
          - generic [ref=e297]: error_outline
          - generic [ref=e298]: "0"
          - generic [ref=e299]: warning_amber
          - generic [ref=e300]: "2"
      - generic [ref=e301]:
        - generic [ref=e302]: Ln 1, Col 1
        - generic [ref=e303]: "Spaces: 4"
        - generic [ref=e304]: UTF-8
        - generic [ref=e305]: TypeScript
        - generic [ref=e306]:
          - generic [ref=e307]: check_circle
          - text: Prettier
        - generic [ref=e308]: Saved
        - generic [ref=e309]: Meridian v0.1.0
  - generic [ref=e310]:
    - alert
    - alert
```

# Test source

```ts
  55  |   });
  56  | 
  57  |   // ── Workspace loads ──────────────────────────────────────────────────────────
  58  | 
  59  |   test("workspace page opens after sign-up", async ({ page }) => {
  60  |     await freshWorkspace(page);
  61  |     await expect(page.getByTestId("workspace-root")).toBeVisible();
  62  |   });
  63  | 
  64  |   test("workspace auto-creates when user has no existing workspace", async ({ page }) => {
  65  |     // A brand-new account will trigger auto-create on the backend hook.
  66  |     await page.goto("/");
  67  |     await signUpViaUI(page, uniqueEmail(), STRONG_PASSWORD);
  68  |     await page.waitForURL("/workspace", { timeout: 20_000 });
  69  |     // The file explorer should be present — workspace was auto-created.
  70  |     await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  71  |   });
  72  | 
  73  |   // ── Create file ──────────────────────────────────────────────────────────────
  74  | 
  75  |   test("create a new file via the explorer toolbar", async ({ page }) => {
  76  |     await freshWorkspace(page);
  77  | 
  78  |     await page.getByTestId("new-file-button").click();
  79  |     const input = page.getByTestId("new-item-input");
  80  |     await expect(input).toBeVisible();
  81  |     await input.fill("e2e-test-file.ts");
  82  |     await input.press("Enter");
  83  | 
  84  |     // File should appear in the tree
  85  |     await expect(
  86  |       page.getByRole("treeitem", { name: "e2e-test-file.ts" }),
  87  |     ).toBeVisible({ timeout: 8_000 });
  88  |   });
  89  | 
  90  |   // ── Create folder ────────────────────────────────────────────────────────────
  91  | 
  92  |   test("create a new folder via the explorer toolbar", async ({ page }) => {
  93  |     await freshWorkspace(page);
  94  | 
  95  |     await page.getByTestId("new-folder-button").click();
  96  |     const input = page.getByTestId("new-item-input");
  97  |     await expect(input).toBeVisible();
  98  |     await input.fill("e2e-folder");
  99  |     await input.press("Enter");
  100 | 
  101 |     await expect(
  102 |       page.getByRole("treeitem", { name: "e2e-folder" }),
  103 |     ).toBeVisible({ timeout: 8_000 });
  104 |   });
  105 | 
  106 |   // ── Rename file ──────────────────────────────────────────────────────────────
  107 | 
  108 |   test("rename a file", async ({ page }) => {
  109 |     await freshWorkspace(page);
  110 | 
  111 |     // Create a file first
  112 |     await page.getByTestId("new-file-button").click();
  113 |     await page.getByTestId("new-item-input").fill("rename-me.ts");
  114 |     await page.getByTestId("new-item-input").press("Enter");
  115 |     await expect(page.getByRole("treeitem", { name: "rename-me.ts" })).toBeVisible({
  116 |       timeout: 8_000,
  117 |     });
  118 | 
  119 |     // Hover over the file to reveal the rename button
  120 |     const fileRow = page.getByRole("treeitem", { name: "rename-me.ts" });
  121 |     await fileRow.hover();
  122 |     await page.getByRole("button", { name: "Rename rename-me.ts" }).click();
  123 | 
  124 |     const renameInput = page.getByLabel("Rename file");
  125 |     await renameInput.selectText();
  126 |     await renameInput.fill("renamed.ts");
  127 |     await renameInput.press("Enter");
  128 | 
  129 |     await expect(page.getByRole("treeitem", { name: "renamed.ts" })).toBeVisible({
  130 |       timeout: 8_000,
  131 |     });
  132 |   });
  133 | 
  134 |   // ── Rename folder ────────────────────────────────────────────────────────────
  135 | 
  136 |   test("rename a folder", async ({ page }) => {
  137 |     await freshWorkspace(page);
  138 | 
  139 |     await page.getByTestId("new-folder-button").click();
  140 |     await page.getByTestId("new-item-input").fill("old-folder");
  141 |     await page.getByTestId("new-item-input").press("Enter");
  142 |     await expect(page.getByRole("treeitem", { name: "old-folder" })).toBeVisible({
  143 |       timeout: 8_000,
  144 |     });
  145 | 
  146 |     const folderRow = page.getByRole("treeitem", { name: "old-folder" });
  147 |     await folderRow.hover();
  148 |     await page.getByRole("button", { name: "Rename old-folder" }).click();
  149 | 
  150 |     const renameInput = page.getByLabel("Rename folder");
  151 |     await renameInput.selectText();
  152 |     await renameInput.fill("new-folder");
  153 |     await renameInput.press("Enter");
  154 | 
> 155 |     await expect(page.getByRole("treeitem", { name: "new-folder" })).toBeVisible({
      |                                                                      ^ Error: expect(locator).toBeVisible() failed
  156 |       timeout: 8_000,
  157 |     });
  158 |   });
  159 | 
  160 |   // ── Delete file ──────────────────────────────────────────────────────────────
  161 | 
  162 |   test("delete a file", async ({ page }) => {
  163 |     await freshWorkspace(page);
  164 | 
  165 |     await page.getByTestId("new-file-button").click();
  166 |     await page.getByTestId("new-item-input").fill("delete-me.ts");
  167 |     await page.getByTestId("new-item-input").press("Enter");
  168 |     await expect(page.getByRole("treeitem", { name: "delete-me.ts" })).toBeVisible({
  169 |       timeout: 8_000,
  170 |     });
  171 | 
  172 |     const fileRow = page.getByRole("treeitem", { name: "delete-me.ts" });
  173 |     await fileRow.hover();
  174 | 
  175 |     // Accept the window.confirm dialog
  176 |     page.once("dialog", (dialog) => dialog.accept());
  177 |     await page.getByRole("button", { name: "Delete delete-me.ts" }).click();
  178 | 
  179 |     await expect(page.getByRole("treeitem", { name: "delete-me.ts" })).toBeHidden({
  180 |       timeout: 8_000,
  181 |     });
  182 |   });
  183 | 
  184 |   // ── Edit file in Monaco ──────────────────────────────────────────────────────
  185 | 
  186 |   test("edit file content in Monaco editor", async ({ page }) => {
  187 |     await freshWorkspace(page);
  188 | 
  189 |     // Create + open a file
  190 |     await page.getByTestId("new-file-button").click();
  191 |     await page.getByTestId("new-item-input").fill("edit-test.ts");
  192 |     await page.getByTestId("new-item-input").press("Enter");
  193 |     await page.getByRole("treeitem", { name: "edit-test.ts" }).click();
  194 | 
  195 |     // Wait for Monaco to mount
  196 |     await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
  197 |       timeout: 10_000,
  198 |     });
  199 | 
  200 |     // Monaco exposes a hidden textarea for keyboard input.
  201 |     // Select all existing content and replace it.
  202 |     const textarea = page.locator(".monaco-editor textarea").first();
  203 |     await textarea.press("Control+a");
  204 |     await textarea.pressSequentially("const e2e = true;");
  205 | 
  206 |     // Verify save-status shows "Unsaved".
  207 |     await expect(page.getByTestId("save-status")).toContainText("Unsaved", {
  208 |       timeout: 5_000,
  209 |     });
  210 |   });
  211 | 
  212 |   // ── Save with Cmd+S ──────────────────────────────────────────────────────────
  213 | 
  214 |   test("Cmd+S saves the active file and clears dirty state", async ({ page }) => {
  215 |     await freshWorkspace(page);
  216 | 
  217 |     await page.getByTestId("new-file-button").click();
  218 |     await page.getByTestId("new-item-input").fill("save-test.ts");
  219 |     await page.getByTestId("new-item-input").press("Enter");
  220 |     await page.getByRole("treeitem", { name: "save-test.ts" }).click();
  221 | 
  222 |     await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
  223 |       timeout: 10_000,
  224 |     });
  225 | 
  226 |     const textarea = page.locator(".monaco-editor textarea").first();
  227 |     await textarea.press("Control+a");
  228 |     await textarea.pressSequentially("const saved = true;");
  229 | 
  230 |     // Wait for unsaved state
  231 |     await expect(page.getByTestId("save-status")).toContainText("Unsaved", {
  232 |       timeout: 5_000,
  233 |     });
  234 | 
  235 |     // Save via keyboard shortcut
  236 |     await page.keyboard.press("Meta+s");
  237 | 
  238 |     await expect(page.getByTestId("save-status")).toContainText("Saved", {
  239 |       timeout: 8_000,
  240 |     });
  241 |   });
  242 | 
  243 |   // ── Content persists after page refresh ──────────────────────────────────────
  244 | 
  245 |   test("file content persists after page refresh", async ({ page }) => {
  246 |     await freshWorkspace(page);
  247 | 
  248 |     await page.getByTestId("new-file-button").click();
  249 |     await page.getByTestId("new-item-input").fill("persist-test.ts");
  250 |     await page.getByTestId("new-item-input").press("Enter");
  251 |     await page.getByRole("treeitem", { name: "persist-test.ts" }).click();
  252 | 
  253 |     await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
  254 |       timeout: 10_000,
  255 |     });
```