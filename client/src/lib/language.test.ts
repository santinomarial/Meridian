import { describe, it, expect } from "vitest";
import {
  getLanguageFromFilename,
  isSupportedTextFile,
  getStarterContent,
} from "./language";

describe("getLanguageFromFilename", () => {
  it("maps known extensions to Monaco language ids", () => {
    expect(getLanguageFromFilename("app.ts")).toBe("typescript");
    expect(getLanguageFromFilename("Component.tsx")).toBe("typescript");
    expect(getLanguageFromFilename("main.py")).toBe("python");
    expect(getLanguageFromFilename("server.go")).toBe("go");
    expect(getLanguageFromFilename("lib.rs")).toBe("rust");
    expect(getLanguageFromFilename("page.html")).toBe("html");
    expect(getLanguageFromFilename("data.json")).toBe("json");
    expect(getLanguageFromFilename("notes.md")).toBe("markdown");
    expect(getLanguageFromFilename("run.sh")).toBe("shell");
  });

  it("is case-insensitive", () => {
    expect(getLanguageFromFilename("APP.TS")).toBe("typescript");
  });

  it("falls back to plaintext for unknown or missing extensions", () => {
    expect(getLanguageFromFilename("data.bin")).toBe("plaintext");
    expect(getLanguageFromFilename("Makefile")).toBe("plaintext");
  });
});

describe("isSupportedTextFile", () => {
  it("accepts supported text extensions", () => {
    for (const name of ["a.ts", "b.py", "c.md", "d.json", "e.sh", "f.txt"]) {
      expect(isSupportedTextFile(name)).toBe(true);
    }
  });

  it("rejects unsupported / binary extensions", () => {
    for (const name of ["image.png", "archive.zip", "video.mp4", "noext"]) {
      expect(isSupportedTextFile(name)).toBe(false);
    }
  });
});

describe("getStarterContent", () => {
  it("produces runnable Python scaffolding", () => {
    const content = getStarterContent("main.py");
    expect(content).toContain("def main():");
    expect(content).toContain('if __name__ == "__main__":');
  });

  it("derives a PascalCase name for TS modules", () => {
    expect(getStarterContent("user_profile.ts")).toContain("export function User_profile");
  });

  it("returns empty content for plaintext", () => {
    expect(getStarterContent("notes.txt")).toBe("");
  });

  it("uses only the basename when given a path", () => {
    const content = getStarterContent("src/services/auth.ts");
    expect(content).toContain("export function Auth");
  });
});
