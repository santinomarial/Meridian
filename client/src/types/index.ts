export type LanguageMode =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "html"
  | "css"
  | "json";

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
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  timestamp: number;
};

export type ReviewNote = {
  id: string;
  severity: "error" | "note";
  title: string;
  description: string;
  line: number;
};

export type TerminalTab = "terminal" | "output" | "debug" | "ai";

export type ActivityItem =
  | "explorer"
  | "search"
  | "source-control"
  | "run"
  | "extensions";

export type WorkspaceTheme = "dark" | "light";

export type CursorPosition = {
  line: number;
  column: number;
};

export type SaveStatus = "saved" | "saving" | "unsaved";

export type PanelKey = "explorer" | "collaboration" | "bottom";

export type DiagnosticCounts = {
  errors: number;
  warnings: number;
};

export type WorkspaceState = {
  files: FileNode[];
  activeFileId: string | null;
  openTabs: OpenTab[];
  editorContentByFileId: Record<string, string>;
  collaborators: Collaborator[];
  chatMessages: ChatMessage[];
  reviewNotes: ReviewNote[];
  diagnosticCounts: DiagnosticCounts;
  activeTerminalTab: TerminalTab;
  selectedActivityItem: ActivityItem;
  isExplorerOpen: boolean;
  isCollaborationPanelOpen: boolean;
  isBottomPanelOpen: boolean;
  theme: WorkspaceTheme;
  cursorPosition: CursorPosition;
  saveStatus: SaveStatus;
};
