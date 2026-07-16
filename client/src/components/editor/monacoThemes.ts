import { MERIDIAN_BRAND } from "../../constants/brand";
import type { Monaco } from "@monaco-editor/react";

export type MeridianEditorTheme = "meridian-dark" | "meridian-light";

const BRAND_SELECTION_DARK = `${MERIDIAN_BRAND}45`;
const BRAND_SELECTION_LIGHT = `${MERIDIAN_BRAND}32`;

export function registerMeridianMonacoThemes(monaco: Monaco): void {
  monaco.editor.defineTheme("meridian-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0d0e14",
      "editor.foreground": "#e9e7f2",
      "editor.lineHighlightBackground": "#1a1c2400",
      "editor.lineHighlightBorder": "#3a3848",
      "editor.selectionBackground": BRAND_SELECTION_DARK,
      "editor.inactiveSelectionBackground": `${MERIDIAN_BRAND}22`,
      "editorLineNumber.foreground": "#4a4858",
      "editorLineNumber.activeForeground": "#7a7690",
      "editorCursor.foreground": MERIDIAN_BRAND,
      "editorWidget.border": "#2e2c3a",
      "editorIndentGuide.background": "#1f212a",
      "editorIndentGuide.activeBackground": "#2e2c3a",
      "editorGutter.background": "#0d0e14",
    },
  });

  monaco.editor.defineTheme("meridian-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#eceef3",
      "editor.foreground": "#3a4150",
      "editor.lineHighlightBackground": "#e0e3ea80",
      "editor.selectionBackground": BRAND_SELECTION_LIGHT,
      "editorLineNumber.foreground": "#9aa1b0",
      "editorLineNumber.activeForeground": "#6b7385",
      "editorCursor.foreground": MERIDIAN_BRAND,
      "editorWidget.border": "#b8bec9",
      "editorIndentGuide.background": "#dce0e8",
      "editorIndentGuide.activeBackground": "#b8bec9",
      "editorGutter.background": "#eceef3",
    },
  });
}

export function toMeridianMonacoTheme(
  workspaceTheme: "dark" | "light",
): MeridianEditorTheme {
  return workspaceTheme === "dark" ? "meridian-dark" : "meridian-light";
}
