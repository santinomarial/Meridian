import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./useWorkspaceStore";

describe("workspace session boundaries", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ theme: "dark" });
    useWorkspaceStore.getState().resetWorkspace();
  });

  it("clears account and workspace data while preserving the theme", () => {
    useWorkspaceStore.setState({
      workspaceId: "private-workspace",
      workspaceName: "Private Workspace",
      currentUser: {
        id: "private-user",
        email: "private@example.com",
        displayName: "Private User",
      },
      userRole: "OWNER",
      memberRoles: { "private-user": "OWNER" },
      files: [
        { kind: "file", id: "secret-file", name: "secret.ts", language: "typescript" },
      ],
      activeFileId: "secret-file",
      openTabs: [
        {
          fileId: "secret-file",
          name: "secret.ts",
          language: "typescript",
          dirty: true,
        },
      ],
      editorContentByFileId: { "secret-file": "sensitive content" },
      collaborators: [
        {
          id: "private-user",
          name: "Private User",
          color: "#000",
          status: "active",
          activity: "Editing secret.ts",
          isOwner: true,
        },
      ],
      chatMessages: [
        {
          id: "secret-message",
          senderId: "private-user",
          senderName: "Private User",
          senderColor: "#000",
          text: "sensitive message",
          timestamp: 1,
        },
      ],
      notifications: [
        { id: "secret-notification", icon: "warning", text: "Sensitive", timestamp: 1 },
      ],
      diagnosticCounts: { errors: 3, warnings: 2 },
      isSettingsOpen: true,
      isVersionHistoryOpen: true,
      isCommandPaletteOpen: true,
      shareRequested: true,
      cursorPosition: { line: 20, column: 4 },
      saveStatus: "error",
      isTerminalOpen: true,
      terminalStatus: "running",
      terminalSyncStatus: "syncing",
      backendStatus: "available",
      connectionStatus: "connected",
      theme: "light",
    });

    useWorkspaceStore.getState().resetWorkspace();
    const state = useWorkspaceStore.getState();

    expect(state).toMatchObject({
      workspaceId: null,
      workspaceName: null,
      currentUser: null,
      userRole: null,
      memberRoles: {},
      collaborators: [],
      chatMessages: [],
      notifications: [],
      diagnosticCounts: { errors: 0, warnings: 0 },
      isSettingsOpen: false,
      isVersionHistoryOpen: false,
      isCommandPaletteOpen: false,
      shareRequested: false,
      cursorPosition: { line: 1, column: 1 },
      saveStatus: "saved",
      isTerminalOpen: false,
      terminalStatus: "idle",
      terminalSyncStatus: null,
      backendStatus: "pending",
      connectionStatus: "disconnected",
      theme: "light",
    });
    expect(state.activeFileId).toBe("file-auth");
    expect(state.editorContentByFileId).not.toHaveProperty("secret-file");
    expect(state.openTabs).not.toContainEqual(expect.objectContaining({ fileId: "secret-file" }));
  });

  it("treats an empty backend workspace as authoritative", () => {
    useWorkspaceStore.getState().batchLoadBackend({
      files: [],
      editorContent: {},
      defaultFileId: null,
    });

    const state = useWorkspaceStore.getState();
    expect(state.files).toEqual([]);
    expect(state.editorContentByFileId).toEqual({});
    expect(state.openTabs).toEqual([]);
    expect(state.activeFileId).toBeNull();
    expect(state.saveStatus).toBe("saved");
  });

  it("merges imported children into an existing folder", () => {
    useWorkspaceStore.getState().batchLoadBackend({
      files: [
        {
          kind: "folder",
          id: "folder-src",
          name: "src",
          expanded: true,
          children: [
            { kind: "file", id: "file-a", name: "a.ts", language: "typescript" },
          ],
        },
      ],
      editorContent: { "file-a": "export const a = 1;" },
      defaultFileId: "file-a",
    });

    useWorkspaceStore.getState().importFiles(
      [
        {
          kind: "folder",
          id: "folder-src",
          name: "src",
          expanded: true,
          children: [
            { kind: "file", id: "file-b", name: "b.ts", language: "typescript" },
          ],
        },
      ],
      { "file-b": "export const b = 2;" },
      "file-b",
    );

    const [src] = useWorkspaceStore.getState().files;
    expect(src).toMatchObject({
      kind: "folder",
      id: "folder-src",
      children: [
        { id: "file-a", name: "a.ts" },
        { id: "file-b", name: "b.ts" },
      ],
    });
    expect(useWorkspaceStore.getState().activeFileId).toBe("file-b");
  });
});
