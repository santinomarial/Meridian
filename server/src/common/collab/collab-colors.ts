/**
 * Deterministic collaborator colors shared by the editor gateway when it
 * overwrites client-asserted awareness identity with the authenticated user.
 */
const COLLAB_PALETTE = [
  '#e06c75',
  '#61afef',
  '#98c379',
  '#c678dd',
  '#d19a66',
  '#56b6c2',
  '#e5c07b',
  '#ec6ab1',
] as const;

export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return COLLAB_PALETTE[Math.abs(hash) % COLLAB_PALETTE.length]!;
}
