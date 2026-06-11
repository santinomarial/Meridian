# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> workspace (backend required) >> file content persists after page refresh
- Location: e2e/workspace.spec.ts:227:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "persisted"
Received string:    "export function Persist_test(): void {"
```

# Page snapshot

```yaml
- generic [ref=e1]:
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
          - generic [ref=e55]: persist-test.ts
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
          - treeitem "description persist-test.ts" [active] [selected] [ref=e130] [cursor=pointer]:
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
      - main [ref=e146]:
        - tablist "Open editors" [ref=e148]:
          - listitem [ref=e149]:
            - button "description edit-test.ts" [ref=e150] [cursor=pointer]:
              - generic [ref=e151]: description
              - generic [ref=e152]: edit-test.ts
            - button "Close edit-test.ts" [ref=e154] [cursor=pointer]:
              - generic [ref=e155]: close
          - listitem [ref=e156]:
            - button "description persist-test.ts" [ref=e157] [cursor=pointer]:
              - generic [ref=e158]: description
              - generic [ref=e159]: persist-test.ts
            - button "Close persist-test.ts" [ref=e161] [cursor=pointer]:
              - generic [ref=e162]: close
        - code [ref=e166]:
          - generic [ref=e167]:
            - textbox "Editor content"
            - textbox [ref=e168]
            - generic [ref=e170]:
              - generic [ref=e173]: "1"
              - generic [ref=e175]: "2"
              - generic [ref=e177]: "3"
              - generic [ref=e179]: "4"
            - generic [ref=e187]:
              - generic [ref=e189]: "export function Persist_test(): void {"
              - generic [ref=e193]: "}"
        - region "Bottom panel" [ref=e195]:
          - generic [ref=e196]:
            - tablist "Panel tabs" [ref=e197]:
              - tab "TERMINAL" [selected] [ref=e198] [cursor=pointer]
              - tab "OUTPUT" [ref=e199] [cursor=pointer]
              - tab "DEBUG CONSOLE" [ref=e200] [cursor=pointer]
              - tab "bolt AI ASSISTANT" [ref=e201] [cursor=pointer]:
                - generic [ref=e202]: bolt
                - text: AI ASSISTANT
            - generic [ref=e203]:
              - button "Add panel tab" [ref=e204] [cursor=pointer]:
                - generic [ref=e205]: add
              - button "Collapse panel" [ref=e206] [cursor=pointer]:
                - generic [ref=e207]: keyboard_arrow_up
              - button "Close panel" [ref=e208] [cursor=pointer]:
                - generic [ref=e209]: close
          - tabpanel [ref=e210]:
            - generic [ref=e211]:
              - paragraph [ref=e212]: meridian-app@0.1.0 start
              - paragraph [ref=e213]: $ npm run start:dev
              - paragraph [ref=e214]: "[10:42:01 AM] Starting compilation in watch mode..."
              - paragraph [ref=e215]: "[10:42:05 AM] Found 0 errors. Watching for file changes."
              - paragraph [ref=e216]: Ready on http://localhost:3000
            - complementary [ref=e218]:
              - generic [ref=e219]:
                - generic [ref=e220]: Meridian AI
                - generic [ref=e221]: v0.1
              - generic [ref=e222]:
                - paragraph [ref=e223]: Missing JWT verification step.
                - button "Insert" [ref=e224] [cursor=pointer]
              - paragraph [ref=e225]: ⌘I deep dive
      - complementary "Collaboration" [ref=e226]:
        - heading "Collaborators" [level=2] [ref=e230]
        - generic [ref=e231]:
          - generic [ref=e232]: group_add
          - paragraph [ref=e233]: No collaborators yet.
          - paragraph [ref=e234]:
            - text: Use
            - strong [ref=e235]: Share
            - text: to invite someone.
        - generic [ref=e236]:
          - heading "Live Chat" [level=2] [ref=e238]
          - generic [ref=e240]:
            - generic [ref=e241]: chat_bubble_outline
            - paragraph [ref=e242]: No messages yet.
            - paragraph [ref=e243]: Start the conversation.
          - generic [ref=e244]:
            - textbox "Send a message…" [ref=e245]
            - button "Send message" [disabled] [ref=e246]:
              - generic [ref=e247]: send
        - generic [ref=e248]:
          - generic [ref=e249]:
            - heading "Review Notes" [level=2] [ref=e250]
            - generic [ref=e251]: "2"
          - list [ref=e252]:
            - listitem [ref=e253]:
              - paragraph [ref=e254]: Memory leak risk
              - paragraph [ref=e255]: "L128: Observable not unsubscribed."
            - listitem [ref=e256]:
              - paragraph [ref=e257]: Refactor request
              - paragraph [ref=e258]: Extract helper to shared service.
    - contentinfo "Status bar" [ref=e259]:
      - generic [ref=e260]:
        - generic [ref=e261]:
          - generic [ref=e262]: sync
          - generic [ref=e263]: main
        - generic [ref=e264]:
          - generic [ref=e265]: error_outline
          - generic [ref=e266]: "0"
          - generic [ref=e267]: warning_amber
          - generic [ref=e268]: "2"
      - generic [ref=e269]:
        - generic [ref=e270]: Ln 1, Col 1
        - generic [ref=e271]: "Spaces: 4"
        - generic [ref=e272]: UTF-8
        - generic [ref=e273]: TypeScript
        - generic [ref=e274]:
          - generic [ref=e275]: check_circle
          - text: Prettier
        - generic [ref=e276]: Saved
        - generic [ref=e277]: Meridian v0.1.0
  - generic [ref=e278]:
    - alert
    - alert
```

# Test source

```ts
  164 |   // ── Edit file in Monaco ──────────────────────────────────────────────────────
  165 | 
  166 |   test("edit file content in Monaco editor", async ({ page }) => {
  167 |     await freshWorkspace(page);
  168 | 
  169 |     // Create + open a file
  170 |     await page.getByTestId("new-file-button").click();
  171 |     await page.getByTestId("new-item-input").fill("edit-test.ts");
  172 |     await page.getByTestId("new-item-input").press("Enter");
  173 |     await page.getByRole("treeitem", { name: "edit-test.ts" }).click();
  174 | 
  175 |     // Wait for Monaco to mount
  176 |     await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
  177 |       timeout: 10_000,
  178 |     });
  179 | 
  180 |     // Monaco exposes a hidden textarea for keyboard input.
  181 |     // Select all existing content and replace it.
  182 |     const textarea = page.locator(".monaco-editor textarea").first();
  183 |     await textarea.press("Control+a");
  184 |     await textarea.type("const e2e = true;");
  185 | 
  186 |     // Dirty indicator (dot) should appear on the active tab
  187 |     // The dot has no text — confirm the tab shows the dirty indicator via aria.
  188 |     // We verify instead that the save-status shows "Unsaved".
  189 |     await expect(page.getByTestId("save-status")).toContainText("Unsaved", {
  190 |       timeout: 5_000,
  191 |     });
  192 |   });
  193 | 
  194 |   // ── Save with Cmd+S ──────────────────────────────────────────────────────────
  195 | 
  196 |   test("Cmd+S saves the active file and clears dirty state", async ({ page }) => {
  197 |     await freshWorkspace(page);
  198 | 
  199 |     await page.getByTestId("new-file-button").click();
  200 |     await page.getByTestId("new-item-input").fill("save-test.ts");
  201 |     await page.getByTestId("new-item-input").press("Enter");
  202 |     await page.getByRole("treeitem", { name: "save-test.ts" }).click();
  203 | 
  204 |     await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
  205 |       timeout: 10_000,
  206 |     });
  207 | 
  208 |     const textarea = page.locator(".monaco-editor textarea").first();
  209 |     await textarea.press("Control+a");
  210 |     await textarea.type("const saved = true;");
  211 | 
  212 |     // Wait for unsaved state
  213 |     await expect(page.getByTestId("save-status")).toContainText("Unsaved", {
  214 |       timeout: 5_000,
  215 |     });
  216 | 
  217 |     // Save via keyboard shortcut
  218 |     await page.keyboard.press("Meta+s");
  219 | 
  220 |     await expect(page.getByTestId("save-status")).toContainText("Saved", {
  221 |       timeout: 8_000,
  222 |     });
  223 |   });
  224 | 
  225 |   // ── Content persists after page refresh ──────────────────────────────────────
  226 | 
  227 |   test("file content persists after page refresh", async ({ page }) => {
  228 |     await freshWorkspace(page);
  229 | 
  230 |     await page.getByTestId("new-file-button").click();
  231 |     await page.getByTestId("new-item-input").fill("persist-test.ts");
  232 |     await page.getByTestId("new-item-input").press("Enter");
  233 |     await page.getByRole("treeitem", { name: "persist-test.ts" }).click();
  234 | 
  235 |     await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
  236 |       timeout: 10_000,
  237 |     });
  238 | 
  239 |     const textarea = page.locator(".monaco-editor textarea").first();
  240 |     await textarea.press("Control+a");
  241 |     await textarea.type("const persisted = 'yes';");
  242 | 
  243 |     // Save
  244 |     await page.keyboard.press("Meta+s");
  245 |     await expect(page.getByTestId("save-status")).toContainText("Saved", {
  246 |       timeout: 8_000,
  247 |     });
  248 | 
  249 |     // Reload
  250 |     await page.reload();
  251 |     await page.waitForURL("/workspace");
  252 |     await expect(page.getByTestId("file-explorer")).toBeVisible({ timeout: 15_000 });
  253 | 
  254 |     // Reopen the file
  255 |     await page.getByRole("treeitem", { name: "persist-test.ts" }).click();
  256 |     await expect(page.getByTestId("monaco-editor-wrapper")).toBeVisible({
  257 |       timeout: 10_000,
  258 |     });
  259 | 
  260 |     // Check content
  261 |     const editorContent = await page
  262 |       .locator(".monaco-editor .view-lines")
  263 |       .textContent();
> 264 |     expect(editorContent).toContain("persisted");
      |                           ^ Error: expect(received).toContain(expected) // indexOf
  265 |   });
  266 | });
  267 | 
```