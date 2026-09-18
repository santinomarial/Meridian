/**
 * Deterministic collaborator colors: the same user id always maps to the
 * same color on every client, with no coordination needed.
 */
// Initials and cursor labels identify peers alongside the restrained palette.
const COLLAB_PALETTE = [
  "#a51c30", "#737373", "#821626", "#525252",
  "#ba3448", "#666666", "#713442", "#404040",
] as const;

export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return COLLAB_PALETTE[Math.abs(hash) % COLLAB_PALETTE.length]!;
}
