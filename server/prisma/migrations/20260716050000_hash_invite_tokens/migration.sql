-- Invite tokens are hashed at rest (SHA-256) and become single-use on accept.
-- Existing plaintext tokens cannot be recovered; outstanding invites are cleared.

DELETE FROM "Invite";

ALTER TABLE "Invite" RENAME COLUMN "token" TO "tokenHash";
