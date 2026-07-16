import { Allow, IsString, MaxLength, MinLength } from 'class-validator';

export class YjsUpdateDto {
  @IsString()
  documentId!: string;

  /**
   * Client-generated idempotency key. Required for durable acknowledgements:
   * the server persists under this id and acks only after PostgreSQL commit.
   * Resends of the same updateId are idempotent.
   */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  updateId!: string;

  // Binary data (Buffer on server, ArrayBuffer/Uint8Array from client).
  // @Allow keeps the field through whitelist stripping without applying
  // type-specific validation — the handler converts it to Uint8Array safely.
  @Allow()
  update!: unknown;
}
