import { describe, expect, it } from "vitest";
import { colorForUser } from "./collabColors";
import { normalizeAwarenessUser } from "./awarenessPresence";

describe("normalizeAwarenessUser", () => {
  it("preserves a valid collaborator identity", () => {
    expect(
      normalizeAwarenessUser({
        user: { id: "user-1", name: "Ada Lovelace", color: "#A1B2C3" },
      }),
    ).toEqual({ id: "user-1", name: "Ada Lovelace", color: "#a1b2c3" });
  });

  it("replaces CSS-injecting colors and strips control characters from names", () => {
    const result = normalizeAwarenessUser({
      user: {
        id: "attacker",
        name: "Mallory\n\"; } body { display: none; }",
        color: "#fff; } body { display:none; } /*",
      },
    });

    expect(result).not.toBeNull();
    expect(result?.color).toBe(colorForUser("attacker"));
    expect(result?.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(
      [...(result?.name ?? "")].every((character) => {
        const code = character.charCodeAt(0);
        return code > 0x1f && code !== 0x7f;
      }),
    ).toBe(true);
  });

  it("rejects malformed or empty identities", () => {
    expect(normalizeAwarenessUser({ user: { id: "", name: "A", color: "#112233" } })).toBeNull();
    expect(normalizeAwarenessUser({ user: { id: "a", name: 42, color: "#112233" } })).toBeNull();
  });
});
