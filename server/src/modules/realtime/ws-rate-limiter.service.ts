import { Injectable } from '@nestjs/common';

interface Window {
  count: number;
  windowStart: number;
}

/**
 * Per-socket fixed-window rate limiter for WebSocket messages.
 *
 * Each socket gets its own 1-second window.  When a new message arrives:
 *  - If the window is older than 1 s, it is reset and the message passes.
 *  - Otherwise the counter is incremented and checked against the limit.
 *
 * Call `clear(socketId)` on disconnect to release memory.
 */
@Injectable()
export class WsRateLimiter {
  private readonly windows = new Map<string, Window>();

  /**
   * Returns true if the socket is within its per-second message budget.
   * Returns false (message should be dropped) when the budget is exceeded.
   */
  check(socketId: string, limitPerSecond: number): boolean {
    const now = Date.now();
    const existing = this.windows.get(socketId);

    if (existing === undefined || now - existing.windowStart >= 1_000) {
      this.windows.set(socketId, { count: 1, windowStart: now });
      return true;
    }

    existing.count += 1;
    return existing.count <= limitPerSecond;
  }

  /** Remove the socket's tracking state — must be called on disconnect. */
  clear(socketId: string): void {
    this.windows.delete(socketId);
  }

  /** Current number of tracked sockets. Exposed for testing. */
  size(): number {
    return this.windows.size;
  }
}
