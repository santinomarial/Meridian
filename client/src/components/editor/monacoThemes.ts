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
      "editor.background": "#131916",
      "editor.foreground": "#e4e9e2",
      "editor.lineHighlightBackground": "#1a1c2400",
      "editor.lineHighlightBorder": "#37443c",
      "editor.selectionBackground": BRAND_SELECTION_DARK,
      "editor.inactiveSelectionBackground": `${MERIDIAN_BRAND}22`,
      "editorLineNumber.foreground": "#738178",
      "editorLineNumber.activeForeground": "#b1bfb5",
      "editorCursor.foreground": "#a4d8c7",
      "editorWidget.border": "#37443c",
      "editorIndentGuide.background": "#27312b",
      "editorIndentGuide.activeBackground": "#37443c",
      "editorGutter.background": "#131916",
    },
  });

  monaco.editor.defineTheme("meridian-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#faf9f5",
      "editor.foreground": "#252b29",
      "editor.lineHighlightBackground": "#eeede680",
      "editor.selectionBackground": BRAND_SELECTION_LIGHT,
      "editorLineNumber.foreground": "#7c857e",
      "editorLineNumber.activeForeground": "#5b645f",
      "editorCursor.foreground": MERIDIAN_BRAND,
      "editorWidget.border": "#c8cdc4",
      "editorIndentGuide.background": "#e4e3db",
      "editorIndentGuide.activeBackground": "#c8cdc4",
      "editorGutter.background": "#faf9f5",
    },
  });
}

export function toMeridianMonacoTheme(
  workspaceTheme: "dark" | "light",
): MeridianEditorTheme {
  return workspaceTheme === "dark" ? "meridian-dark" : "meridian-light";
}
