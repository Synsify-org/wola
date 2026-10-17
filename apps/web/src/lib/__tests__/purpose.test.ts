import { describe, test, expect } from "vitest";
import { displayPurpose } from "../purpose";

describe("displayPurpose", () => {
  test("a real purpose is shown as written", () => {
    expect(displayPurpose("  School fees for my daughter ")).toBe("School fees for my daughter");
  });
  test("the demo marker is never shown", () => {
    expect(displayPurpose("[demo] Car purchase")).toBe("Car purchase");
  });
  test("older demo labels ('[demo] asset for Name') show no purpose at all", () => {
    expect(displayPurpose("[demo] asset for Grace Namuli")).toBeNull();
    expect(displayPurpose("[DEMO] advance for Brenda Nakato")).toBeNull();
  });
  test("nothing written means nothing shown", () => {
    expect(displayPurpose(null)).toBeNull();
    expect(displayPurpose("   ")).toBeNull();
    expect(displayPurpose("[demo]")).toBeNull();
  });
});
