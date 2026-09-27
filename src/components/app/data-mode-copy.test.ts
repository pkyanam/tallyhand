import { describe, expect, it } from "vitest";
import { dataModeCopy } from "./data-mode-copy";

describe("dataModeCopy", () => {
  it("describes account-backed use without local storage jargon", () => {
    const copy = dataModeCopy("cloud");

    expect(copy.navigationStatus).toContain("Cloud");
    expect(copy.logoStorage).toContain("account data");
    expect(copy.receiptStorage).toContain("account data");
    expect(copy.logoSizeWarning("600")).not.toMatch(/IndexedDB|browser/i);
    expect(copy.receiptSizeWarning("600")).toContain("sync size");
  });

  it("makes browser-local storage explicit in local mode", () => {
    const copy = dataModeCopy("local");

    expect(copy.navigationStatus).toContain("Local mode");
    expect(copy.logoStorage).toContain("this browser");
    expect(copy.receiptStorage).toContain("this browser");
    expect(copy.receiptSizeWarning("600")).toContain("browser storage");
    expect(copy.resetConfirmation).toContain("local Tallyhand data");
  });
});
