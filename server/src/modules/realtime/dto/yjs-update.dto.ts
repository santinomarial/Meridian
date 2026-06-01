import { Allow, IsString } from 'class-validator';

export class YjsUpdateDto {
  @IsString()
  documentId!: string;

  // Binary data (Buffer on server, ArrayBuffer/Uint8Array from client).
  // @Allow keeps the field through whitelist stripping without applying
  // type-specific validation — the handler converts it to Uint8Array safely.
  @Allow()
  update!: unknown;
}
