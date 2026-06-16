import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "../ui/EmptyState";
import { EditorSkeleton } from "../ui/Skeleton";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useYjsMonaco } from "../../hooks/useYjsMonaco";
import { registerEditor, unregisterEditor } from "../../lib/editorRegistry";
import { mockCollaborators } from "../../data/mock";
import type { LanguageMode, WorkspaceTheme } from "../../types";
import {
  attachRemoteCollaboratorCursors,
  type RemoteCursorController,
} from "./remoteCollaboratorCursors";
import {
  registerMeridianMonacoThemes,
  toMeridianMonacoTheme,
  type MeridianEditorTheme,
} from "./monacoThemes";

const LANGUAGE_TO_MONACO: Record<LanguageMode, string> = {
  typescript: "typescript",
  javascript: "javascript",
  python: "python",
  go: "go",
  rust: "rust",
  html: "html",
  css: "css",
  json: "json",
  java: "java",
  cpp: "cpp",
  c: "c",
  markdown: "markdown",
  yaml: "yaml",
  sql: "sql",
  shell: "shell",
  plaintext: "plaintext",
};

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  tabSize: 4,
  insertSpaces: true,
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: 13,
  lineHeight: 20,
  smoothScrolling: true,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  padding: { top: 10, bottom: 10 },
  lineDecorationsWidth: 8,
  glyphMargin: false,
  lineNumbers: "on",
  renderLineHighlight: "line",
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  bracketPairColorization: { enabled: true },
  guides: {
    indentation: true,
    bracketPairs: true,
  },
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
};

type CodeEditorProps = {
  workspaceTheme?: WorkspaceTheme;
};

export function CodeEditor({ workspaceTheme = "dark" }: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const remoteCursorControllerRef = useRef<RemoteCursorController | null>(null);
  const [mountedEditor, setMountedEditor] = useState<editor.IStandaloneCodeEditor | null>(null);
  const monacoTheme: MeridianEditorTheme = toMeridianMonacoTheme(workspaceTheme);

  const activeFileId = useWorkspaceStore((state) => state.activeFileId);
  const openTabs = useWorkspaceStore((state) => state.openTabs);
  const editorContentByFileId = useWorkspaceStore((state) => state.editorContentByFileId);
  const updateFileContent = useWorkspaceStore((state) => state.updateFileContent);
  const setCursorPosition = useWorkspaceStore((state) => state.setCursorPosition);
  const backendStatus = useWorkspaceStore((state) => state.backendStatus);
  const isDemoMode = backendStatus === "unavailable";

  useYjsMonaco(mountedEditor, activeFileId, backendStatus === "available");

  const syncCursorPosition = (monacoEditor: editor.IStandaloneCodeEditor): void => {
    const position = monacoEditor.getPosition();
    if (!position) {
      return;
    }
    setCursorPosition({
      line: position.lineNumber,
      column: position.column,
    });
  };

  const handleMount: OnMount = (monacoEditor, monaco) => {
    registerMeridianMonacoThemes(monaco);
    monaco.editor.setTheme(monacoTheme);
    remoteCursorControllerRef.current?.dispose();
    remoteCursorControllerRef.current = null;
    editorRef.current = monacoEditor;
    registerEditor(monacoEditor);
    setMountedEditor(monacoEditor);
    syncCursorPosition(monacoEditor);
    monacoEditor.onDidChangeCursorPosition(() => syncCursorPosition(monacoEditor));

    // Reflect Monaco's diagnostics (squiggles) in the status bar.
    const updateDiagnostics = (): void => {
      const model = monacoEditor.getModel();
      if (model === null) return;
      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      useWorkspaceStore.getState().setDiagnosticCounts({
        errors: markers.filter(
          (m: editor.IMarker) => m.severity === monaco.MarkerSeverity.Error,
        ).length,
        warnings: markers.filter(
          (m: editor.IMarker) => m.severity === monaco.MarkerSeverity.Warning,
        ).length,
      });
    };
    updateDiagnostics();
    const markerListener = monaco.editor.onDidChangeMarkers(updateDiagnostics);
    monacoEditor.onDidDispose(() => {
      markerListener.dispose();
      unregisterEditor(monacoEditor);
    });
  };

  useEffect(() => {
    remoteCursorControllerRef.current?.dispose();
    remoteCursorControllerRef.current = null;
    setMountedEditor(null);
    editorRef.current = null;
  }, [activeFileId]);

  // Demo mode only: animate fake collaborator cursors so the offline demo
  // still feels alive. With a backend, real cursors come from Yjs awareness
  // (rendered by y-monaco via the styles in lib/awarenessPresence).
  useEffect(() => {
    if (!mountedEditor || !activeFileId || !isDemoMode) {
      return;
    }

    remoteCursorControllerRef.current?.dispose();
    remoteCursorControllerRef.current = attachRemoteCollaboratorCursors(
      mountedEditor,
      mockCollaborators,
      activeFileId,
    );

    return () => {
      remoteCursorControllerRef.current?.dispose();
      remoteCursorControllerRef.current = null;
    };
  }, [mountedEditor, activeFileId, isDemoMode]);

  useEffect(() => {
    return () => {
      remoteCursorControllerRef.current?.dispose();
      remoteCursorControllerRef.current = null;
      editorRef.current = null;
      setMountedEditor(null);
    };
  }, []);

  if (!activeFileId) {
    return (
      <EmptyState
        className="meridian-editor-chrome h-full min-h-0 flex-1 border-t meridian-crisp-border"
        icon="code"
        title="No file open"
        description="Open a file from the explorer to start editing"
      />
    );
  }

  const activeTab = openTabs.find((tab) => tab.fileId === activeFileId);
  const language = activeTab?.language ?? "typescript";
  const content = editorContentByFileId[activeFileId] ?? "";

  const handleChange = (value: string | undefined): void => {
    updateFileContent(activeFileId, value ?? "");
    if (editorRef.current) {
      syncCursorPosition(editorRef.current);
    }
  };

  return (
    <div className="meridian-editor-chrome relative flex h-full min-h-0 w-full flex-1 flex-col" data-testid="monaco-editor-wrapper">
      <Editor
        key={activeFileId}
        height="100%"
        language={LANGUAGE_TO_MONACO[language]}
        theme={monacoTheme}
        value={content}
        options={EDITOR_OPTIONS}
        loading={<EditorSkeleton />}
        beforeMount={registerMeridianMonacoThemes}
        onMount={handleMount}
        onChange={handleChange}
      />
    </div>
  );
}
