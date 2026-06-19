import { describe, it, expect } from "vitest";
import {
  flattenFileTree,
  scoreFile,
  searchFiles,
  commandMatches,
  type FlatFile,
} from "./commandPalette";
import type { FileNode } from "../types";

const tree: FileNode[] = [
  { kind: "file", id: "readme", name: "README.md", language: "markdown" },
  {
    kind: "folder",
    id: "src",
    name: "src",
    expanded: true,
    children: [
      { kind: "file", id: "index", name: "index.ts", language: "typescript" },
      {
        kind: "folder",
        id: "services",
        name: "services",
        expanded: true,
        children: [
          { kind: "file", id: "auth", name: "auth.ts", language: "typescript" },
        ],
      },
    ],
  },
];

describe("flattenFileTree", () => {
  it("flattens nested files with full paths and folder context", () => {
    const flat = flattenFileTree(tree);
    const byId = Object.fromEntries(flat.map((f) => [f.id, f]));

    expect(flat).toHaveLength(3); // folders are dropped
    expect(byId["readme"]).toMatchObject({ name: "README.md", folder: "", path: "README.md" });
    expect(byId["index"]).toMatchObject({ folder: "src", path: "src/index.ts" });
    expect(byId["auth"]).toMatchObject({
      folder: "src/services",
      path: "src/services/auth.ts",
    });
  });

  it("returns an empty list for an empty tree", () => {
    expect(flattenFileTree([])).toEqual([]);
  });
});

describe("scoreFile", () => {
  const file: FlatFile = { id: "a", name: "auth.ts", folder: "src", path: "src/auth.ts" };

  it("ranks exact name best, then prefix, then substring, then path-only", () => {
    expect(scoreFile({ ...file, name: "auth.ts" }, "auth.ts")).toBe(0);
    expect(scoreFile(file, "aut")).toBe(1); // name prefix
    expect(scoreFile(file, "th")).toBe(2); // name substring
    expect(scoreFile(file, "src")).toBe(3); // path-only match
  });

  it("is case-insensitive and returns -1 for no match", () => {
    expect(scoreFile(file, "AUTH")).toBe(1);
    expect(scoreFile(file, "zzz")).toBe(-1);
  });

  it("returns -1 for an empty query", () => {
    expect(scoreFile(file, "")).toBe(-1);
    expect(scoreFile(file, "   ")).toBe(-1);
  });
});

describe("searchFiles", () => {
  const flat = flattenFileTree(tree);

  it("returns nothing for an empty query", () => {
    expect(searchFiles(flat, "")).toEqual([]);
  });

  it("filters and ranks matches best-first", () => {
    const results = searchFiles(flat, "ts");
    // Both index.ts and auth.ts match; results are name-matches, path order stable.
    expect(results.map((f) => f.name).sort()).toEqual(["auth.ts", "index.ts"]);
  });

  it("prefers a name match over a path-only match", () => {
    const results = searchFiles(flat, "auth");
    expect(results[0]?.name).toBe("auth.ts");
  });

  it("respects the result limit", () => {
    const many: FlatFile[] = Array.from({ length: 30 }, (_, i) => ({
      id: `f${i}`,
      name: `match${i}.ts`,
      folder: "",
      path: `match${i}.ts`,
    }));
    expect(searchFiles(many, "match", 25)).toHaveLength(25);
  });
});

describe("commandMatches", () => {
  it("matches everything on an empty query", () => {
    expect(commandMatches("", "Toggle Terminal")).toBe(true);
    expect(commandMatches("   ", "Toggle Terminal")).toBe(true);
  });

  it("matches title and keywords case-insensitively", () => {
    expect(commandMatches("term", "Toggle Terminal")).toBe(true);
    expect(commandMatches("shell", "Toggle Terminal", "shell console")).toBe(true);
    expect(commandMatches("git", "Toggle Terminal", "shell console")).toBe(false);
  });
});
