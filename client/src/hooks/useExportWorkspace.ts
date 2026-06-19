import { useCallback, useState } from "react";
import { exportWorkspaceZip } from "../lib/api";
import { downloadBlob } from "../lib/download";
import { toast } from "../components/ui/Toast";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

export interface UseExportWorkspaceReturn {
  /** Exports the current workspace as a ZIP and starts a browser download. */
  exportWorkspace: () => Promise<void>;
  /** Whether export is currently possible (drives disabled UI states). */
  canExport: boolean;
  /** Reason export is unavailable, when it is. */
  disabledReason?: string;
  /** True while a download is in flight (drives loading state). */
  isExporting: boolean;
}

/**
 * Single source of truth for "export this workspace as a ZIP", shared by the
 * File menu and the command palette. The ZIP is built server-side from the
 * latest saved DB-backed documents.
 */
export function useExportWorkspace(): UseExportWorkspaceReturn {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);
  const addNotification = useWorkspaceStore((s) => s.addNotification);
  const [isExporting, setIsExporting] = useState(false);

  const canExport = workspaceId !== null && backendStatus === "available";
  const disabledReason = canExport ? undefined : "Open a workspace first";

  const exportWorkspace = useCallback(async (): Promise<void> => {
    const state = useWorkspaceStore.getState();
    const wsId = state.workspaceId;
    if (wsId === null || state.backendStatus !== "available" || isExporting) return;

    setIsExporting(true);
    try {
      const { blob, filename } = await exportWorkspaceZip(wsId);
      downloadBlob(blob, filename || `${state.workspaceName ?? "workspace"}.zip`);
      addNotification({ icon: "download", text: "Workspace export started" });
    } catch {
      toast("Could not export workspace", "error");
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, addNotification]);

  return { exportWorkspace, canExport, disabledReason, isExporting };
}
