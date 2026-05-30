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
import type { ChatMessage, Collaborator, ReviewNote } from "../../types";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

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
          {collaborator.isOwner ? (
            <span className="shrink-0 rounded bg-primary/12 px-1 py-px text-[8px] font-bold uppercase text-primary">
              Owner
            </span>
          ) : null}
        </div>
        <p className="truncate text-[10px] text-on-surface-variant">{collaborator.activity}</p>
      </div>
      <button
        type="button"
        className={[
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0",
          transitionBase,
          "group-hover:opacity-100 hover:bg-surface-container-highest hover:text-primary",
          focusRing,
        ].join(" ")}
        aria-label={`Chat with ${collaborator.name}`}
      >
        <MaterialIcon name="chat" className="text-[15px]" aria-hidden />
      </button>
    </li>
  );
}

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

function LiveChatSection() {
  const [draft, setDraft] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const chatMessages = useWorkspaceStore((s) => s.chatMessages);
  const addChatMessage = useWorkspaceStore((s) => s.addChatMessage);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [chatMessages]);

  const sendMessage = (): void => {
    const text = draft.trim();
    if (!text) return;
    addChatMessage({
      id: `msg-${Date.now()}`,
      senderId: "user-you",
      senderName: "You",
      senderColor: MERIDIAN_BRAND,
      text,
      timestamp: Date.now(),
    });
    setDraft("");
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col meridian-crisp-border border-t">
      <div className="px-3 py-2">
        <h2 className={panelSectionLabel}>Live Chat</h2>
      </div>
      <div ref={feedRef} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-1">
        {chatMessages.map((m) => (
          <ChatMessageLine key={m.id} message={m} />
        ))}
      </div>
      <div className="flex items-center gap-1.5 meridian-crisp-border border-t p-2">
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

function ReviewNoteCard({ note }: { note: ReviewNote }) {
  return (
    <li
      className={[
        "rounded-md meridian-crisp-border border border-l-2 bg-surface-container-lowest px-2 py-1.5",
        note.severity === "error" ? "border-l-error" : "border-l-secondary",
      ].join(" ")}
    >
      <p className="text-[10px] font-semibold text-on-surface">{note.title}</p>
      <p className="mt-0.5 text-[9px] leading-snug text-on-surface-variant">
        {note.line > 0 ? `L${note.line}: ` : ""}
        {note.description}
      </p>
    </li>
  );
}

function ReviewNotesSection() {
  const reviewNotes = useWorkspaceStore((s) => s.reviewNotes);

  return (
    <section className="shrink-0 meridian-crisp-border border-t bg-surface-container-low">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className={panelSectionLabel}>Review Notes</h2>
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[8px] font-bold text-on-error">
          {reviewNotes.length}
        </span>
      </div>
      <ul className="max-h-28 space-y-1 overflow-y-auto px-2 pb-2">
        {reviewNotes.map((note) => (
          <ReviewNoteCard key={note.id} note={note} />
        ))}
      </ul>
    </section>
  );
}

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

  return (
    <>
      <div className={panelHeaderClass}>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          <h2 className={panelSectionLabel}>Collaborators</h2>
        </div>
        {showCloseButton && onClose ? (
          <button type="button" onClick={onClose} className={iconButtonMutedClass} aria-label="Close panel">
            <MaterialIcon name="close" className="text-[16px]" aria-hidden />
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <PanelSkeleton rows={2} className="px-2 py-1" />
      ) : (
        <ul className="max-h-[8.5rem] shrink-0 space-y-px overflow-y-auto px-1 py-1.5">
          {collaborators.map((c) => (
            <CollaboratorRow key={c.id} collaborator={c} />
          ))}
        </ul>
      )}

      <LiveChatSection />
      <ReviewNotesSection />
    </>
  );
}

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
      <aside className="meridian-panel flex h-full w-full flex-col" aria-label="Collaboration">
        <CollaborationPanelContent isLoading={isLoading} onClose={onClose} showCloseButton />
      </aside>
    );
  }

  return (
    <aside
      className="meridian-panel flex h-full w-60 shrink-0 flex-col meridian-crisp-border border-l"
      aria-label="Collaboration"
    >
      <CollaborationPanelContent isLoading={isLoading} showCloseButton={false} />
    </aside>
  );
}
