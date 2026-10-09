import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/financial-authority", () => ({}));
vi.mock("@/server/financial-store", () => ({}));
vi.mock("@/server/stripe-connect", () => ({}));
vi.mock("@/lib/stripe-connect/store", () => ({}));
vi.mock("../_lib/sync-auth", () => ({}));
import { financialPage } from "./_lib";

describe("financial page validation", () => {
  it.each(["0", "101", "2.5", "", "-1", "Infinity"])("rejects unbounded or invalid limit %s", limit => {
    expect(() => financialPage(new Request(`https://example.test?limit=${limit}`))).toThrow("limit must");
  });
  it("defaults to a bounded page and preserves a cursor", () => {
    expect(financialPage(new Request("https://example.test?cursor=abc"))).toEqual({ limit: 50, cursor: "abc" });
  });
});
