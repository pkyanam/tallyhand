import { describe, expect, it } from "vitest";
import { fromDateInputValue, toDateInputValue } from "./datetime";

describe("date input helpers", () => {
  it("round-trips a local calendar day", () => {
    const d = fromDateInputValue("2024-03-15");
    expect(d).not.toBeNull();
    expect(toDateInputValue(d!)).toBe("2024-03-15");
  });

  it("returns null for empty input", () => {
    expect(fromDateInputValue("")).toBeNull();
  });
});
