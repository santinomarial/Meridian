import { describe, expect, it, vi } from "vitest";
import {
  flushDocumentUpdates,
  registerDocumentUpdateFlusher,
} from "./yjsUpdateFlush";

describe("Yjs update flush coordination", () => {
  it("reports when an editor binding is not ready", async () => {
    await expect(flushDocumentUpdates("missing-document")).resolves.toBe(false);
  });

  it("awaits the active document flusher", async () => {
    const flusher = vi.fn(async () => undefined);
    const unregister = registerDocumentUpdateFlusher("doc-1", flusher);

    await expect(flushDocumentUpdates("doc-1")).resolves.toBe(true);
    expect(flusher).toHaveBeenCalledOnce();

    unregister();
    await expect(flushDocumentUpdates("doc-1")).resolves.toBe(false);
  });

  it("does not let stale cleanup unregister a replacement binding", async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const unregisterFirst = registerDocumentUpdateFlusher("doc-2", first);
    const unregisterSecond = registerDocumentUpdateFlusher("doc-2", second);

    unregisterFirst();
    await expect(flushDocumentUpdates("doc-2")).resolves.toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    unregisterSecond();
  });
});
