import type { Money } from "./money";
import type { InvoiceManualPaymentAssertion } from "../entities";

export interface WorkspaceIdentity {
  readonly userId: string;
  readonly workspaceId: string;
}
export interface FinancialScope extends WorkspaceIdentity {
  readonly provider: "stripe";
  readonly accountId: string;
  readonly mode: "test" | "live";
}
export interface InvoiceSnapshot {
  readonly invoiceId: string;
  readonly revision: string;
  readonly fingerprint: string;
  readonly money: Money;
}
export interface FinancialActor {
  readonly kind: "owner" | "agent" | "customer" | "system";
  readonly id: string;
}
export interface PaymentRequest {
  readonly id: string;
  readonly scope: FinancialScope;
  readonly invoice: InvoiceSnapshot;
  readonly createdAt: number;
}
export type AttemptState =
  "prepared" | "dispatching" | "pending" | "unknown" | "confirmed" | "failed";
export interface Lease {
  readonly token: string;
  readonly expiresAt: number;
}
export interface PaymentAttempt extends PaymentRequest {
  readonly requestId: string;
  readonly operationId: string;
  readonly requestFingerprint: string;
  readonly providerIdempotencyKey: string;
  readonly actor: FinancialActor;
  readonly state: AttemptState;
  readonly updatedAt: number;
  readonly lease?: Lease;
  readonly checkoutSessionId?: string;
  readonly checkoutUrl?: string;
  readonly providerPaymentId?: string;
  readonly failure?: string;
}
export interface Payment {
  readonly id: string;
  readonly scope: FinancialScope;
  readonly invoice: InvoiceSnapshot;
  readonly attemptId: string;
  readonly providerPaymentId: string;
  readonly money: Money;
  readonly confirmedAt: number;
}
export interface Allocation {
  readonly id: string;
  readonly paymentId: string;
  readonly invoiceId: string;
  readonly money: Money;
}
export type RefundState = "pending" | "failed" | "confirmed";
export interface Refund {
  readonly id: string;
  readonly scope: FinancialScope;
  readonly paymentId: string;
  readonly providerPaymentId: string;
  readonly providerRefundId: string;
  readonly money: Money;
  readonly state: RefundState;
  readonly updatedAt: number;
  readonly failure?: string;
}
export interface ProviderEvent {
  readonly id: string;
  readonly scope: FinancialScope;
  readonly providerEventId: string;
  readonly type: string;
  readonly payload: string;
  readonly receivedAt: number;
  readonly state:
    "received" | "processing" | "processed" | "retry" | "quarantined";
  readonly lease?: Lease;
  readonly retryAt?: number;
  readonly failure?: string;
}
export interface AuditEvent {
  readonly id: string;
  readonly workspace: WorkspaceIdentity;
  readonly invoiceId: string;
  readonly kind: string;
  readonly actor: FinancialActor;
  readonly createdAt: number;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}
export interface OutboxRecord {
  readonly id: string;
  readonly workspace: WorkspaceIdentity;
  readonly auditEventId: string;
  readonly topic: string;
  readonly payload: string;
  readonly state: "pending" | "delivering" | "delivered" | "failed";
  readonly attempts: number;
  readonly availableAt: number;
  readonly lease?: Lease;
  readonly failure?: string;
}
/** Manual assertions remain evidence; they never manufacture a provider payment. */
export interface ManualPaymentEvidence {
  readonly id: string;
  readonly workspace: WorkspaceIdentity;
  readonly invoiceId: string;
  readonly money: Money;
  readonly actor: FinancialActor;
  readonly recordedAt: number;
  readonly note: string;
  readonly reference?: string;
}
export interface PageQuery {
  readonly cursor?: string;
  readonly limit: number;
}
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}
export interface InvoiceTimeline {
  /** Invoice projection supplied by the owner-facing API, separate from provider ledger. */
  manualAssertion?: InvoiceManualPaymentAssertion;
  invoiceStatus?: "draft" | "sent" | "paid";
  readonly attempts: readonly PaymentAttempt[];
  readonly payments: readonly Payment[];
  readonly allocations: readonly Allocation[];
  readonly refunds: readonly Refund[];
  readonly manualEvidence: readonly ManualPaymentEvidence[];
  readonly audit: Page<AuditEvent>;
}
