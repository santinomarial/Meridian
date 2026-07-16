import { create } from "zustand";
import { mockFileContents, mockFiles } from "../data/mock";
import { getLanguageFromFilename, toLanguageMode } from "../lib/language";
import type {
  ActivityItem,
  AppNotification,
  BackendStatus,
  ChatMessage,
  Collaborator,
  ConnectionStatus,
  CurrentUser,
  CursorPosition,
  DiagnosticCounts,
  FileNode,
  OpenTab,
  PanelKey,
  SaveStatus,
  TerminalStatus,
  TerminalSyncStatus,
  WorkspaceState as WorkspaceData,
  WorkspaceTheme,
} from "../types";

const MAX_NOTIFICATIONS = 30;

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
  applyRemoteFileContent: (fileId: string, content: string) => void;
  toggleFolder: (folderId: string) => void;
  setSelectedActivityItem: (item: ActivityItem) => void;
  togglePanel: (panel: PanelKey) => void;
  closeAllOverlays: () => void;
  setSettingsOpen: (open: boolean) => void;
  setVersionHistoryOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setShareRequested: (requested: boolean) => void;
  markDocumentRestored: (fileId: string) => void;
  /**
   * Forces a CRDT resynchronize for `documentId` after a version restore.
   * No-ops when `generation` is not newer than the generation already known
   * for that document (duplicate/stale events).
   */
  requestDocumentResync: (documentId: string, generation: number) => void;
  setTheme: (theme: WorkspaceTheme) => void;
  toggleTheme: () => void;
  setCursorPosition: (pos: CursorPosition) => void;
  addChatMessage: (msg: ChatMessage) => void;
  addNotification: (notification: Omit<AppNotification, "id" | "timestamp">) => void;
  clearNotifications: () => void;
  setCollaborators: (collaborators: Collaborator[]) => void;
  setCurrentUser: (user: CurrentUser | null) => void;
  setUserRole: (role: "OWNER" | "EDITOR" | "VIEWER" | null) => void;
  setMemberRoles: (roles: Record<string, "OWNER" | "EDITOR" | "VIEWER">) => void;
  toggleTerminal: () => void;
  setTerminalOpen: (open: boolean) => void;
  setTerminalStatus: (status: TerminalStatus) => void;
  setTerminalSyncStatus: (status: TerminalSyncStatus | null) => void;
  setWorkspaceName: (name: string | null) => void;
  setDiagnosticCounts: (counts: DiagnosticCounts) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setBackendStatus: (status: BackendStatus) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setWorkspaceId: (id: string) => void;
  resetWorkspace: () => void;
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
      return node.kind === "file"
        ? {
            ...node,
            name: newName,
            language: toLanguageMode(getLanguageFromFilename(newName)),
          }
        : { ...node, name: newName };
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

/**
 * Merge an imported subtree into the existing explorer tree. Matching folders
 * are merged recursively so adding `src/b.ts` after `src/a.ts` does not create
 * a second `src` folder or silently discard the new child.
 */
function mergeFileTrees(existing: FileNode[], incoming: FileNode[]): FileNode[] {
  const merged = [...existing];

  for (const next of incoming) {
    const matchIndex = merged.findIndex(
      (current) =>
        current.id === next.id ||
        (current.kind === next.kind && current.name === next.name),
    );

    if (matchIndex < 0) {
      merged.push(next);
      continue;
    }

    const current = merged[matchIndex]!;
    if (current.kind === "folder" && next.kind === "folder") {
      merged[matchIndex] = {
        ...next,
        expanded: current.expanded || next.expanded,
        children: mergeFileTrees(current.children, next.children),
      };
    } else {
      merged[matchIndex] = next;
    }
  }

  return merged;
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
  if (typeof document === "undefined") return;
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

function createWorkspaceSessionState(theme: WorkspaceTheme): WorkspaceData {
  return {
    workspaceId: null,
    workspaceName: null,
    currentUser: null,
    files: mockFiles,
    activeFileId: "file-auth",
    openTabs: INITIAL_OPEN_TABS.map((tab) => ({ ...tab })),
    editorContentByFileId: { ...mockFileContents },
    collaborators: [],
    chatMessages: [],
    notifications: [],
    diagnosticCounts: { errors: 0, warnings: 0 },
    selectedActivityItem: "explorer",
    isExplorerOpen: true,
    isCollaborationPanelOpen: true,
    isSettingsOpen: false,
    isVersionHistoryOpen: false,
    isCommandPaletteOpen: false,
    shareRequested: false,
    theme,
    cursorPosition: { line: 1, column: 1 },
    saveStatus: "saved",
    userRole: null,
    memberRoles: {},
    isTerminalOpen: false,
    terminalStatus: "idle",
    terminalSyncStatus: null,
    backendStatus: "pending",
    connectionStatus: "disconnected",
    documentGenerations: {},
    documentResyncEpoch: {},
  };
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  // ── Data state ────────────────────────────────────────────────────────────
  workspaceId: null,
  workspaceName: null,
  currentUser: null,
  files: mockFiles,
  activeFileId: "file-auth",
  openTabs: INITIAL_OPEN_TABS,
  editorContentByFileId: { ...mockFileContents },
  collaborators: [],
  chatMessages: [],
  notifications: [],
  diagnosticCounts: { errors: 0, warnings: 0 },

  // ── UI state ──────────────────────────────────────────────────────────────
  selectedActivityItem: "explorer",
  isExplorerOpen: true,
  isCollaborationPanelOpen: true,
  isSettingsOpen: false,
  isVersionHistoryOpen: false,
  isCommandPaletteOpen: false,
  shareRequested: false,
  theme: _initialTheme,
  cursorPosition: { line: 1, column: 1 },
  saveStatus: "saved",

  // ── Role state ────────────────────────────────────────────────────────────
  userRole: null,
  memberRoles: {},

  // ── Terminal state ────────────────────────────────────────────────────────
  isTerminalOpen: false,
  terminalStatus: "idle" as TerminalStatus,
  terminalSyncStatus: null,

  // ── Backend / socket state ────────────────────────────────────────────────
  backendStatus: "pending",
  connectionStatus: "disconnected",
  documentGenerations: {},
  documentResyncEpoch: {},

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
      return {
        openTabs,
        activeFileId: fileId,
        saveStatus: existingTab?.dirty ? ("unsaved" as const) : ("saved" as const),
      };
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

      const nextActiveTab = openTabs.find((tab) => tab.fileId === activeFileId);
      return {
        openTabs,
        activeFileId,
        saveStatus:
          state.activeFileId === fileId
            ? nextActiveTab?.dirty
              ? ("unsaved" as const)
              : ("saved" as const)
            : state.saveStatus,
      };
    });
  },

  setActiveFile: (fileId) => {
    const hasTab = get().openTabs.some((tab) => tab.fileId === fileId);
    if (!hasTab) {
      get().openFile(fileId);
      return;
    }
    const tab = get().openTabs.find((candidate) => candidate.fileId === fileId);
    set({
      activeFileId: fileId,
      saveStatus: tab?.dirty ? "unsaved" : "saved",
    });
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

  applyRemoteFileContent: (fileId, content) => {
    set((state) => ({
      editorContentByFileId: {
        ...state.editorContentByFileId,
        [fileId]: content,
      },
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

  setSelectedActivityItem: (item) => set({ selectedActivityItem: item }),

  togglePanel: (panel) => {
    set((state) => {
      switch (panel) {
        case "explorer":
          return { isExplorerOpen: !state.isExplorerOpen };
        case "collaboration":
          return { isCollaborationPanelOpen: !state.isCollaborationPanelOpen };
      }
    });
  },

  closeAllOverlays: () => {
    set({ isExplorerOpen: false, isCollaborationPanelOpen: false });
  },

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),

  setVersionHistoryOpen: (open) => set({ isVersionHistoryOpen: open }),

  setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),

  toggleCommandPalette: () =>
    set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen })),

  setShareRequested: (requested) => set({ shareRequested: requested }),

  // Called when a restore has been applied (locally or via the document:restored
  // socket event). The editor content itself is updated by the broadcast Yjs
  // update; this only reconciles the dirty/save indicators so the tab reflects
  // that the restored content is the persisted truth, not an unsaved edit.
  markDocumentRestored: (fileId) => {
    set((state) => ({
      openTabs: state.openTabs.map((tab) =>
        tab.fileId === fileId ? { ...tab, dirty: false } : tab,
      ),
      saveStatus: state.activeFileId === fileId ? "saved" : state.saveStatus,
    }));
  },

  // Bumps the per-document resync epoch when a newer CRDT generation is
  // observed. useYjsMonaco depends on the epoch, so it discards the dead
  // lineage and re-runs the join/sync handshake against the restored state.
  requestDocumentResync: (documentId, generation) => {
    set((state) => {
      const known = state.documentGenerations[documentId] ?? 0;
      if (generation <= known) return state;
      return {
        documentGenerations: {
          ...state.documentGenerations,
          [documentId]: generation,
        },
        documentResyncEpoch: {
          ...state.documentResyncEpoch,
          [documentId]: (state.documentResyncEpoch[documentId] ?? 0) + 1,
        },
        openTabs: state.openTabs.map((tab) =>
          tab.fileId === documentId ? { ...tab, dirty: false } : tab,
        ),
        saveStatus:
          state.activeFileId === documentId ? "saved" : state.saveStatus,
      };
    });
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

  addNotification: (notification) => {
    set((state) => {
      const entry: AppNotification = {
        ...notification,
        id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
      };
      // Newest first; cap the list so it can't grow unbounded over a session.
      return { notifications: [entry, ...state.notifications].slice(0, MAX_NOTIFICATIONS) };
    });
  },

  clearNotifications: () => set({ notifications: [] }),

  setCollaborators: (collaborators) => set({ collaborators }),

  setCurrentUser: (user) => set({ currentUser: user }),

  setUserRole: (role) => set({ userRole: role }),

  setMemberRoles: (roles) => set({ memberRoles: roles }),

  toggleTerminal: () => set((state) => ({ isTerminalOpen: !state.isTerminalOpen })),

  setTerminalOpen: (open) => set({ isTerminalOpen: open }),

  setTerminalStatus: (status) => set({ terminalStatus: status }),

  setTerminalSyncStatus: (status) => set({ terminalSyncStatus: status }),

  setWorkspaceName: (name) => set({ workspaceName: name }),

  setDiagnosticCounts: (counts) => {
    const current = get().diagnosticCounts;
    if (current.errors === counts.errors && current.warnings === counts.warnings) return;
    set({ diagnosticCounts: counts });
  },

  // ── Save / backend / socket actions ───────────────────────────────────────

  setSaveStatus: (status) => set({ saveStatus: status }),

  setBackendStatus: (status) => set({ backendStatus: status }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  setWorkspaceId: (id) => set({ workspaceId: id }),

  resetWorkspace: () => {
    set((state) => createWorkspaceSessionState(state.theme));
  },

  addFileNode: (file, content) => {
    set((state) => {
      const isLocal = (id: string): boolean => id.startsWith("local-");

      const existingIdx = state.files.findIndex(
        (f) => f.kind === "file" && (f.id === file.id || f.name === file.name),
      );

      if (existingIdx >= 0) {
        const existing = state.files[existingIdx]!;
        // Never downgrade a real backend id to a local placeholder id.
        // This prevents a double-submit race (Enter+blur) from replacing the
        // first real-id node with the fallback local-id from the second call.
        if (isLocal(file.id) && !isLocal(existing.id)) {
          return state;
        }
        // Replace (upgrade local → real, or same-id re-add).
        const newFiles = state.files.map((f, i) => (i === existingIdx ? file : f));
        return {
          files: newFiles,
          editorContentByFileId: { ...state.editorContentByFileId, [file.id]: content },
          openTabs: state.openTabs.some((t) => t.fileId === file.id)
            ? state.openTabs
            : [
                ...state.openTabs,
                { fileId: file.id, name: file.name, language: file.language, dirty: content.length > 0 },
              ],
          activeFileId: file.id,
          saveStatus: content.length > 0 ? ("unsaved" as const) : ("saved" as const),
        };
      }

      return {
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
      };
    });
  },

  addFolderNode: (folder) => {
    set((state) => {
      const existingIdx = state.files.findIndex(
        (f) => f.kind === "folder" && (f.id === folder.id || f.name === folder.name),
      );
      if (existingIdx >= 0) return state;
      return { files: [...state.files, folder] };
    });
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
        files: mergeFileTrees(state.files, nodes),
        editorContentByFileId: { ...state.editorContentByFileId, ...contentMap },
        openTabs: newTabs,
        activeFileId: firstFileId ?? state.activeFileId,
      };
    });
  },

  batchLoadBackend: ({ files, editorContent, defaultFileId }) => {
    set(() => {
      const file = defaultFileId !== null ? findFileInTree(files, defaultFileId) : null;
      const openTabs =
        file !== null
          ? [{ fileId: file.id, name: file.name, language: file.language, dirty: false }]
          : [];

      return {
        files,
        editorContentByFileId: editorContent,
        openTabs,
        activeFileId: file?.id ?? null,
        cursorPosition: { line: 1, column: 1 },
        diagnosticCounts: { errors: 0, warnings: 0 },
        saveStatus: "saved" as const,
      };
    });
  },
}));
