import { Allow, IsString } from 'class-validator';

export class AwarenessUpdateDto {
  @IsString()
  documentId!: string;

  // Binary awareness protocol update (Uint8Array/Buffer from client).
  // @Allow keeps the field through whitelist stripping without running a
  // type-specific validator — the handler converts it to Uint8Array safely.
  @Allow()
  update!: unknown;
}
