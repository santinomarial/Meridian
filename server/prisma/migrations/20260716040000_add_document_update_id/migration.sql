-- Durable collaboration acknowledgements: client-generated updateId for
-- idempotent persistence. Resent updates with the same (document, generation,
-- updateId) must not allocate a second sequence number.

-- AlterTable
ALTER TABLE "DocumentUpdate" ADD COLUMN "updateId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DocumentUpdate_documentId_generation_updateId_key" ON "DocumentUpdate"("documentId", "generation", "updateId");
