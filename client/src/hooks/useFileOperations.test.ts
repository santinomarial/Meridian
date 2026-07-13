import { describe, expect, it } from "vitest";
import type JSZip from "jszip";
import {
  declaredUncompressedSize,
  isImportPathSafe,
} from "./useFileOperations";

describe("ZIP import safety", () => {
  it("accepts normal project paths and Windows separators", () => {
    expect(isImportPathSafe("src/components/App.tsx")).toBe(true);
    expect(isImportPathSafe("src\\components\\App.tsx")).toBe(true);
  });

  it("rejects traversal, overlong segments, and excessive nesting", () => {
    expect(isImportPathSafe("src/../secret.txt")).toBe(false);
    expect(isImportPathSafe("/etc/passwd")).toBe(false);
    expect(isImportPathSafe("C:\\Windows\\system.ini")).toBe(false);
    expect(isImportPathSafe("src/unsafe\u0000.txt")).toBe(false);
    expect(isImportPathSafe(`${"a".repeat(256)}.txt`)).toBe(false);
    expect(
      isImportPathSafe(`${Array.from({ length: 65 }, () => "d").join("/")}/x.txt`),
    ).toBe(false);
  });

  it("reads trustworthy finite declared sizes and rejects invalid metadata", () => {
    const entry = (size: unknown) =>
      ({ _data: { uncompressedSize: size } }) as unknown as JSZip.JSZipObject;

    expect(declaredUncompressedSize(entry(1024))).toBe(1024);
    expect(declaredUncompressedSize(entry(-1))).toBeNull();
    expect(declaredUncompressedSize(entry(Number.NaN))).toBeNull();
    expect(declaredUncompressedSize({} as JSZip.JSZipObject)).toBeNull();
  });
});
