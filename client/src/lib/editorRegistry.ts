import type { editor } from "monaco-editor";

/**
 * Tracks the currently mounted Monaco editor so chrome outside the editor
 * tree (e.g. the Header menus) can invoke editor actions like undo/format.
 */
let _activeEditor: editor.IStandaloneCodeEditor | null = null;

export function registerEditor(instance: editor.IStandaloneCodeEditor): void {
  _activeEditor = instance;
}

export function unregisterEditor(instance: editor.IStandaloneCodeEditor): void {
  if (_activeEditor === instance) _activeEditor = null;
}

export function getActiveEditor(): editor.IStandaloneCodeEditor | null {
  return _activeEditor;
}
