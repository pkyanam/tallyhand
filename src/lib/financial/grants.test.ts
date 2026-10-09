import { describe, it, expect } from "vitest";
import {
  assertFinancialGrant,
  type FinancialGrant,
  type FinancialGrantProof,
} from "@/core/financial/authority";
const scope = {
  userId: "u",
  workspaceId: "u",
  provider: "stripe" as const,
  accountId: "acct_1",
  mode: "test" as const,
};
const principal = { kind: "api-token" as const, tokenId: "tok_1" };
const grant: FinancialGrant = {
  id: "g",
  userId: "u",
  workspaceId: "u",
  principal,
  actions: ["collect"],
  accountId: "acct_1",
  mode: "test",
  currency: "USD",
  maxMinorUnits: 1000,
  createdAt: 1,
  revokedAt: null,
};
const proof: FinancialGrantProof = {
  grantId: "g",
  principal,
  action: "collect",
  scope,
  money: { currency: "USD", minorUnits: 1000 },
  grantedAt: 1,
};
describe("explicit financial grants", () => {
  it("allows only current matching bounded authority", () =>
    expect(() => assertFinancialGrant(grant, proof)).not.toThrow());
  it.each([
    null,
    { ...grant, revokedAt: 0 },
    { ...grant, userId: "foreign" },
    { ...grant, workspaceId: "foreign" },
    { ...grant, accountId: "other" },
    { ...grant, mode: "live" },
    { ...grant, actions: ["read"] },
    { ...grant, maxMinorUnits: 999 },
    { ...grant, currency: "EUR" },
    { ...grant, principal: { kind: "api-token", tokenId: "revoked" } },
  ])("rejects missing revoked or foreign authority %j", (g) =>
    expect(() =>
      assertFinancialGrant(g as FinancialGrant | null, proof),
    ).toThrow(),
  );
  it("requires integer money and explicit collection limits", () => {
    expect(() =>
      assertFinancialGrant(grant, { ...proof, money: undefined }),
    ).toThrow();
    expect(() =>
      assertFinancialGrant(grant, {
        ...proof,
        money: { currency: "USD", minorUnits: 1.1 },
      }),
    ).toThrow();
  });
});

import { assertFinancialCapability } from "@/core/financial/authority";
describe("persisted collection capabilities", () => {
  const link = {
    id: "link",
    userId: "u",
    type: "invoice",
    target: { invoiceId: "i" },
    expiresAt: 100,
    revokedAt: null,
  };
  const cap = {
    kind: "customer" as const,
    linkId: "link",
    userId: "u",
    workspaceId: "u",
    invoiceId: "i",
    expiresAt: 100,
  };
  it("binds current invoice link and denies revocation at zero", () => {
    expect(() =>
      assertFinancialCapability(link, cap, scope, "i", 50),
    ).not.toThrow();
    expect(() =>
      assertFinancialCapability({ ...link, revokedAt: 0 }, cap, scope, "i", 50),
    ).toThrow();
    expect(() =>
      assertFinancialCapability(link, cap, scope, "other", 50),
    ).toThrow();
    expect(() =>
      assertFinancialCapability(link, cap, scope, "i", 100),
    ).toThrow();
    expect(() =>
      assertFinancialCapability(link, undefined, scope, "i", 50),
    ).toThrow();
  });
});

import { assertFinancialDispatchActor } from "@/core/financial/authority";
describe("current dispatch identity", () => {
  it("requires explicit current actor and independently matching machine proof", () => {
    expect(() => assertFinancialDispatchActor(undefined, scope)).toThrow();
    expect(() =>
      assertFinancialDispatchActor({ kind: "system", id: "worker" }, scope),
    ).toThrow();
    expect(() =>
      assertFinancialDispatchActor({ kind: "owner", id: "foreign" }, scope),
    ).toThrow();
    expect(() =>
      assertFinancialDispatchActor({ kind: "agent", id: "tok_1" }, scope),
    ).toThrow();
    expect(() =>
      assertFinancialDispatchActor(
        { kind: "agent", id: "tok_1" },
        scope,
        proof,
      ),
    ).not.toThrow();
    expect(() =>
      assertFinancialDispatchActor(
        { kind: "agent", id: "other" },
        scope,
        proof,
      ),
    ).toThrow();
  });
  it("cannot borrow an owner preparer's authority for customer dispatch", () => {
    expect(() =>
      assertFinancialDispatchActor({ kind: "customer", id: "link" }, scope),
    ).toThrow();
  });
});
