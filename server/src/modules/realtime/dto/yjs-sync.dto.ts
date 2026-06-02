import { Allow, IsString } from 'class-validator';

export class YjsSyncDto {
  @IsString()
  documentId!: string;

  // Encoded sync protocol message (Uint8Array/Buffer).
  // @Allow keeps the field through whitelist stripping without type validation —
  // the handler decodes the message using lib0/decoding.
  @Allow()
  message!: unknown;
}
