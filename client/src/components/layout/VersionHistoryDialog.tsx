import { useCallback, useEffect, useRef, useState } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { MaterialIcon } from "../ui/MaterialIcon";
import { EmptyState } from "../ui/EmptyState";
import { toast } from "../ui/Toast";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import {
  getDocumentVersion,
  getDocumentVersions,
  restoreDocumentVersion,
} from "../../lib/api";
import type {
  ApiDocumentVersionDetail,
  ApiDocumentVersionSummary,
} from "../../lib/apiTypes";
import {
  registerMeridianMonacoThemes,
  toMeridianMonacoTheme,
} from "../editor/monacoThemes";

const DIFF_OPTIONS: editor.IDiffEditorConstructionOptions = {
  readOnly: true,
  renderSideBySide: true,
  minimap: { enabled: false },
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: 12,
  lineHeight: 18,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  renderOverviewRuler: false,
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Real version history for the active file. Everything here is backed by the
 * server's DocumentVersion records — there is no local-only or placeholder
 * history. The dialog only opens for a backend-persisted file (see the trigger
 * in Header), so we always have a real document id to query.
 */
export function VersionHistoryDialog() {
  const isOpen = useWorkspaceStore((s) => s.isVersionHistoryOpen);
  if (!isOpen) return null;
  return <VersionHistoryDialogBody />;
}

function VersionHistoryDialogBody() {
  const setOpen = useWorkspaceStore((s) => s.setVersionHistoryOpen);
  const activeFileId = useWorkspaceStore((s) => s.activeFileId);
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const editorContentByFileId = useWorkspaceStore((s) => s.editorContentByFileId);
  const userRole = useWorkspaceStore((s) => s.userRole);
  const theme = useWorkspaceStore((s) => s.theme);
  const addNotification = useWorkspaceStore((s) => s.addNotification);
  const markDocumentRestored = useWorkspaceStore((s) => s.markDocumentRestored);
  const applyRemoteFileContent = useWorkspaceStore(
    (s) => s.applyRemoteFileContent,
  );

  const canRestore = userRole === "OWNER" || userRole === "EDITOR";
  const activeTab = openTabs.find((t) => t.fileId === activeFileId);
  const language = activeTab?.language ?? "plaintext";
  const currentContent =
    activeFileId !== null ? editorContentByFileId[activeFileId] ?? "" : "";
  const monacoTheme = toMeridianMonacoTheme(theme);

  const [versions, setVersions] = useState<ApiDocumentVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] =
    useState<ApiDocumentVersionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const detailRequestId = useRef(0);

  // ── Load the version list ──────────────────────────────────────────────────
  const loadVersions = useCallback(async (): Promise<void> => {
    if (activeFileId === null) return;
    setLoading(true);
    setLoadError(null);
    try {
      const list = await getDocumentVersions(activeFileId);
      setVersions(list);
    } catch {
      setLoadError("Could not load version history. Try again.");
    } finally {
      setLoading(false);
    }
  }, [activeFileId]);

  useEffect(() => {
    // Data fetch on open / active-file change; loadVersions sets loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    return () => {
      detailRequestId.current += 1;
    };
  }, [activeFileId]);

  // ── Escape to close ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setOpen]);

  // ── Select a version → fetch its full content ───────────────────────────────
  const selectVersion = useCallback(
    async (version: ApiDocumentVersionSummary): Promise<void> => {
      if (activeFileId === null) return;
      setSelectedId(version.id);
      setConfirming(false);
      setDetailLoading(true);
      const requestId = ++detailRequestId.current;
      try {
        const detail = await getDocumentVersion(activeFileId, version.id);
        if (requestId === detailRequestId.current) setSelectedDetail(detail);
      } catch {
        if (requestId === detailRequestId.current) {
          setSelectedDetail(null);
          toast("Could not load that version.", "error");
        }
      } finally {
        if (requestId === detailRequestId.current) setDetailLoading(false);
      }
    },
    [activeFileId],
  );

  // ── Restore ─────────────────────────────────────────────────────────────────
  const handleRestore = useCallback(async (): Promise<void> => {
    if (activeFileId === null || selectedDetail === null) return;
    setRestoring(true);
    try {
      const result = await restoreDocumentVersion(activeFileId, selectedDetail.id);
      // Apply the authoritative REST response immediately as a fallback for a
      // temporarily disconnected socket. The Yjs broadcast will converge to
      // the same content for connected collaborators.
      applyRemoteFileContent(activeFileId, result.document.content ?? "");
      markDocumentRestored(activeFileId);
      addNotification({
        icon: "history",
        text: `Restored version ${result.restoredFromVersion}`,
      });
      toast(`Restored version ${result.restoredFromVersion}.`, "success");
      setConfirming(false);
      setSelectedId(null);
      setSelectedDetail(null);
      setShowDiff(false);
      await loadVersions();
    } catch {
      toast("Restore failed — your file was not changed.", "error");
    } finally {
      setRestoring(false);
    }
  }, [
    activeFileId,
    selectedDetail,
    applyRemoteFileContent,
    markDocumentRestored,
    addNotification,
    loadVersions,
  ]);

  const beforeMount = registerMeridianMonacoThemes;
  const onDiffMount: DiffOnMount = (diffEditor, monaco) => {
    monaco.editor.setTheme(monacoTheme);

    // @monaco-editor/react disposes DiffEditor models before the widget, which
    // makes Monaco throw while the widget is still observing those models.
    // Keep them through the library cleanup and release them immediately after
    // the widget itself reports disposal.
    const models = diffEditor.getModel();
    diffEditor.onDidDispose(() => {
      queueMicrotask(() => {
        for (const model of [models?.original, models?.modified]) {
          if (model && !model.isDisposed()) model.dispose();
        }
      });
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Version history"
      data-testid="version-history-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border meridian-crisp-border bg-surface-container shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b meridian-crisp-border px-4 py-3">
          <div className="flex items-center gap-2">
            <MaterialIcon name="history" className="text-[18px] text-primary" aria-hidden />
            <h2 className="text-sm font-semibold text-on-surface">
              Version History
            </h2>
            {activeTab ? (
              <span className="text-xs text-on-surface-variant">— {activeTab.name}</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="Close version history"
            data-testid="version-history-close"
          >
            <MaterialIcon name="close" className="text-[18px]" aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Version list */}
          <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r meridian-crisp-border bg-surface-container-lowest">
            {loading ? (
              <div
                className="flex flex-1 items-center justify-center p-6 text-xs text-on-surface-variant"
                data-testid="version-history-loading"
              >
                <MaterialIcon name="progress_activity" className="animate-spin text-[18px]" aria-hidden />
                <span className="ml-2">Loading versions…</span>
              </div>
            ) : loadError ? (
              <div className="p-4 text-xs text-error" data-testid="version-history-error">
                {loadError}
                <button
                  type="button"
                  onClick={() => void loadVersions()}
                  className="mt-2 block rounded bg-surface-container-high px-2 py-1 text-on-surface hover:bg-surface-container-highest"
                >
                  Retry
                </button>
              </div>
            ) : versions.length === 0 ? (
              <EmptyState
                className="flex-1"
                icon="history_toggle_off"
                title="No versions yet"
                description="Versions are captured each time you save a change to this file."
              />
            ) : (
              <ul className="py-1" data-testid="version-list">
                {versions.map((v) => {
                  const isSelected = v.id === selectedId;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => void selectVersion(v)}
                        data-testid="version-list-item"
                        data-version-number={v.versionNumber}
                        aria-current={isSelected}
                        className={[
                          "flex w-full flex-col gap-0.5 border-l-2 px-3 py-2 text-left transition-colors",
                          isSelected
                            ? "border-primary bg-surface-container-high"
                            : "border-transparent hover:bg-surface-container",
                        ].join(" ")}
                      >
                        <span className="flex items-center justify-between text-xs font-semibold text-on-surface">
                          Version {v.versionNumber}
                          {v.message ? (
                            <MaterialIcon
                              name="restore"
                              className="text-[13px] text-tertiary"
                              aria-label="Restore point"
                            />
                          ) : null}
                        </span>
                        <span className="text-[11px] text-on-surface-variant">
                          {formatTimestamp(v.createdAt)}
                          {v.createdBy ? ` · ${v.createdBy.displayName}` : ""}
                        </span>
                        {v.message ? (
                          <span className="text-[11px] italic text-on-surface-variant">
                            {v.message}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Preview / diff */}
          <section className="flex min-w-0 flex-1 flex-col">
            {selectedId === null ? (
              <EmptyState
                className="flex-1"
                icon="difference"
                title="Select a version"
                description="Choose a version on the left to preview it or compare it with the current file."
              />
            ) : detailLoading || selectedDetail === null ? (
              <div
                className="flex flex-1 items-center justify-center text-xs text-on-surface-variant"
                data-testid="version-detail-loading"
              >
                <MaterialIcon name="progress_activity" className="animate-spin text-[18px]" aria-hidden />
                <span className="ml-2">Loading version…</span>
              </div>
            ) : (
              <>
                {/* Toolbar */}
                <div className="flex items-center justify-between gap-2 border-b meridian-crisp-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDiff((d) => !d)}
                      data-testid="version-compare-toggle"
                      aria-pressed={showDiff}
                      className={[
                        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        showDiff
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest",
                      ].join(" ")}
                    >
                      <MaterialIcon name="difference" className="text-[14px]" aria-hidden />
                      {showDiff ? "Comparing with current" : "Compare with current"}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {canRestore ? (
                      confirming ? (
                        <div className="flex items-center gap-1.5" data-testid="version-restore-confirm-bar">
                          <span className="text-xs text-on-surface-variant">
                            Restore version {selectedDetail.versionNumber}?
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleRestore()}
                            disabled={restoring}
                            data-testid="version-restore-confirm"
                            className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50"
                          >
                            {restoring ? "Restoring…" : "Confirm"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirming(false)}
                            disabled={restoring}
                            data-testid="version-restore-cancel"
                            className="rounded-md bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirming(true)}
                          data-testid="version-restore-button"
                          className="inline-flex items-center gap-1.5 rounded-md border border-tertiary px-2.5 py-1 text-xs font-semibold text-tertiary transition-colors hover:bg-tertiary/10"
                        >
                          <MaterialIcon name="restore" className="text-[14px]" aria-hidden />
                          Restore this version
                        </button>
                      )
                    ) : (
                      <span
                        className="text-[11px] text-on-surface-variant"
                        data-testid="version-restore-disabled"
                      >
                        Viewer access cannot restore versions.
                      </span>
                    )}
                  </div>
                </div>

                {/* Pane labels */}
                {showDiff ? (
                  <div className="grid grid-cols-2 border-b meridian-crisp-border text-[11px] font-semibold text-on-surface-variant">
                    <span className="px-3 py-1.5">Version {selectedDetail.versionNumber}</span>
                    <span className="border-l meridian-crisp-border px-3 py-1.5">Current</span>
                  </div>
                ) : (
                  <div className="border-b meridian-crisp-border px-3 py-1.5 text-[11px] font-semibold text-on-surface-variant">
                    Version {selectedDetail.versionNumber} (read-only preview)
                  </div>
                )}

                {/* Editor */}
                <div className="min-h-0 flex-1" data-testid={showDiff ? "version-diff" : "version-preview"}>
                  <DiffEditor
                    key={selectedDetail.id}
                    height="100%"
                    language={language}
                    theme={monacoTheme}
                    original={selectedDetail.content}
                    // In preview mode both sides show the version content so the
                    // diff editor renders it read-only with no spurious changes.
                    modified={showDiff ? currentContent : selectedDetail.content}
                    options={DIFF_OPTIONS}
                    beforeMount={beforeMount}
                    onMount={onDiffMount}
                    keepCurrentOriginalModel
                    keepCurrentModifiedModel
                  />
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
