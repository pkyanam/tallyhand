// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  receiveStripeEvent,
  processFinancialEvent,
} from "../../server/financial-events";
import { DatabaseSync } from "node:sqlite";
import {
  SqliteFinancialStore,
  listSqliteFinancialScopes,
  getSqliteFinancialRecoveryCheckpoint,
  claimSqliteFinancialRecoveryRun,
  saveSqliteFinancialRecoveryCheckpoint,
} from "./sqlite-store";
import { invoiceFingerprint } from "../../core/financial/snapshot";
const scope = {
  userId: "local",
  workspaceId: "local",
  provider: "stripe" as const,
  accountId: "acct",
  mode: "test" as const,
};
const invoice = {
  id: "inv",
  status: "sent",
  updatedAt: 1,
  total: 10,
  currency: "USD",
};
const prepare = {
  scope,
  invoice: {
    invoiceId: "inv",
    revision: "1",
    fingerprint: invoiceFingerprint(invoice),
    money: { currency: "USD" as const, minorUnits: 1000 },
  },
  operationId: "op",
  requestFingerprint: "request",
  actor: { kind: "owner" as const, id: "local" },
  now: 1,
};
let dir: string,
  path: string,
  a: SqliteFinancialStore,
  b: SqliteFinancialStore,
  db: DatabaseSync;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "financial-"));
  path = join(dir, "data.db");
  db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE invoices (id TEXT PRIMARY KEY,status TEXT,updated_at INTEGER,data TEXT)",
  );
  db.prepare("INSERT INTO invoices VALUES(?,?,?,?)").run(
    "inv",
    "sent",
    1,
    JSON.stringify(invoice),
  );
  a = new SqliteFinancialStore(path);
  b = new SqliteFinancialStore(path);
});
afterEach(() => {
  a.close();
  b.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
async function outcome() {
  const { attempt } = await a.prepareAttempt(prepare);
  const { event } = await a.receiveProviderEvent({
    scope,
    providerEventId: "evt",
    type: "paid",
    payload: "{}",
    receivedAt: 2,
  });
  return {
    scope,
    attemptId: attempt.id,
    providerPaymentId: "pi",
    money: prepare.invoice.money,
    confirmedAt: 3,
    source: { kind: "event" as const, eventId: event.id },
  };
}
describe("SQLite financial durable transactions", () => {
  it("shares outstanding intent across two connections and restarts; rejects operation conflicts", async () => {
    const [x, y] = await Promise.all([
      a.prepareAttempt(prepare),
      b.prepareAttempt({ ...prepare, operationId: "op2" }),
    ]);
    expect(x.attempt.id).toBe(y.attempt.id);
    await expect(
      b.prepareAttempt({ ...prepare, requestFingerprint: "changed" }),
    ).rejects.toThrow("conflict");
    a.close();
    a = new SqliteFinancialStore(path);
    expect((await a.getAttempt(scope, x.attempt.id))?.state).toBe("prepared");
    expect(
      await a.getAttempt({ ...scope, userId: "other" }, x.attempt.id),
    ).toBeNull();
  });
  it("fences dispatch claims and never redispatches expired or unknown attempts", async () => {
    const { attempt } = await a.prepareAttempt(prepare);
    const claim = {
      dispatchActor: prepare.actor,
      scope,
      id: attempt.id,
      now: 2,
      lease: { token: "one", expiresAt: 5 },
    };
    expect(await a.claimAttemptDispatch(claim)).not.toBeNull();
    expect(
      await b.claimAttemptDispatch({
        ...claim,
        lease: { token: "two", expiresAt: 6 },
      }),
    ).toBeNull();
    await expect(
      a.recordAttemptDispatch({
        ...claim,
        lease: { token: "bad", expiresAt: 5 },
        result: { state: "unknown", failure: "timeout" },
      }),
    ).rejects.toThrow("Stale");
    await a.recordAttemptDispatch({
      ...claim,
      result: { state: "unknown", failure: "timeout" },
    });
    expect(
      await b.claimAttemptDispatch({
        ...claim,
        now: 8,
        lease: { token: "new", expiresAt: 20 },
      }),
    ).toBeNull();
    expect(
      (await a.listResumableWork(scope, 8, { limit: 10 })).items,
    ).toHaveLength(1);
  });
  it("deduplicates events and payment objects and commits invoice, allocation, audit, outbox together", async () => {
    const input = await outcome();
    const [x, y] = await Promise.all([
      a.applyPaymentOutcome(input),
      b.applyPaymentOutcome(input),
    ]);
    expect(x.payment.id).toBe(y.payment.id);
    expect(y.reused).toBe(true);
    expect(
      (db.prepare("SELECT status FROM invoices").get() as { status: string })
        .status,
    ).toBe("paid");
    const timeline = await a.getInvoiceTimeline(scope, "inv", { limit: 20 });
    expect(timeline.payments).toHaveLength(1);
    expect(timeline.allocations).toHaveLength(1);
    expect(
      timeline.audit.items.filter((e) => e.kind === "payment.confirmed"),
    ).toHaveLength(1);
    expect(
      (
        await a.receiveProviderEvent({
          scope,
          providerEventId: "evt",
          type: "paid",
          payload: "{}",
          receivedAt: 4,
        })
      ).reused,
    ).toBe(true);
    expect(
      (
        await a.listPayments(
          { ...scope, userId: "other", workspaceId: "other" },
          { limit: 10 },
        )
      ).items,
    ).toHaveLength(0);
  });
  it("rolls back legacy invoice update if ledger insertion fails", async () => {
    const input = await outcome();
    db.exec(
      "CREATE TRIGGER fail_payment BEFORE INSERT ON financial_records WHEN NEW.kind='payment' BEGIN SELECT RAISE(ABORT,'injected failure'); END",
    );
    await expect(a.applyPaymentOutcome(input)).rejects.toThrow("injected");
    expect(
      (db.prepare("SELECT status FROM invoices").get() as { status: string })
        .status,
    ).toBe("sent");
    expect((await a.listPayments(scope, { limit: 10 })).items).toHaveLength(0);
    expect((await a.getAttempt(scope, input.attemptId))?.state).toBe(
      "prepared",
    );
  });
  it("retains actual provider collection against frozen invoice when current invoice changed", async () => {
    const input = await outcome();
    const changed = { ...invoice, total: 20, updatedAt: 2 };
    db.prepare("UPDATE invoices SET data=?").run(JSON.stringify(changed));
    const { payment, allocation } = await a.applyPaymentOutcome(input);
    expect(payment.money.minorUnits).toBe(1000);
    expect(payment.invoice).toEqual(prepare.invoice);
    expect(allocation.money.minorUnits).toBe(1000);
    expect(
      JSON.parse(
        (db.prepare("SELECT data FROM invoices").get() as { data: string })
          .data,
      ),
    ).toEqual(changed);
    const timeline = await a.getInvoiceTimeline(scope, "inv", { limit: 20 });
    expect(timeline.payments).toHaveLength(1);
    expect(
      timeline.audit.items.some(
        (e) => e.kind === "payment.invoice-projection-blocked",
      ),
    ).toBe(true);
    await expect(
      a.prepareAttempt({
        ...prepare,
        operationId: "new",
        invoice: {
          ...prepare.invoice,
          revision: "2",
          fingerprint: invoiceFingerprint(changed),
          money: { currency: "USD", minorUnits: 2000 },
        },
      }),
    ).rejects.toThrow("confirmed frozen allocation");
  });
  it("blocks new checkout for outstanding invoice across provider account or mode switches", async () => {
    await a.prepareAttempt(prepare);
    await expect(
      b.prepareAttempt({
        ...prepare,
        scope: { ...scope, accountId: "new-account" },
        operationId: "new",
      }),
    ).rejects.toThrow("another provider scope");
    await expect(
      b.prepareAttempt({
        ...prepare,
        scope: { ...scope, mode: "live" },
        operationId: "live",
      }),
    ).rejects.toThrow("another provider scope");
    expect(
      (await a.getInvoiceTimeline(scope, "inv", { limit: 20 })).attempts,
    ).toHaveLength(1);
  });
  it("retries missing parent, excludes pending refunds, prevents confirmed regression and overrefund", async () => {
    const input = await outcome();
    const refund = {
      scope,
      providerPaymentId: "pi",
      providerRefundId: "re",
      money: { currency: "USD" as const, minorUnits: 700 },
      state: "pending" as const,
      observedAt: 3,
      source: input.source,
    };
    await expect(a.applyRefundOutcome(refund)).rejects.toThrow("Retryable");
    await a.applyPaymentOutcome(input);
    await a.applyRefundOutcome({
      ...refund,
      money: { currency: "USD", minorUnits: 1200 },
      providerRefundId: "pending",
    });
    await a.applyRefundOutcome({
      ...refund,
      state: "confirmed",
      observedAt: 4,
    });
    expect(
      (
        await b.applyRefundOutcome({
          ...refund,
          state: "failed",
          observedAt: 5,
        })
      ).refund.state,
    ).toBe("confirmed");
    await expect(
      a.applyRefundOutcome({
        ...refund,
        providerRefundId: "other",
        state: "confirmed",
      }),
    ).rejects.toThrow("exceed");
  });
  it("fences event and outbox reclaim and isolates owners", async () => {
    await outcome();
    const e = (
      await a.receiveProviderEvent({
        scope,
        providerEventId: "event2",
        type: "x",
        payload: "{}",
        receivedAt: 1,
      })
    ).event;
    const claim = {
      dispatchActor: prepare.actor,
      scope,
      id: e.id,
      now: 2,
      lease: { token: "a", expiresAt: 4 },
    };
    await a.claimProviderEvent(claim);
    await b.claimProviderEvent({
      ...claim,
      now: 5,
      lease: { token: "b", expiresAt: 10 },
    });
    await expect(
      a.finishProviderEvent({ ...claim, state: "processed" }),
    ).rejects.toThrow("Stale");
    expect(
      await a.claimOutbox({ userId: "other", workspaceId: "other" }, 2, {
        token: "x",
        expiresAt: 10,
      }),
    ).toBeNull();
    const out = await a.claimOutbox(scope, 2, { token: "a", expiresAt: 4 });
    expect(out).not.toBeNull();
    await b.claimOutbox(scope, 5, { token: "b", expiresAt: 10 });
    await expect(
      a.finishOutbox(scope, out!.id, "a", { now: 3, delivered: true }),
    ).rejects.toThrow("Stale");
  });
  it("paginates payments with bounded limits", async () => {
    await a.applyPaymentOutcome(await outcome());
    const first = await a.listPayments(scope, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(
      (await a.listPayments(scope, { limit: 1, cursor: first.items[0].id }))
        .items,
    ).toHaveLength(0);
    await expect(a.listPayments(scope, { limit: 1000 })).rejects.toThrow(
      "limit",
    );
  });
  it("checks durable agent grants during prepare and dispatch; revocation fences new work", async () => {
    db.exec(
      "CREATE TABLE api_tokens (id TEXT PRIMARY KEY,user_id TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO api_tokens VALUES(?,?)").run("token", "local");
    const principal = { kind: "api-token" as const, tokenId: "token" };
    const grant = {
      id: "grant",
      userId: "local",
      workspaceId: "local",
      principal,
      actions: ["collect"],
      accountId: "acct",
      mode: "test",
      currency: "USD",
      maxMinorUnits: 1000,
      createdAt: 1,
      revokedAt: null,
    };
    db.prepare("INSERT INTO financial_grants VALUES(?,?,?,?,NULL)").run(
      grant.id,
      grant.userId,
      grant.workspaceId,
      JSON.stringify(grant),
    );
    const proof = {
      grantId: grant.id,
      principal,
      action: "collect" as const,
      scope,
      money: prepare.invoice.money,
      invoiceId: "inv",
      grantedAt: 1,
    };
    const agentInput = {
      ...prepare,
      actor: { kind: "agent" as const, id: "token" },
      authorityProof: proof,
    };
    await expect(
      a.prepareAttempt({ ...agentInput, authorityProof: undefined }),
    ).rejects.toThrow("authority");
    const ownerPrepared = await a.prepareAttempt(prepare);
    const { attempt } = await a.prepareAttempt(agentInput);
    expect(attempt.id).toBe(ownerPrepared.attempt.id);
    expect(attempt.actor.kind).toBe("owner");
    db.prepare("UPDATE financial_grants SET revoked_at=2 WHERE id=?").run(
      "grant",
    );
    await expect(
      b.claimAttemptDispatch({
        scope,
        id: attempt.id,
        now: 3,
        lease: { token: "lease", expiresAt: 10 },
        authorityProof: proof,
        dispatchActor: agentInput.actor,
      }),
    ).rejects.toThrow("authority");
    expect((await a.getAttempt(scope, attempt.id))?.state).toBe("prepared");
    db.prepare("UPDATE financial_grants SET revoked_at=NULL WHERE id=?").run(
      "grant",
    );
    db.prepare("DELETE FROM api_tokens WHERE id=?").run("token");
    await expect(
      b.claimAttemptDispatch({
        scope,
        id: attempt.id,
        now: 3,
        lease: { token: "lease", expiresAt: 10 },
        authorityProof: proof,
        dispatchActor: agentInput.actor,
      }),
    ).rejects.toThrow("revoked");
  });
  it("recovers expired dispatch by positive provider lookup and fences late network responses", async () => {
    const { attempt } = await a.prepareAttempt(prepare);
    const claim = {
      dispatchActor: prepare.actor,
      scope,
      id: attempt.id,
      now: 2,
      lease: { token: "dispatch", expiresAt: 4 },
    };
    await a.claimAttemptDispatch(claim);
    const result = {
      state: "pending" as const,
      checkoutSessionId: "cs",
      checkoutUrl: "https://checkout.stripe.com/c/pay",
      providerPaymentId: "pi",
    };
    const recovered = await b.reconcileAttempt({
      scope,
      id: attempt.id,
      now: 5,
      result,
    });
    expect(recovered.state).toBe("pending");
    expect(recovered.checkoutUrl).toBe(result.checkoutUrl);
    await expect(
      a.recordAttemptDispatch({ ...claim, now: 6, result }),
    ).rejects.toThrow("Stale");
    await expect(
      a.reconcileAttempt({
        scope,
        id: attempt.id,
        now: 7,
        result: { ...result, checkoutSessionId: "other" },
      }),
    ).rejects.toThrow("conflict");
    expect(
      await a.claimAttemptDispatch({
        ...claim,
        now: 8,
        lease: { token: "new", expiresAt: 20 },
      }),
    ).toBeNull();
  });
  it("restricts machine payment reads to account and mode while owner reads workspace history", async () => {
    await a.applyPaymentOutcome(await outcome());
    expect(
      (
        await a.listPayments(
          { ...scope, accountId: "another-account" },
          { limit: 10 },
        )
      ).items,
    ).toHaveLength(0);
    expect(
      (await a.listPayments({ ...scope, mode: "live" }, { limit: 10 })).items,
    ).toHaveLength(0);
    expect(
      (
        await a.listPayments(
          { userId: "local", workspaceId: "local" },
          { limit: 10 },
        )
      ).items,
    ).toHaveLength(1);
    await expect(
      a.listPayments({ userId: "local", workspaceId: "other" }, { limit: 10 }),
    ).rejects.toThrow("mismatch");
  });
  it("fails customer collection closed without an atomic durable share capability store", async () => {
    await expect(
      a.prepareAttempt({
        ...prepare,
        actor: { kind: "customer", id: "share" },
        capabilityProof: {
          kind: "customer",
          linkId: "share",
          userId: "local",
          workspaceId: "local",
          invoiceId: "inv",
          expiresAt: 100,
        },
      }),
    ).rejects.toThrow("durable share capability");
    expect(
      (await a.getInvoiceTimeline(scope, "inv", { limit: 10 })).attempts,
    ).toHaveLength(0);
  });
  it("processes real checkout event with internal receipt identity before dispatch response", async () => {
    const { attempt } = await a.prepareAttempt(prepare);
    const claim = {
      dispatchActor: prepare.actor,
      scope,
      id: attempt.id,
      now: 2,
      lease: { token: "network", expiresAt: Date.now() + 10000 },
    };
    await a.claimAttemptDispatch(claim);
    const received = await receiveStripeEvent(a, scope, {
      id: "evt_actual_flow",
      type: "checkout.session.completed",
      account: "acct",
      livemode: false,
      data: {
        object: {
          id: "cs",
          livemode: false,
          payment_intent: "pi",
          payment_status: "paid",
          amount_total: 1000,
          currency: "usd",
          metadata: {
            attemptId: attempt.id,
            invoiceId: "inv",
            invoiceFingerprint: createHash("sha256")
              .update(prepare.invoice.fingerprint)
              .digest("hex"),
            accountId: "acct",
          },
        },
      },
    });
    expect(received.event.id).not.toBe("evt_actual_flow");
    await processFinancialEvent(b, received.event);
    expect((await a.getAttempt(scope, attempt.id))?.state).toBe("confirmed");
    expect((await a.listPayments(scope, { limit: 10 })).items).toHaveLength(1);
    expect(
      (
        await a.recordAttemptDispatch({
          ...claim,
          now: Date.now(),
          result: {
            state: "pending",
            checkoutSessionId: "cs",
            checkoutUrl: "https://checkout.stripe.com/pay",
          },
        })
      ).state,
    ).toBe("confirmed");
    await expect(
      a.applyPaymentOutcome({
        scope,
        attemptId: attempt.id,
        providerPaymentId: "pi",
        money: prepare.invoice.money,
        confirmedAt: Date.now(),
        source: { kind: "event", eventId: "evt_actual_flow" },
      }),
    ).rejects.toThrow("receipt");
  });
  it("discovers bounded persisted scopes for recovery after restart", async () => {
    await a.prepareAttempt(prepare);
    await a.receiveProviderEvent({
      scope: { ...scope, accountId: "other" },
      providerEventId: "other-event",
      type: "x",
      payload: "{}",
      receivedAt: 1,
    });
    const first = listSqliteFinancialScopes(path, 1, undefined, 2);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = listSqliteFinancialScopes(path, 1, first.nextCursor, 2);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].accountId).not.toBe(first.items[0].accountId);
    expect(second.nextCursor).toBeUndefined();
    await a.applyPaymentOutcome(await outcome());
    expect(
      (
        await a.getInvoiceTimeline(scope, "inv", { limit: 20 })
      ).audit.items.find((e) => e.kind === "payment.confirmed")?.detail
        .projectionMatched,
    ).toBe(true);
  });
  it("persists scheduler cursors and fences overlapping recovery runs", () => {
    expect(getSqliteFinancialRecoveryCheckpoint(path)).toBeNull();
    expect(claimSqliteFinancialRecoveryRun(path, "first", 1, 5)).toBe(true);
    expect(claimSqliteFinancialRecoveryRun(path, "second", 2, 8)).toBe(false);
    const progress = {
      scopeCursor: "cursor",
      scopes: {
        scope: {
          workCursor: "work",
          paymentCursor: "payment",
          providerCursors: { refunds: "refund" },
        },
      },
    };
    saveSqliteFinancialRecoveryCheckpoint(path, "first", progress, 3);
    expect(getSqliteFinancialRecoveryCheckpoint(path)).toEqual(progress);
    expect(claimSqliteFinancialRecoveryRun(path, "next", 4, 7)).toBe(true);
    expect(claimSqliteFinancialRecoveryRun(path, "replacement", 8, 12)).toBe(
      true,
    );
    expect(() =>
      saveSqliteFinancialRecoveryCheckpoint(path, "next", { scopes: {} }, 9),
    ).toThrow("Stale");
    expect(getSqliteFinancialRecoveryCheckpoint(path)).toEqual(progress);
    saveSqliteFinancialRecoveryCheckpoint(
      path,
      "replacement",
      { scopes: {} },
      10,
    );
    expect(getSqliteFinancialRecoveryCheckpoint(path)).toEqual({ scopes: {} });
  });
});

it("positively expired checkout releases collection only for a new operation", async () => {
  const original = (await a.prepareAttempt(prepare)).attempt;
  await a.claimAttemptDispatch({
    scope,
    id: original.id,
    now: 2,
    lease: { token: "dispatch", expiresAt: 10 },
    dispatchActor: prepare.actor,
  });
  await a.recordAttemptDispatch({
    scope,
    id: original.id,
    now: 3,
    lease: { token: "dispatch", expiresAt: 10 },
    result: {
      state: "pending",
      checkoutSessionId: "cs_expired",
      checkoutUrl: "https://checkout.stripe.com/expired",
    },
  });
  await expect(
    a.reconcileAttempt({
      scope,
      id: original.id,
      now: 11,
      result: {
        state: "failed",
        failure: "Stripe checkout expired unpaid",
        checkoutSessionId: "wrong",
      },
    }),
  ).rejects.toThrow("conflict");
  const expired = await a.reconcileAttempt({
    scope,
    id: original.id,
    now: 11,
    result: {
      state: "failed",
      failure: "Stripe checkout expired unpaid",
      checkoutSessionId: "cs_expired",
    },
  });
  expect(expired.state).toBe("failed");
  expect(expired.checkoutUrl).toBeUndefined();
  expect((await a.prepareAttempt(prepare)).attempt.id).toBe(original.id);
  const fresh = (await a.prepareAttempt({ ...prepare, operationId: "fresh" }))
    .attempt;
  expect(fresh.id).not.toBe(original.id);
  expect(fresh.providerIdempotencyKey).not.toBe(
    original.providerIdempotencyKey,
  );
});
it("terminal reconciliation rejects active dispatch leases and cannot regress confirmed money", async () => {
  const original = (await a.prepareAttempt(prepare)).attempt;
  await a.claimAttemptDispatch({
    scope,
    id: original.id,
    now: 2,
    lease: { token: "dispatch", expiresAt: 10 },
    dispatchActor: prepare.actor,
  });
  await expect(
    a.reconcileAttempt({
      scope,
      id: original.id,
      now: 3,
      result: { state: "failed", failure: "expired", checkoutSessionId: "cs" },
    }),
  ).rejects.toThrow("still active");
  await a.applyPaymentOutcome({
    scope,
    attemptId: original.id,
    providerPaymentId: "pi",
    money: prepare.invoice.money,
    confirmedAt: 4,
    source: { kind: "reconciliation", reference: "cs" },
  });
  expect(
    (
      await a.reconcileAttempt({
        scope,
        id: original.id,
        now: 11,
        result: {
          state: "failed",
          failure: "expired",
          checkoutSessionId: "cs",
        },
      })
    ).state,
  ).toBe("confirmed");
});
it("a new operation atomically supersedes only never-dispatched stale prepared work", async () => {
  const original = (await a.prepareAttempt(prepare)).attempt;
  const edited = { ...invoice, updatedAt: 2, total: 20 };
  db.prepare("UPDATE invoices SET data=?,updated_at=2 WHERE id='inv'").run(
    JSON.stringify(edited),
  );
  const current = {
    invoiceId: "inv",
    revision: "2",
    fingerprint: invoiceFingerprint(edited),
    money: { currency: "USD" as const, minorUnits: 2000 },
  };
  await expect(
    a.prepareAttempt({
      ...prepare,
      invoice: current,
      requestFingerprint: "edited",
    }),
  ).rejects.toThrow("Operation fingerprint conflict");
  const fresh = (
    await a.prepareAttempt({
      ...prepare,
      invoice: current,
      operationId: "fresh",
      requestFingerprint: "edited",
      now: 3,
    })
  ).attempt;
  expect(fresh.id).not.toBe(original.id);
  expect((await a.getAttempt(scope, original.id))?.state).toBe("failed");
  expect(
    (await a.getInvoiceTimeline(scope, "inv", { limit: 100 })).audit.items.some(
      (e) => e.kind === "payment.superseded",
    ),
  ).toBe(true);
});

it("rejects missing or customer current dispatcher on an owner-prepared intent", async () => {
  const { attempt } = await a.prepareAttempt(prepare);
  const claim = {
    scope,
    id: attempt.id,
    now: 2,
    lease: { token: "dispatch", expiresAt: 10 },
  };
  await expect(
    a.claimAttemptDispatch(
      claim as Parameters<SqliteFinancialStore["claimAttemptDispatch"]>[0],
    ),
  ).rejects.toThrow("dispatcher required");
  await expect(
    a.claimAttemptDispatch({
      ...claim,
      dispatchActor: { kind: "customer", id: "link" },
      capabilityProof: {
        kind: "customer",
        linkId: "link",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        invoiceId: "inv",
        expiresAt: 100,
      },
    }),
  ).rejects.toThrow("durable share capability");
  expect((await a.getAttempt(scope, attempt.id))?.state).toBe("prepared");
});
