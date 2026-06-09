import { create } from "zustand";
import {
  mockFileContents,
  mockFiles,
  mockReviewNotes,
} from "../data/mock";
import { getLanguageFromFilename, toLanguageMode } from "../lib/language";
import type {
  ActivityItem,
  BackendStatus,
  ChatMessage,
  ConnectionStatus,
  CursorPosition,
  FileNode,
  OpenTab,
  PanelKey,
  SaveStatus,
  TerminalTab,
  WorkspaceState as WorkspaceData,
  WorkspaceTheme,
} from "../types";

type BackendLoadData = {
  files: FileNode[];
  editorContent: Record<string, string>;
  defaultFileId: string | null;
};

type WorkspaceActions = {
  openFile: (fileId: string) => void;
  closeTab: (fileId: string) => void;
  setActiveFile: (fileId: string) => void;
  updateFileContent: (fileId: string, content: string) => void;
  toggleFolder: (folderId: string) => void;
  setActiveTerminalTab: (tab: TerminalTab) => void;
  setSelectedActivityItem: (item: ActivityItem) => void;
  togglePanel: (panel: PanelKey) => void;
  closeAllOverlays: () => void;
  setTheme: (theme: WorkspaceTheme) => void;
  toggleTheme: () => void;
  setCursorPosition: (pos: CursorPosition) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setBackendStatus: (status: BackendStatus) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setWorkspaceId: (id: string) => void;
  batchLoadBackend: (data: BackendLoadData) => void;
  clearTabDirty: (fileId: string) => void;
  addFileNode: (file: Extract<FileNode, { kind: "file" }>, content: string) => void;
  addFolderNode: (folder: Extract<FileNode, { kind: "folder" }>) => void;
  importFiles: (nodes: FileNode[], contentMap: Record<string, string>, firstFileId: string | null) => void;
  deleteNode: (nodeId: string) => void;
  renameNode: (nodeId: string, newName: string) => void;
};

export type WorkspaceState = WorkspaceData & WorkspaceActions;

function collectAllFileIds(nodes: FileNode[], acc: string[]): void {
  for (const node of nodes) {
    if (node.kind === "file") acc.push(node.id);
    else collectAllFileIds(node.children, acc);
  }
}

function removeNodeFromTree(
  nodes: FileNode[],
  nodeId: string,
): { tree: FileNode[]; removedFileIds: string[] } {
  const removedFileIds: string[] = [];

  function remove(items: FileNode[]): FileNode[] {
    const result: FileNode[] = [];
    for (const item of items) {
      if (item.id === nodeId) {
        if (item.kind === "file") removedFileIds.push(item.id);
        else collectAllFileIds(item.children, removedFileIds);
        // skip (removed)
      } else if (item.kind === "folder") {
        result.push({ ...item, children: remove(item.children) });
      } else {
        result.push(item);
      }
    }
    return result;
  }

  return { tree: remove(nodes), removedFileIds };
}

function renameInTree(nodes: FileNode[], nodeId: string, newName: string): FileNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) {
      return { ...node, name: newName };
    }
    if (node.kind === "folder") {
      return { ...node, children: renameInTree(node.children, nodeId, newName) };
    }
    return node;
  });
}

function findFileInTree(nodes: FileNode[], fileId: string): Extract<FileNode, { kind: "file" }> | null {
  for (const node of nodes) {
    if (node.kind === "file" && node.id === fileId) {
      return node;
    }
    if (node.kind === "folder") {
      const found = findFileInTree(node.children, fileId);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function toggleFolderInTree(nodes: FileNode[], folderId: string): FileNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      if (node.id === folderId) {
        return { ...node, expanded: !node.expanded };
      }
      return { ...node, children: toggleFolderInTree(node.children, folderId) };
    }
    return node;
  });
}

function applyThemeToDocument(theme: WorkspaceTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function getInitialTheme(): WorkspaceTheme {
  try {
    const stored = localStorage.getItem("meridian-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable
  }
  return "dark";
}

function persistTheme(theme: WorkspaceTheme): void {
  try {
    localStorage.setItem("meridian-theme", theme);
  } catch {
    // localStorage unavailable
  }
}

const _initialTheme = getInitialTheme();
applyThemeToDocument(_initialTheme);

const INITIAL_OPEN_TABS: OpenTab[] = [
  { fileId: "file-auth", name: "auth.ts", language: "typescript", dirty: false },
  { fileId: "file-database", name: "database.ts", language: "typescript", dirty: false },
];

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  // ── Data state ────────────────────────────────────────────────────────────
  workspaceId: null,
  files: mockFiles,
  activeFileId: "file-auth",
  openTabs: INITIAL_OPEN_TABS,
  editorContentByFileId: { ...mockFileContents },
  collaborators: [],
  chatMessages: [],
  reviewNotes: mockReviewNotes,
  diagnosticCounts: { errors: 0, warnings: 2 },

  // ── UI state ──────────────────────────────────────────────────────────────
  activeTerminalTab: "terminal",
  selectedActivityItem: "explorer",
  isExplorerOpen: true,
  isCollaborationPanelOpen: true,
  isBottomPanelOpen: true,
  theme: _initialTheme,
  cursorPosition: { line: 42, column: 12 },
  saveStatus: "saved",

  // ── Backend / socket state ────────────────────────────────────────────────
  backendStatus: "pending",
  connectionStatus: "disconnected",

  // ── File actions ──────────────────────────────────────────────────────────

  openFile: (fileId) => {
    const file = findFileInTree(get().files, fileId);
    if (!file) return;

    set((state) => {
      const existingTab = state.openTabs.find((tab) => tab.fileId === fileId);
      const openTabs = existingTab
        ? state.openTabs
        : [
            ...state.openTabs,
            { fileId: file.id, name: file.name, language: file.language, dirty: false },
          ];
      return { openTabs, activeFileId: fileId };
    });
  },

  closeTab: (fileId) => {
    set((state) => {
      const openTabs = state.openTabs.filter((tab) => tab.fileId !== fileId);
      let activeFileId = state.activeFileId;

      if (state.activeFileId === fileId) {
        const closedIndex = state.openTabs.findIndex((tab) => tab.fileId === fileId);
        const nextTab = openTabs[closedIndex] ?? openTabs[closedIndex - 1] ?? null;
        activeFileId = nextTab?.fileId ?? null;
      }

      return { openTabs, activeFileId };
    });
  },

  setActiveFile: (fileId) => {
    const hasTab = get().openTabs.some((tab) => tab.fileId === fileId);
    if (!hasTab) {
      get().openFile(fileId);
      return;
    }
    set({ activeFileId: fileId });
  },

  updateFileContent: (fileId, content) => {
    set((state) => ({
      editorContentByFileId: { ...state.editorContentByFileId, [fileId]: content },
      openTabs: state.openTabs.map((tab) =>
        tab.fileId === fileId ? { ...tab, dirty: true } : tab,
      ),
      saveStatus: "unsaved",
    }));
  },

  clearTabDirty: (fileId) => {
    set((state) => ({
      openTabs: state.openTabs.map((tab) =>
        tab.fileId === fileId ? { ...tab, dirty: false } : tab,
      ),
    }));
  },

  toggleFolder: (folderId) => {
    set((state) => ({ files: toggleFolderInTree(state.files, folderId) }));
  },

  // ── UI actions ────────────────────────────────────────────────────────────

  setActiveTerminalTab: (tab) => set({ activeTerminalTab: tab }),
  setSelectedActivityItem: (item) => set({ selectedActivityItem: item }),

  togglePanel: (panel) => {
    set((state) => {
      switch (panel) {
        case "explorer":
          return { isExplorerOpen: !state.isExplorerOpen };
        case "collaboration":
          return { isCollaborationPanelOpen: !state.isCollaborationPanelOpen };
        case "bottom":
          return { isBottomPanelOpen: !state.isBottomPanelOpen };
      }
    });
  },

  closeAllOverlays: () => {
    set({ isExplorerOpen: false, isCollaborationPanelOpen: false, isBottomPanelOpen: false });
  },

  setTheme: (theme) => {
    persistTheme(theme);
    applyThemeToDocument(theme);
    set({ theme });
  },

  toggleTheme: () => {
    const theme = get().theme === "dark" ? "light" : "dark";
    persistTheme(theme);
    applyThemeToDocument(theme);
    set({ theme });
  },

  setCursorPosition: (pos) => set({ cursorPosition: pos }),

  addChatMessage: (msg) => {
    set((state) => ({ chatMessages: [...state.chatMessages, msg] }));
  },

  // ── Save / backend / socket actions ───────────────────────────────────────

  setSaveStatus: (status) => set({ saveStatus: status }),

  setBackendStatus: (status) => set({ backendStatus: status }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  setWorkspaceId: (id) => set({ workspaceId: id }),

  addFileNode: (file, content) => {
    set((state) => ({
      files: [...state.files, file],
      editorContentByFileId: { ...state.editorContentByFileId, [file.id]: content },
      openTabs: state.openTabs.some((t) => t.fileId === file.id)
        ? state.openTabs
        : [
            ...state.openTabs,
            { fileId: file.id, name: file.name, language: file.language, dirty: content.length > 0 },
          ],
      activeFileId: file.id,
      saveStatus: content.length > 0 ? ("unsaved" as const) : ("saved" as const),
    }));
  },

  addFolderNode: (folder) => {
    set((state) => ({ files: [...state.files, folder] }));
  },

  deleteNode: (nodeId) => {
    set((state) => {
      const { tree, removedFileIds } = removeNodeFromTree(state.files, nodeId);
      const removedSet = new Set(removedFileIds);
      const newEditorContent = Object.fromEntries(
        Object.entries(state.editorContentByFileId).filter(([id]) => !removedSet.has(id)),
      );
      const newOpenTabs = state.openTabs.filter((t) => !removedSet.has(t.fileId));
      let newActiveFileId = state.activeFileId;
      if (state.activeFileId !== null && removedSet.has(state.activeFileId)) {
        const idx = state.openTabs.findIndex((t) => t.fileId === state.activeFileId);
        newActiveFileId = (newOpenTabs[idx] ?? newOpenTabs[idx - 1] ?? newOpenTabs[0])?.fileId ?? null;
      }
      return {
        files: tree,
        editorContentByFileId: newEditorContent,
        openTabs: newOpenTabs,
        activeFileId: newActiveFileId,
      };
    });
  },

  renameNode: (nodeId, newName) => {
    set((state) => ({
      files: renameInTree(state.files, nodeId, newName),
      openTabs: state.openTabs.map((t) => {
        if (t.fileId !== nodeId) return t;
        return { ...t, name: newName, language: toLanguageMode(getLanguageFromFilename(newName)) };
      }),
    }));
  },

  importFiles: (nodes, contentMap, firstFileId) => {
    set((state) => {
      const firstFile =
        firstFileId !== null ? findFileInTree(nodes, firstFileId) : null;
      const alreadyOpen =
        firstFile !== null &&
        state.openTabs.some((t) => t.fileId === firstFile.id);
      const newTabs =
        firstFile !== null && !alreadyOpen
          ? [
              ...state.openTabs,
              {
                fileId: firstFile.id,
                name: firstFile.name,
                language: firstFile.language,
                dirty: false,
              },
            ]
          : state.openTabs;
      return {
        files: [...state.files, ...nodes],
        editorContentByFileId: { ...state.editorContentByFileId, ...contentMap },
        openTabs: newTabs,
        activeFileId: firstFileId ?? state.activeFileId,
      };
    });
  },

  batchLoadBackend: ({ files, editorContent, defaultFileId }) => {
    set((state) => {
      let openTabs = state.openTabs;
      let activeFileId = state.activeFileId;

      if (defaultFileId !== null) {
        const file = findFileInTree(files, defaultFileId);
        if (file !== null) {
          openTabs = [{ fileId: file.id, name: file.name, language: file.language, dirty: false }];
          activeFileId = defaultFileId;
        }
      }

      return { files, editorContentByFileId: editorContent, openTabs, activeFileId };
    });
  },
}));
