export type LanguageMode =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "html"
  | "css"
  | "json"
  | "java"
  | "cpp"
  | "c"
  | "markdown"
  | "yaml"
  | "sql"
  | "shell"
  | "plaintext";

export type FileNode =
  | {
      kind: "folder";
      id: string;
      name: string;
      children: FileNode[];
      expanded: boolean;
    }
  | {
      kind: "file";
      id: string;
      name: string;
      language: LanguageMode;
    };

export type EditorFile = {
  id: string;
  name: string;
  language: LanguageMode;
  content: string;
};

export type OpenTab = {
  fileId: string;
  name: string;
  language: LanguageMode;
  dirty: boolean;
};

export type Collaborator = {
  id: string;
  name: string;
  color: string;
  status: "active" | "idle";
  activity: string;
  isOwner: boolean;
  role?: "OWNER" | "EDITOR" | "VIEWER";
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  timestamp: number;
};

export type AppNotification = {
  id: string;
  icon: string;
  text: string;
  timestamp: number;
};

export type ActivityItem = "explorer" | "collaboration";

export type WorkspaceTheme = "dark" | "light";

export type CursorPosition = {
  line: number;
  column: number;
};

export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

export type TerminalStatus = "idle" | "ready" | "running" | "error" | "disabled";

export type TerminalSyncStatus = "synced" | "syncing" | "failed";

export type BackendStatus = "pending" | "available" | "unavailable";

export type PanelKey = "explorer" | "collaboration";

export type DiagnosticCounts = {
  errors: number;
  warnings: number;
};

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
};

export type WorkspaceState = {
  workspaceId: string | null;
  workspaceName: string | null;
  currentUser: CurrentUser | null;
  userRole: "OWNER" | "EDITOR" | "VIEWER" | null;
  memberRoles: Record<string, "OWNER" | "EDITOR" | "VIEWER">;
  isTerminalOpen: boolean;
  terminalSyncStatus: TerminalSyncStatus | null;
  terminalStatus: TerminalStatus;
  files: FileNode[];
  activeFileId: string | null;
  openTabs: OpenTab[];
  editorContentByFileId: Record<string, string>;
  collaborators: Collaborator[];
  chatMessages: ChatMessage[];
  notifications: AppNotification[];
  diagnosticCounts: DiagnosticCounts;
  selectedActivityItem: ActivityItem;
  isExplorerOpen: boolean;
  isCollaborationPanelOpen: boolean;
  isSettingsOpen: boolean;
  isVersionHistoryOpen: boolean;
  isCommandPaletteOpen: boolean;
  // Transient one-shot intent: set by the command palette to ask the Header to
  // open its owner-only Share panel, then immediately cleared once consumed.
  shareRequested: boolean;
  theme: WorkspaceTheme;
  cursorPosition: CursorPosition;
  saveStatus: SaveStatus;
  backendStatus: BackendStatus;
  connectionStatus: ConnectionStatus;
  /**
   * Bumped to re-run workspace bootstrap (e.g. Retry on the unavailable gate).
   */
  workspaceLoadEpoch: number;
  /**
   * Per-document CRDT generation last observed by this client. Used to ignore
   * duplicate/stale `document:restored` events after a version restore.
   */
  documentGenerations: Record<string, number>;
  /**
   * Per-document epoch bumped when a restore forces a full Yjs resynchronize.
   * `useYjsMonaco` depends on this so it tears down the old binding, discards
   * the dead lineage, and re-runs the join/sync handshake.
   */
  documentResyncEpoch: Record<string, number>;
};
