import { describe, expect, it } from "vitest";
import {
  acquireDocumentState,
  activeDocumentStateCount,
  getDocumentState,
  isApplyingRemoteDocumentUpdate,
  releaseDocumentState,
  runWithRemoteDocumentUpdate,
} from "./yjsDocs";

describe("remote Yjs update tracking", () => {
  it("tracks nested synchronous remote updates and always clears the marker", () => {
    expect(isApplyingRemoteDocumentUpdate("doc-1")).toBe(false);

    runWithRemoteDocumentUpdate("doc-1", () => {
      expect(isApplyingRemoteDocumentUpdate("doc-1")).toBe(true);
      runWithRemoteDocumentUpdate("doc-1", () => {
        expect(isApplyingRemoteDocumentUpdate("doc-1")).toBe(true);
      });
      expect(isApplyingRemoteDocumentUpdate("doc-1")).toBe(true);
    });

    expect(isApplyingRemoteDocumentUpdate("doc-1")).toBe(false);
  });

  it("clears the marker when an update throws", () => {
    expect(() =>
      runWithRemoteDocumentUpdate("doc-2", () => {
        throw new Error("bad update");
      }),
    ).toThrow("bad update");
    expect(isApplyingRemoteDocumentUpdate("doc-2")).toBe(false);
  });
});

describe("Yjs document lifecycle", () => {
  it("destroys state only after the final active reference is released", () => {
    const first = acquireDocumentState("doc-lifecycle");
    const second = acquireDocumentState("doc-lifecycle");
    expect(second).toBe(first);
    expect(activeDocumentStateCount()).toBe(1);

    releaseDocumentState("doc-lifecycle");
    expect(getDocumentState("doc-lifecycle")).toBe(first);

    releaseDocumentState("doc-lifecycle");
    expect(getDocumentState("doc-lifecycle")).toBeUndefined();
    expect(activeDocumentStateCount()).toBe(0);
  });

  it("makes release idempotent for unknown document ids", () => {
    expect(() => releaseDocumentState("never-opened")).not.toThrow();
  });
});
