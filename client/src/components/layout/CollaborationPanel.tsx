import { useEffect, useRef, useState } from "react";
import { MERIDIAN_BRAND } from "../../constants/brand";
import { MaterialIcon } from "../ui/MaterialIcon";
import { PanelSkeleton } from "../ui/Skeleton";
import {
  focusRing,
  iconButtonMutedClass,
  panelHeaderClass,
  panelSectionLabel,
  transitionBase,
} from "../ui/styles";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { mockCollaborators } from "../../data/mock";
import { getSocket } from "../../lib/socket";
import { colorForUser } from "../../lib/collabColors";
import type { ChatMessage, Collaborator } from "../../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function DemoBadge() {
  return (
    <span className="rounded bg-surface-container-highest px-1 py-px text-[8px] font-bold uppercase tracking-wider text-on-surface-variant">
      demo
    </span>
  );
}

// ── Collaborator row ──────────────────────────────────────────────────────────

function CollaboratorRow({ collaborator }: { collaborator: Collaborator }) {
  const isActive = collaborator.status === "active";

  return (
    <li
      className={[
        "group flex items-center gap-2 rounded-md px-2 py-1.5",
        transitionBase,
        "hover:bg-surface-container-high/80",
      ].join(" ")}
    >
      <div className="relative shrink-0">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-bold text-on-primary"
          style={{ backgroundColor: collaborator.color }}
        >
          {getInitials(collaborator.name)}
        </span>
        <span
          className={[
            "absolute -bottom-px -right-px h-2 w-2 rounded-full border border-surface-container-low",
            isActive ? "bg-emerald-500" : "bg-outline-variant",
          ].join(" ")}
          aria-hidden
        />
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1">
          <span className="truncate text-[12px] font-semibold text-on-surface">{collaborator.name}</span>
          {collaborator.role === "OWNER" ? (
            <span className="shrink-0 rounded bg-primary/12 px-1 py-px text-[8px] font-bold uppercase text-primary">
              Owner
            </span>
          ) : collaborator.role === "EDITOR" ? (
            <span className="shrink-0 rounded bg-secondary/12 px-1 py-px text-[8px] font-bold uppercase text-secondary">
              Editor
            </span>
          ) : collaborator.role === "VIEWER" ? (
            <span className="shrink-0 rounded bg-outline/20 px-1 py-px text-[8px] font-bold uppercase text-on-surface-variant">
              Viewer
            </span>
          ) : collaborator.isOwner ? (
            <span className="shrink-0 rounded bg-primary/12 px-1 py-px text-[8px] font-bold uppercase text-primary">
              Owner
            </span>
          ) : null}
        </div>
        <p className="truncate text-[10px] text-on-surface-variant">{collaborator.activity}</p>
      </div>
    </li>
  );
}

// ── Chat message ──────────────────────────────────────────────────────────────

function ChatMessageLine({ message }: { message: ChatMessage }) {
  return (
    <p className="px-1 py-0.5 text-[11px] leading-[1.5] text-on-surface">
      <span className="font-semibold" style={{ color: message.senderColor }}>
        {message.senderName}:
      </span>{" "}
      {message.text}
    </p>
  );
}

// ── Live chat section ─────────────────────────────────────────────────────────

function LiveChatSection({ isDemoMode }: { isDemoMode: boolean }) {
  const [draft, setDraft] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const chatMessages = useWorkspaceStore((s) => s.chatMessages);
  const addChatMessage = useWorkspaceStore((s) => s.addChatMessage);
  const connectionStatus = useWorkspaceStore((s) => s.connectionStatus);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const currentUser = useWorkspaceStore((s) => s.currentUser);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [chatMessages]);

  const sendMessage = (): void => {
    const text = draft.trim();
    if (!text) return;

    const isLive =
      !isDemoMode && connectionStatus === "connected" && workspaceId !== null;

    // Show our own message immediately; when live, the server relays it to
    // everyone else in the workspace room.
    addChatMessage({
      id: `msg-${Date.now()}-local`,
      senderId: currentUser?.id ?? "user-you",
      senderName: currentUser?.displayName ?? "You",
      senderColor:
        currentUser !== null ? colorForUser(currentUser.id) : MERIDIAN_BRAND,
      text,
      timestamp: Date.now(),
    });
    if (isLive) {
      getSocket().emit("chat:message", { workspaceId, text });
    }
    setDraft("");
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col meridian-crisp-border border-t">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <h2 className={panelSectionLabel}>{isDemoMode ? "Chat" : "Live Chat"}</h2>
        {isDemoMode ? <DemoBadge /> : null}
      </div>

      <div ref={feedRef} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-1">
        {chatMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <MaterialIcon
              name="chat_bubble_outline"
              className="text-[22px] text-on-surface-variant/30"
              aria-hidden
            />
            <p className="mt-1.5 text-[11px] text-on-surface-variant">No messages yet.</p>
            <p className="text-[10px] text-on-surface-variant/70">Start the conversation.</p>
          </div>
        ) : (
          chatMessages.map((m) => <ChatMessageLine key={m.id} message={m} />)
        )}
      </div>

      {isDemoMode ? (
        <p className="shrink-0 px-3 py-1 text-[10px] text-on-surface-variant/50">
          Demo mode — messages are local only.
        </p>
      ) : null}

      <div className="flex shrink-0 items-center gap-1.5 meridian-crisp-border border-t p-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Send a message…"
          className={[
            "min-w-0 flex-1 rounded-md meridian-crisp-border border bg-surface-container-lowest px-2 py-1 text-[11px] text-on-surface outline-none",
            "placeholder:text-on-surface-variant/60 focus:border-primary/50 focus:ring-1 focus:ring-primary/20",
            focusRing,
          ].join(" ")}
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={!draft.trim()}
          className={[iconButtonMutedClass, "disabled:opacity-30"].join(" ")}
          aria-label="Send message"
        >
          <MaterialIcon name="send" className="text-[16px]" aria-hidden />
        </button>
      </div>
    </section>
  );
}

// ── Panel content ─────────────────────────────────────────────────────────────

function CollaborationPanelContent({
  isLoading,
  onClose,
  showCloseButton,
}: {
  isLoading: boolean;
  onClose?: () => void;
  showCloseButton: boolean;
}) {
  const collaborators = useWorkspaceStore((s) => s.collaborators);
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);

  const isDemoMode = backendStatus === "unavailable";
  const isConnected = backendStatus === "available";

  // In demo mode show mock collaborators clearly labelled; in real mode show
  // whatever has been populated via socket presence (may be empty).
  const displayCollaborators: Collaborator[] = isDemoMode ? mockCollaborators : collaborators;

  return (
    <>
      {/* Panel header */}
      <div className={panelHeaderClass}>
        <div className="flex items-center gap-1.5">
          <span
            className={[
              "h-1.5 w-1.5 rounded-full",
              isConnected ? "bg-emerald-500" : "bg-outline-variant",
            ].join(" ")}
            aria-hidden
          />
          <h2 className={panelSectionLabel}>
            {isDemoMode ? "Demo Collaborators" : "Collaborators"}
          </h2>
          {isDemoMode ? <DemoBadge /> : null}
        </div>
        {showCloseButton && onClose !== undefined ? (
          <button
            type="button"
            onClick={onClose}
            className={iconButtonMutedClass}
            aria-label="Close panel"
          >
            <MaterialIcon name="close" className="text-[16px]" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* Collaborator list */}
      {isLoading ? (
        <PanelSkeleton rows={2} className="px-2 py-1" />
      ) : displayCollaborators.length > 0 ? (
        <ul className="max-h-[8.5rem] shrink-0 space-y-px overflow-y-auto px-1 py-1.5">
          {displayCollaborators.map((c) => (
            <CollaboratorRow key={c.id} collaborator={c} />
          ))}
        </ul>
      ) : isConnected ? (
        <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-3 py-5 text-center" data-testid="collab-no-collaborators">
          <MaterialIcon
            name="group_add"
            className="text-[22px] text-on-surface-variant/30"
            aria-hidden
          />
          <p className="text-[11px] text-on-surface-variant">No collaborators yet.</p>
          <p className="text-[10px] text-on-surface-variant/70">
            Use <strong className="font-semibold">Share</strong> to invite someone.
          </p>
        </div>
      ) : (
        // backendStatus === "pending" — isLoading covers this in practice
        <div className="shrink-0 px-1 py-1.5">
          <PanelSkeleton rows={2} />
        </div>
      )}

      <LiveChatSection isDemoMode={isDemoMode} />
    </>
  );
}

// ── Exported component ────────────────────────────────────────────────────────

export function CollaborationPanel({
  isLoading = false,
  mode = "inline",
  onClose,
}: {
  isLoading?: boolean;
  mode?: "inline" | "drawer";
  onClose?: () => void;
}) {
  if (mode === "drawer") {
    return (
      <aside className="meridian-panel flex h-full w-full flex-col" aria-label="Collaboration" data-testid="collaboration-panel">
        <CollaborationPanelContent isLoading={isLoading} onClose={onClose} showCloseButton />
      </aside>
    );
  }

  return (
    <aside
      className="meridian-panel flex h-full w-60 shrink-0 flex-col meridian-crisp-border border-l"
      aria-label="Collaboration"
      data-testid="collaboration-panel"
    >
      <CollaborationPanelContent isLoading={isLoading} showCloseButton={false} />
    </aside>
  );
}
