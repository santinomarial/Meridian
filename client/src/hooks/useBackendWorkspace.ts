import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError, createWorkspace, getCurrentUser, getDocumentTree, getWorkspaces, getWorkspaceMembers } from "../lib/api";
import { buildFileNodes, collectFileContent } from "../lib/documentTree";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import type { ApiUser } from "../lib/apiTypes";
import type { FileNode } from "../types";

interface FlatFile {
  id: string;
  name: string;
}

function collectFlatFiles(nodes: FileNode[], acc: FlatFile[]): void {
  for (const node of nodes) {
    if (node.kind === "file") acc.push({ id: node.id, name: node.name.toLowerCase() });
    else collectFlatFiles(node.children, acc);
  }
}

function findPreferredFileId(nodes: FileNode[]): string | null {
  const files: FlatFile[] = [];
  collectFlatFiles(nodes, files);
  return (
    files.find((f) => f.name === "readme.md")?.id ??
    files.find((f) => f.name === "package.json")?.id ??
    files[0]?.id ??
    null
  );
}

export function useBackendWorkspace(): void {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const requestedWorkspaceId = workspaceId ?? null;
  const workspaceLoadEpoch = useWorkspaceStore((s) => s.workspaceLoadEpoch);

  useEffect(() => {
    let cancelled = false;
    useWorkspaceStore.getState().resetWorkspace();

    async function load(): Promise<void> {
      try {
        // Auth check — captures user.id for workspace auto-create.
        let currentUser: ApiUser | null = null;
        try {
          currentUser = await getCurrentUser();
        } catch (err) {
          // A 401 means the backend is reachable but the session is missing or
          // expired — a normal state after time away. Treat the user as logged
          // out and send them to the login screen instead of pretending the
          // backend is down. Network errors fall through to the unavailable gate.
          if (err instanceof ApiError && err.status === 401) {
            if (!cancelled) navigate("/", { replace: true });
            return;
          }
          // Do not load a workspace with missing identity, role, or capabilities.
          // The unavailable gate lets the user retry the complete session load.
          throw err;
        }
        if (cancelled) return;
        useWorkspaceStore.setState({ terminalEnabled: currentUser?.capabilities?.terminal === true });
        useWorkspaceStore.getState().setCurrentUser(
          currentUser !== null
            ? {
                id: currentUser.id,
                email: currentUser.email,
                displayName: currentUser.displayName,
              }
            : null,
        );

        const workspaces = await getWorkspaces();
        if (cancelled) return;

        let workspace =
          requestedWorkspaceId !== null
            ? workspaces.find((w) => w.id === requestedWorkspaceId)
            : (workspaces.find((w) => w.name.toLowerCase().includes("meridian")) ??
              workspaces[0]);

        // A deep link should never silently open a different workspace. Return
        // to the default selector if the requested workspace is unavailable.
        if (workspace === undefined && requestedWorkspaceId !== null) {
          navigate("/workspace", { replace: true });
          return;
        }

        // Auto-create a default workspace when the user is authenticated
        // but has no workspaces yet (fresh account).
        if (workspace === undefined && currentUser !== null) {
          try {
            workspace = await createWorkspace({
              name: "My Workspace",
              ownerId: currentUser.id,
            });
          } catch {
            // backend refused — fall through to unavailable
          }
        }

        if (workspace === undefined) {
          useWorkspaceStore.getState().setBackendStatus("unavailable");
          return;
        }

        useWorkspaceStore.getState().setWorkspaceId(workspace.id);
        useWorkspaceStore.getState().setWorkspaceName(workspace.name);

        // Fetch members to populate role state for permission enforcement.
        if (currentUser !== null) {
          try {
            const members = await getWorkspaceMembers(workspace.id);
            if (!cancelled) {
              const memberRoles = Object.fromEntries(
                members.map((m) => [m.userId, m.role] as const),
              ) as Record<string, "OWNER" | "EDITOR" | "VIEWER">;
              const myRole = members.find((m) => m.userId === currentUser.id)?.role ?? null;
              useWorkspaceStore.getState().setMemberRoles(memberRoles);
              useWorkspaceStore.getState().setUserRole(myRole);
            }
          } catch {
            // non-fatal — permissions degrade gracefully
          }
        }

        const tree = await getDocumentTree(workspace.id);
        if (cancelled) return;

        const files = buildFileNodes(tree);
        const editorContent: Record<string, string> = {};
        collectFileContent(tree, editorContent);
        const defaultFileId = findPreferredFileId(files);

        useWorkspaceStore.getState().batchLoadBackend({ files, editorContent, defaultFileId });
        useWorkspaceStore.getState().setBackendStatus("available");
      } catch {
        if (!cancelled) {
          useWorkspaceStore.getState().setBackendStatus("unavailable");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [navigate, requestedWorkspaceId, workspaceLoadEpoch]);
}
