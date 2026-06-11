# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> workspace (backend required) >> Cmd+S saves the active file and clears dirty state
- Location: e2e/workspace.spec.ts:196:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('save-status')
Expected substring: "Unsaved"
Received string:    "Saved"
Timeout: 5000ms

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for getByTestId('save-status')
    14 × locator resolved to <span data-save-status="saved" data-testid="save-status" class="inline-flex h-full items-center gap-1 px-2.5 transition-colors duration-100 ease-out hover:bg-on-primary/10">Saved</span>
       - unexpected value "Saved"

```

```yaml
- text: Saved
```

# Test source

```ts
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
  125 | 
  126 |     const folderRow = page.getByRole("treeitem", { name: "old-folder" });
  127 |     await folderRow.hover();
  128 |     await page.getByRole("button", { name: "Rename old-folder" }).click();
  129 | 
  130 |     const renameInput = page.getByLabel("Rename folder");
  131 |     await renameInput.selectText();
  132 |     await renameInput.fill("new-folder");
  133 |     await renameInput.press("Enter");
  134 | 
  135 |     await expect(page.getByRole("treeitem", { name: "new-folder" })).toBeVisible({
  136 |       timeout: 8_000,
  137 |     });
  138 |   });
  139 | 
  140 |   // ── Delete file ──────────────────────────────────────────────────────────────
  141 | 
  142 |   test("delete a file", async ({ page }) => {
  143 |     await freshWorkspace(page);
  144 | 
  145 |     await page.getByTestId("new-file-button").click();
  146 |     await page.getByTestId("new-item-input").fill("delete-me.ts");
  147 |     await page.getByTestId("new-item-input").press("Enter");
  148 |     await expect(page.getByRole("treeitem", { name: "delete-me.ts" })).toBeVisible({
  149 |       timeout: 8_000,
  150 |     });
  151 | 
  152 |     const fileRow = page.getByRole("treeitem", { name: "delete-me.ts" });
  153 |     await fileRow.hover();
  154 | 
  155 |     // Accept the window.confirm dialog
  156 |     page.once("dialog", (dialog) => dialog.accept());
  157 |     await page.getByRole("button", { name: "Delete delete-me.ts" }).click();
  158 | 
  159 |     await expect(page.getByRole("treeitem", { name: "delete-me.ts" })).toBeHidden({
  160 |       timeout: 8_000,
  161 |     });
  162 |   });
  163 | 
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
> 213 |     await expect(page.getByTestId("save-status")).toContainText("Unsaved", {
      |                                                   ^ Error: expect(locator).toContainText(expected) failed
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
  264 |     expect(editorContent).toContain("persisted");
  265 |   });
  266 | });
  267 | 
```