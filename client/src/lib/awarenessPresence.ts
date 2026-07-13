import type { Awareness } from "y-protocols/awareness";
import type { Collaborator } from "../types";
import { colorForUser } from "./collabColors";

/**
 * Helpers that turn Yjs awareness states into UI state:
 *  - a deduplicated collaborator list for the presence panel, and
 *  - injected CSS so y-monaco's remote selection decorations
 *    (.yRemoteSelection-<clientId> / .yRemoteSelectionHead-<clientId>)
 *    render each remote user's cursor in their color with a name tag.
 */

export type AwarenessUser = {
  id: string;
  name: string;
  color: string;
};

const REMOTE_SELECTION_STYLE_ID = "meridian-remote-selection-styles";

const SAFE_HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeAwarenessUser(
  state: Record<string, unknown>,
): AwarenessUser | null {
  const user = state["user"];
  if (typeof user !== "object" || user === null) return null;
  const { id, name, color } = user as Record<string, unknown>;
  if (typeof id !== "string" || typeof name !== "string" || typeof color !== "string") {
    return null;
  }
  const safeId = id.trim().slice(0, 128);
  if (safeId.length === 0) return null;
  const safeName =
    name
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, 80) || "Collaborator";
  const safeColor = SAFE_HEX_COLOR.test(color)
    ? color.toLowerCase()
    : colorForUser(safeId);
  return { id: safeId, name: safeName, color: safeColor };
}

/** Remote collaborators (excluding the local client), deduped by user id. */
export function collaboratorsFromAwareness(
  awareness: Awareness,
  localUserId: string | null,
  memberRoles?: Record<string, "OWNER" | "EDITOR" | "VIEWER">,
): Collaborator[] {
  const byUserId = new Map<string, Collaborator>();

  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const user = normalizeAwarenessUser(state as Record<string, unknown>);
    if (user === null) continue;
    if (localUserId !== null && user.id === localUserId) continue;

    const role = memberRoles?.[user.id];
    byUserId.set(user.id, {
      id: user.id,
      name: user.name,
      color: user.color,
      status: "active",
      activity: "Editing this file",
      isOwner: role === "OWNER",
      role,
    });
  }

  return [...byUserId.values()];
}

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) return `rgba(128, 128, 128, ${alpha})`;
  const value = parseInt(match[1]!, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeCssString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/**
 * Regenerates the stylesheet for remote selections so each awareness client
 * gets its user's color and a floating name tag on the cursor head.
 */
export function syncRemoteSelectionStyles(awareness: Awareness): void {
  let styleEl = document.getElementById(
    REMOTE_SELECTION_STYLE_ID,
  ) as HTMLStyleElement | null;
  if (styleEl === null) {
    styleEl = document.createElement("style");
    styleEl.id = REMOTE_SELECTION_STYLE_ID;
    document.head.appendChild(styleEl);
  }

  const rules: string[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const user = normalizeAwarenessUser(state as Record<string, unknown>);
    if (user === null) continue;

    rules.push(`
.yRemoteSelection-${clientId} {
  background-color: ${hexToRgba(user.color, 0.28)};
}
.yRemoteSelectionHead-${clientId} {
  position: absolute;
  border-left: 2px solid ${user.color};
  height: 100%;
  box-sizing: border-box;
}
.yRemoteSelectionHead-${clientId}::after {
  content: "${escapeCssString(user.name)}";
  position: absolute;
  top: -1.4em;
  left: -2px;
  padding: 1px 5px;
  border-radius: 3px 3px 3px 0;
  background-color: ${user.color};
  color: #ffffff;
  font-family: Geist, ui-sans-serif, system-ui, sans-serif;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
}
`);
  }

  styleEl.textContent = rules.join("\n");
}
