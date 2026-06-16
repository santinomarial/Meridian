/**
 * Deterministic collaborator colors: the same user id always maps to the
 * same color on every client, with no coordination needed.
 */
const COLLAB_PALETTE = [
  "#e06c75", // red
  "#61afef", // blue
  "#98c379", // green
  "#c678dd", // purple
  "#d19a66", // orange
  "#56b6c2", // teal
  "#e5c07b", // yellow
  "#ec6ab1", // pink
] as const;

export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return COLLAB_PALETTE[Math.abs(hash) % COLLAB_PALETTE.length]!;
}
