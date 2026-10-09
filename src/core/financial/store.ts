import type { Money } from "./money";
import type {
  FinancialGrantProof,
  FinancialCapabilityProof,
} from "./authority";
import type {
  Allocation,
  AuditEvent,
  FinancialActor,
  FinancialScope,
  InvoiceSnapshot,
  InvoiceTimeline,
  Lease,
  ManualPaymentEvidence,
  OutboxRecord,
  Page,
  PageQuery,
  Payment,
  PaymentAttempt,
  ProviderEvent,
  Refund,
  RefundState,
  WorkspaceIdentity,
} from "./types";

export interface PrepareAttemptInput {
  readonly scope: FinancialScope;
  readonly invoice: InvoiceSnapshot;
  readonly operationId: string;
  readonly requestFingerprint: string;
  readonly actor: FinancialActor;
  readonly now: number;
  readonly authorityProof?: FinancialGrantProof;
  readonly capabilityProof?: FinancialCapabilityProof;
}
export interface ClaimInput {
  readonly scope: FinancialScope;
  readonly id: string;
  readonly now: number;
  readonly lease: Lease;
  readonly authorityProof?: FinancialGrantProof;
  readonly capabilityProof?: FinancialCapabilityProof;
}
export type DispatchResult =
  | {
      readonly state: "pending";
      readonly checkoutSessionId: string;
      readonly checkoutUrl: string;
      readonly providerPaymentId?: string;
    }
  | { readonly state: "unknown" | "failed"; readonly failure: string };
export type ReconciliationResult =
  | Extract<DispatchResult, { state: "pending" }>
  | {
      readonly state: "failed";
      readonly failure: string;
      readonly checkoutSessionId: string;
      readonly checkoutUrl?: never;
      readonly providerPaymentId?: never;
    };
export interface PaymentOutcomeInput {
  readonly scope: FinancialScope;
  readonly attemptId: string;
  readonly providerPaymentId: string;
  readonly money: Money;
  readonly confirmedAt: number;
  readonly source:
    /** Internal durable receipt ID (ProviderEvent.id), not Stripe's event ID. */
    | { readonly kind: "event"; readonly eventId: string }
    | { readonly kind: "reconciliation"; readonly reference: string };
}
export interface RefundOutcomeInput {
  readonly scope: FinancialScope;
  readonly providerPaymentId: string;
  readonly providerRefundId: string;
  readonly money: Money;
  readonly state: RefundState;
  readonly observedAt: number;
  readonly source: PaymentOutcomeInput["source"];
  readonly failure?: string;
}

/**
 * All writes are atomic backend operations, never asynchronous CRUD compositions.
 * Adapters must enforce workspace scope, lease fencing and scoped unique keys.
 * Preparation reuses the outstanding invoice intent across operation IDs; the
 * same operation ID with a different fingerprint conflicts. Authorization is
 * checked again by orchestration before dispatch, not inferred from this record.
 */
export interface FinancialStore {
  prepareAttempt(
    input: PrepareAttemptInput,
  ): Promise<{ attempt: PaymentAttempt; reused: boolean }>;
  /** Claim only prepared work. An expired dispatch lease requires reconciliation, never redispatch. */
  claimAttemptDispatch(input: ClaimInput & { readonly dispatchActor: FinancialActor }): Promise<PaymentAttempt | null>;
  /** Fence by lease token; a late response cannot overwrite confirmed state. */
  recordAttemptDispatch(
    input: ClaimInput & { readonly result: DispatchResult },
  ): Promise<PaymentAttempt>;
  /** Provider read proved the existing checkout identity. Never redispatches,
   * never regresses confirmed state, and rejects conflicting session IDs. */
  reconcileAttempt(input: {
    readonly scope: FinancialScope;
    readonly id: string;
    readonly now: number;
    readonly result: ReconciliationResult;
  }): Promise<PaymentAttempt>;
  getAttempt(scope: FinancialScope, id: string): Promise<PaymentAttempt | null>;
  /** Receipt commit precedes HTTP acknowledgement; dedup by scoped provider event ID. */
  receiveProviderEvent(
    input: Omit<
      ProviderEvent,
      "id" | "state" | "lease" | "retryAt" | "failure"
    >,
  ): Promise<{ event: ProviderEvent; reused: boolean }>;
  claimProviderEvent(input: ClaimInput): Promise<ProviderEvent | null>;
  finishProviderEvent(
    input: ClaimInput & {
      readonly state: "processed" | "retry" | "quarantined";
      readonly retryAt?: number;
      readonly failure?: string;
    },
  ): Promise<void>;
  /** Validate against frozen attempt; unique scoped payment identity; commit audit/outbox together.
   * An event source must refer to a durably received event in the same scope.
   */
  applyPaymentOutcome(
    input: PaymentOutcomeInput,
  ): Promise<{ payment: Payment; allocation: Allocation; reused: boolean }>;
  /** Unknown parent payment is retryable, never silently discarded. Confirmed state cannot regress. */
  applyRefundOutcome(
    input: RefundOutcomeInput,
  ): Promise<{ refund: Refund; reused: boolean }>;
  recordManualEvidence(
    input: Omit<ManualPaymentEvidence, "id">,
  ): Promise<ManualPaymentEvidence>;
  getInvoiceTimeline(
    workspace: WorkspaceIdentity,
    invoiceId: string,
    query: PageQuery,
  ): Promise<InvoiceTimeline>;
  listPayments(
    workspace: WorkspaceIdentity | FinancialScope,
    query: PageQuery,
  ): Promise<Page<Payment>>;
  listResumableWork(
    scope: FinancialScope,
    now: number,
    query: PageQuery,
  ): Promise<Page<PaymentAttempt | ProviderEvent>>;
  claimOutbox(
    workspace: WorkspaceIdentity,
    now: number,
    lease: Lease,
  ): Promise<OutboxRecord | null>;
  finishOutbox(
    workspace: WorkspaceIdentity,
    id: string,
    leaseToken: string,
    result: {
      readonly delivered: boolean;
      readonly now: number;
      readonly retryAt?: number;
      readonly failure?: string;
    },
  ): Promise<void>;
}

export type FinancialRecord =
  PaymentAttempt | Payment | Allocation | Refund | AuditEvent | OutboxRecord;
