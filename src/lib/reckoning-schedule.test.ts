import { describe, expect, it } from "vitest";
import { isReckoningDue, lastReckoningInstantMs } from "@/lib/reckoning-schedule";

describe("lastReckoningInstantMs", () => {
  it("returns same-week Friday 4pm when now is Saturday after that moment", () => {
    const sat = new Date(2026, 3, 25, 10, 0, 0).getTime();
    const anchor = lastReckoningInstantMs(sat, 5, 16);
    const d = new Date(anchor);
    expect(d.getDay()).toBe(5);
    expect(d.getHours()).toBe(16);
    expect(d.getDate()).toBe(24);
  });

  it("returns previous Friday when now is before this week’s reckoning time", () => {
    const wed = new Date(2026, 3, 22, 12, 0, 0).getTime();
    const anchor = lastReckoningInstantMs(wed, 5, 16);
    const d = new Date(anchor);
    expect(d.getDay()).toBe(5);
    expect(d.getDate()).toBe(17);
  });
});

describe("isReckoningDue", () => {
  it("is due when never completed", () => {
    const sat = new Date(2026, 3, 25, 10, 0, 0).getTime();
    expect(isReckoningDue(sat, 5, 16, undefined)).toBe(true);
  });

  it("is not due when completed after last anchor", () => {
    const sat = new Date(2026, 3, 25, 10, 0, 0).getTime();
    const anchor = lastReckoningInstantMs(sat, 5, 16);
    expect(isReckoningDue(sat, 5, 16, anchor + 1000)).toBe(false);
  });
});
