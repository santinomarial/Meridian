import { describe, it, expect } from "vitest";
import { getPasswordRequirements, getPasswordStrengthScore } from "./passwordPolicy";

describe("getPasswordRequirements", () => {
  it("reports all five rules unmet for an empty password", () => {
    const reqs = getPasswordRequirements("");
    expect(reqs).toHaveLength(5);
    expect(reqs.every((r) => !r.met)).toBe(true);
  });

  it("marks each rule met as the password satisfies it", () => {
    const reqs = getPasswordRequirements("Abcdef1!");
    expect(reqs.every((r) => r.met)).toBe(true);
  });

  it("flags only the missing rules", () => {
    // 8+ chars, lowercase only — missing uppercase, number, special.
    const reqs = getPasswordRequirements("abcdefgh");
    const unmet = reqs.filter((r) => !r.met).map((r) => r.label);
    expect(unmet).toEqual(["1 uppercase letter", "1 number", "1 special character"]);
  });
});

describe("getPasswordStrengthScore", () => {
  it("is 0 for an empty password", () => {
    expect(getPasswordStrengthScore("")).toBe(0);
  });

  it("counts the number of satisfied rules", () => {
    expect(getPasswordStrengthScore("abcdefgh")).toBe(2); // length + lowercase
    expect(getPasswordStrengthScore("Abcdefg1")).toBe(4); // length, upper, lower, number
    expect(getPasswordStrengthScore("Abcdef1!")).toBe(5); // all
  });
});
