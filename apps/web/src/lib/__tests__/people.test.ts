import { describe, test, expect } from "vitest";
import { AVATAR_TINTS, initialsOf, tintIndexFor } from "../people";

describe("initialsOf", () => {
  test("first and last word, uppercased", () => {
    expect(initialsOf("Grace Namuli")).toBe("GN");
    expect(initialsOf("  isaac   wanyama ")).toBe("IW");
  });

  test("a single word gives one letter; three words skip the middle", () => {
    expect(initialsOf("Staff")).toBe("S");
    expect(initialsOf("Mary Jane Watson")).toBe("MW");
  });

  test("an email uses its local part, never the domain", () => {
    expect(initialsOf("ceo@testco.io")).toBe("C");
    expect(initialsOf("grace.namuli@testco.io")).toBe("GN");
  });

  test("empty or missing input still renders something", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf(null)).toBe("?");
    expect(initialsOf(undefined)).toBe("?");
  });
});

describe("tintIndexFor", () => {
  test("the same person always gets the same tint, case-insensitively", () => {
    expect(tintIndexFor("Grace Namuli")).toBe(tintIndexFor("grace namuli"));
  });

  test("always lands inside the tint list", () => {
    for (const n of ["", "A", "Grace Namuli", "x".repeat(500), "ceo@testco.io"]) {
      const i = tintIndexFor(n);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(AVATAR_TINTS.length);
    }
  });

  test("different people are spread across more than one tint", () => {
    const used = new Set(["Ann", "Bob", "Cyril", "Dina", "Eve", "Faith", "Grace", "Hamza"].map(tintIndexFor));
    expect(used.size).toBeGreaterThan(1);
  });
});
