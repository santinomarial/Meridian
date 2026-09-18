import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ackYjsUpdate,
  clearYjsOutboundQueue,
  decodeUpdateBase64,
  encodeUpdateBase64,
  enqueueYjsUpdate,
  listPendingYjsUpdates,
  listRecoveryUpdates,
  quarantineYjsUpdate,
} from "./yjsOutboundQueue";

describe("yjsOutboundQueue", () => {
  beforeEach(async () => {
    await clearYjsOutboundQueue();
  });

  it("round-trips update bytes through base64 helpers", () => {
    const bytes = new Uint8Array([1, 2, 255, 0, 42]);
    expect(decodeUpdateBase64(encodeUpdateBase64(bytes))).toEqual(bytes);
  });

  it("enqueues, lists, and removes on ack", async () => {
    const update = new Uint8Array([9, 8, 7]);
    await enqueueYjsUpdate("doc-a", "upd-1", update, 0);
    await enqueueYjsUpdate("doc-a", "upd-2", new Uint8Array([1]), 0);
    await enqueueYjsUpdate("doc-b", "upd-1", new Uint8Array([2]), 0);

    const pendingA = await listPendingYjsUpdates("doc-a");
    expect(pendingA.map((e) => e.updateId)).toEqual(["upd-1", "upd-2"]);
    expect(decodeUpdateBase64(pendingA[0]!.updateBase64)).toEqual(update);

    await ackYjsUpdate("doc-a", "upd-1");
    const afterAck = await listPendingYjsUpdates("doc-a");
    expect(afterAck.map((e) => e.updateId)).toEqual(["upd-2"]);

    const pendingB = await listPendingYjsUpdates("doc-b");
    expect(pendingB).toHaveLength(1);
  });

  it("preserves the original generation and bytes when setting aside stale edits", async () => {
    const bytes = new Uint8Array([5, 4, 3]);
    await enqueueYjsUpdate("restored-doc", "old-generation", bytes, 7);
    const [entry] = await listPendingYjsUpdates("restored-doc");
    expect(entry?.generation).toBe(7);
    await quarantineYjsUpdate(entry!);
    expect(await listPendingYjsUpdates("restored-doc")).toEqual([]);
    const archived = (await listRecoveryUpdates()).find((row) => row.id === entry!.id);
    expect(archived).toEqual(entry);
    expect(decodeUpdateBase64(archived!.updateBase64)).toEqual(bytes);
  });
});
