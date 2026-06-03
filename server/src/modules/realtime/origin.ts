import { v4 as uuidv4 } from 'uuid';

// Stable per-process identifier generated once at module load time.
// Stamped on every outbound Redis message so sibling backend instances can
// discard messages that originated from themselves, preventing:
//   - double-apply of Yjs updates (originating instance already applied them)
//   - self-echo of awareness states
export const ORIGIN_ID: string = uuidv4();
