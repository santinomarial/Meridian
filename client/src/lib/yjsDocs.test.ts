import { describe, expect, it } from "vitest";
import {
  isApplyingRemoteDocumentUpdate,
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
