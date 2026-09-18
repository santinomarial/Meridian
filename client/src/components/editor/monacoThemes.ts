import { MERIDIAN_BRAND } from "../../constants/brand";
import type { Monaco } from "@monaco-editor/react";

export type MeridianEditorTheme = "meridian-dark" | "meridian-light";

const BRAND_SELECTION_DARK = `${MERIDIAN_BRAND}45`;
const BRAND_SELECTION_LIGHT = `${MERIDIAN_BRAND}32`;

export function registerMeridianMonacoThemes(monaco: Monaco): void {
  monaco.editor.defineTheme("meridian-dark", {
    base: "vs-dark",
    inherit: false,
    rules: [
      { token: "", foreground: "FFFFFF" },
      { token: "comment", foreground: "999999", fontStyle: "italic" },
      { token: "keyword", foreground: "EC7F90", fontStyle: "bold" },
      { token: "string", foreground: "DDDDDD" },
      { token: "number", foreground: "B3B3B3" },
      { token: "type", foreground: "EC7F90" },
      { token: "tag", foreground: "EC7F90" },
      { token: "invalid", foreground: "EC7F90", fontStyle: "underline" },
    ],
    colors: {
      "editor.background": "#0a0a0a",
      "editor.foreground": "#ffffff",
      "editor.lineHighlightBackground": "#00000000",
      "editor.lineHighlightBorder": "#383838",
      "editor.selectionBackground": BRAND_SELECTION_DARK,
      "editor.inactiveSelectionBackground": `${MERIDIAN_BRAND}22`,
      "editorLineNumber.foreground": "#858585",
      "editorLineNumber.activeForeground": "#cccccc",
      "editorCursor.foreground": "#ffffff",
      "editorWidget.border": "#383838",
      "editorIndentGuide.background": "#262626",
      "editorIndentGuide.activeBackground": "#383838",
      "editorGutter.background": "#0a0a0a",
      "editorBracketHighlight.foreground1": "#ec7f90",
      "editorBracketHighlight.foreground2": "#b3b3b3",
      "editorBracketHighlight.foreground3": "#ec7f90",
      "editorBracketHighlight.foreground4": "#b3b3b3",
      "editorBracketHighlight.foreground5": "#ec7f90",
      "editorBracketHighlight.foreground6": "#b3b3b3",
      "editorBracketHighlight.unexpectedBracket.foreground": "#ec7f90",
    },
  });

  monaco.editor.defineTheme("meridian-light", {
    base: "vs",
    inherit: false,
    rules: [
      { token: "", foreground: "111111" },
      { token: "comment", foreground: "737373", fontStyle: "italic" },
      { token: "keyword", foreground: "A51C30", fontStyle: "bold" },
      { token: "string", foreground: "404040" },
      { token: "number", foreground: "525252" },
      { token: "type", foreground: "A51C30" },
      { token: "tag", foreground: "A51C30" },
      { token: "invalid", foreground: "A51C30", fontStyle: "underline" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#111111",
      "editor.lineHighlightBackground": "#eeeeee80",
      "editor.selectionBackground": BRAND_SELECTION_LIGHT,
      "editorLineNumber.foreground": "#737373",
      "editorLineNumber.activeForeground": "#525252",
      "editorCursor.foreground": MERIDIAN_BRAND,
      "editorWidget.border": "#cccccc",
      "editorIndentGuide.background": "#e5e5e5",
      "editorIndentGuide.activeBackground": "#cccccc",
      "editorGutter.background": "#ffffff",
      "editorBracketHighlight.foreground1": "#a51c30",
      "editorBracketHighlight.foreground2": "#525252",
      "editorBracketHighlight.foreground3": "#a51c30",
      "editorBracketHighlight.foreground4": "#525252",
      "editorBracketHighlight.foreground5": "#a51c30",
      "editorBracketHighlight.foreground6": "#525252",
      "editorBracketHighlight.unexpectedBracket.foreground": "#a51c30",
    },
  });
}

export function toMeridianMonacoTheme(
  workspaceTheme: "dark" | "light",
): MeridianEditorTheme {
  return workspaceTheme === "dark" ? "meridian-dark" : "meridian-light";
}
