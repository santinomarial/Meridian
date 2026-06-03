import { create } from "zustand";
import {
  mockChatMessages,
  mockCollaborators,
  mockFileContents,
  mockFiles,
  mockReviewNotes,
} from "../data/mock";
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
  batchLoadBackend: (data: BackendLoadData) => void;
  clearTabDirty: (fileId: string) => void;
};

export type WorkspaceState = WorkspaceData & WorkspaceActions;

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

const INITIAL_OPEN_TABS: OpenTab[] = [
  { fileId: "file-auth", name: "auth.ts", language: "typescript", dirty: false },
  { fileId: "file-database", name: "database.ts", language: "typescript", dirty: false },
];

applyThemeToDocument("dark");

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  // ── Data state ────────────────────────────────────────────────────────────
  files: mockFiles,
  activeFileId: "file-auth",
  openTabs: INITIAL_OPEN_TABS,
  editorContentByFileId: { ...mockFileContents },
  collaborators: mockCollaborators,
  chatMessages: mockChatMessages,
  reviewNotes: mockReviewNotes,
  diagnosticCounts: { errors: 0, warnings: 2 },

  // ── UI state ──────────────────────────────────────────────────────────────
  activeTerminalTab: "terminal",
  selectedActivityItem: "explorer",
  isExplorerOpen: true,
  isCollaborationPanelOpen: true,
  isBottomPanelOpen: true,
  theme: "dark",
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
    applyThemeToDocument(theme);
    set({ theme });
  },

  toggleTheme: () => {
    const theme = get().theme === "dark" ? "light" : "dark";
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

applyThemeToDocument("dark");
