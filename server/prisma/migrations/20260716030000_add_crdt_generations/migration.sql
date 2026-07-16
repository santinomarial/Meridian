-- CRDT generation fencing: each Document has a lineage counter. Version
-- restore increments it under the document advisory lock and replaces the
-- Yjs history with a new generation. Persistence writes tagged with a
-- different generation are rejected so stale replicas cannot resurrect
-- pre-restore state.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "crdtGeneration" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DocumentUpdate" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Snapshot" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0;

-- DropIndex (old seq uniqueness was per-document; it is now per-lineage)
DROP INDEX "DocumentUpdate_documentId_seq_key";

-- DropIndex
DROP INDEX "DocumentUpdate_documentId_seq_idx";

-- DropIndex
DROP INDEX "Snapshot_documentId_seq_idx";

-- CreateIndex
CREATE UNIQUE INDEX "DocumentUpdate_documentId_generation_seq_key" ON "DocumentUpdate"("documentId", "generation", "seq");

-- CreateIndex
CREATE INDEX "DocumentUpdate_documentId_generation_seq_idx" ON "DocumentUpdate"("documentId", "generation", "seq");

-- CreateIndex
CREATE INDEX "Snapshot_documentId_generation_seq_idx" ON "Snapshot"("documentId", "generation", "seq");
