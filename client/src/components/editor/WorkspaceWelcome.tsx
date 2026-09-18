import { useRef, useState, type FormEvent } from "react";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useFileOperations } from "../../hooks/useFileOperations";
import type { FileNode } from "../../types";
import { focusRing } from "../ui/styles";
import { toast } from "../ui/Toast";

function fileShortcuts(nodes: FileNode[], parent = ""): { id: string; path: string }[] {
  return nodes.flatMap((node) => {
    const path = parent ? `${parent}/${node.name}` : node.name;
    return node.kind === "file" ? [{ id: node.id, path }] : fileShortcuts(node.children, path);
  });
}

export function WorkspaceWelcome() {
  const files = useWorkspaceStore((state) => state.files);
  const name = useWorkspaceStore((state) => state.workspaceName);
  const role = useWorkspaceStore((state) => state.userRole);
  const backendStatus = useWorkspaceStore((state) => state.backendStatus);
  const openFile = useWorkspaceStore((state) => state.openFile);
  const setShareRequested = useWorkspaceStore((state) => state.setShareRequested);
  const { createFile, importZip, isImporting } = useFileOperations();
  const [filename, setFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const busy = useRef(false);
  const zipInput = useRef<HTMLInputElement>(null);
  const canEdit = backendStatus === "available" && (role === "OWNER" || role === "EDITOR");
  const shortcuts = fileShortcuts(files);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || busy.current) return;
    busy.current = true;
    setCreating(true);
    setError(null);
    try {
      const result = await createFile(filename);
      if (result.error) setError(result.error);
    } finally {
      busy.current = false;
      setCreating(false);
    }
  }

  return (
    <section className="meridian-editor-chrome min-h-0 flex-1 overflow-y-auto border-t meridian-crisp-border" aria-labelledby="workspace-welcome-title" data-testid="workspace-welcome">
      <div className="mx-auto w-full max-w-[560px] px-6 py-12 sm:px-10 sm:py-20">
        <p className="mb-3 font-mono text-xs text-on-surface-variant">Workspace</p>
        <h1 id="workspace-welcome-title" className="break-words text-2xl font-medium tracking-tight text-on-surface">{name ?? "Your workspace"}</h1>
        <p className="mt-3 text-sm leading-6 text-on-surface-variant">
          {shortcuts.length > 0
            ? "Choose a file to pick up where you left off."
            : canEdit
              ? "Start with a file or bring in a project."
              : "An editor can add the first file. It will appear here when it’s ready."}
        </p>

        {shortcuts.length > 0 && (
          <div className="mt-7">
            <h2 className="mb-2 text-xs font-medium text-on-surface-variant">Open a file</h2>
            <ul className="divide-y divide-outline-variant/40">
              {shortcuts.slice(0, 6).map((file) => (
                <li key={file.id}>
                  <button type="button" onClick={() => openFile(file.id)} className={`w-full break-all rounded py-3 text-left font-mono text-sm text-on-surface hover:text-primary ${focusRing}`}>
                    {file.path}
                  </button>
                </li>
              ))}
            </ul>
            {shortcuts.length > 6 && <p className="mt-2 text-xs text-on-surface-variant">All {shortcuts.length} files are available in the explorer.</p>}
          </div>
        )}

        {canEdit && (
          <div className="mt-8 border-t meridian-crisp-border pt-6">
            <form onSubmit={(event) => void handleCreate(event)}>
              <label htmlFor="welcome-filename" className="mb-2 block text-sm font-medium">{shortcuts.length ? "Create another file" : "Create your first file"}</label>
              <div className="flex flex-wrap gap-2">
                <input id="welcome-filename" value={filename} onChange={(event) => { setFilename(event.target.value); setError(null); }} placeholder="e.g. main.ts" autoComplete="off" spellCheck={false} required disabled={creating || isImporting}
                  aria-invalid={error !== null} aria-describedby={error ? "welcome-file-error" : undefined}
                  className={`min-w-0 flex-[1_1_160px] rounded border meridian-crisp-border bg-surface-container-lowest px-3 py-2.5 font-mono text-base sm:text-sm ${focusRing}`} />
                <button type="submit" disabled={creating || isImporting || !filename.trim()} className={`min-h-11 rounded bg-primary-container px-4 text-sm font-medium text-on-primary-container disabled:opacity-50 ${focusRing}`}>
                  {creating ? "Creating…" : "Create file"}
                </button>
              </div>
              {error && <p id="welcome-file-error" role="alert" className="mt-2 text-sm text-error">{error}</p>}
            </form>
            <input ref={zipInput} type="file" accept=".zip" hidden onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file || !canEdit || busy.current) return;
              busy.current = true;
              setError(null);
              try {
                const result = await importZip(file);
                if (result.error) toast(result.error, "info");
              } finally {
                busy.current = false;
              }
            }} />
            <button type="button" onClick={() => zipInput.current?.click()} disabled={creating || isImporting} className={`mt-3 min-h-11 rounded text-sm text-primary underline-offset-4 hover:underline disabled:opacity-50 ${focusRing}`}>
              {isImporting ? "Importing project…" : "Import a ZIP archive"}
            </button>
          </div>
        )}

        {role === "OWNER" && backendStatus === "available" && (
          <div className="mt-8 border-t meridian-crisp-border pt-5">
            <button type="button" onClick={() => setShareRequested(true)} className={`min-h-11 rounded text-sm font-medium text-primary underline-offset-4 hover:underline ${focusRing}`}>Invite teammates</button>
            <p className="text-xs leading-5 text-on-surface-variant">Choose who can edit and who can view this workspace.</p>
          </div>
        )}
      </div>
    </section>
  );
}
