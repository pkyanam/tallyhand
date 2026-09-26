/**
 * Payment-request plugin slot (stub — Stripe is NOT implemented).
 *
 * The public invoice portal (`/share/[token]`) renders a Pay button. When
 * clicked it calls `requestSharePayment(...)`. By default no handler is
 * registered and the UI explains that payments aren't configured.
 *
 * A payment integration (Stripe, etc.) plugs in by calling
 * `onSharePaymentRequested(handler)` once at startup — e.g. in a plugin
 * module loaded by the host — and handling the redirect/checkout itself.
 *
 * Contract: the handler receives everything needed to start a checkout and
 * is responsible for the entire payment UX. Tallyhand never sees card data.
 */
export interface SharePaymentRequest {
  /** Signed share token (proves the payer may view this invoice). */
  shareToken: string;
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  customerEmail?: string;
}

export type SharePaymentHandler = (req: SharePaymentRequest) => SharePaymentResult | Promise<SharePaymentResult>;

/** What a handler may return: a checkout URL to redirect the payer to. */
export type SharePaymentResult = { checkoutUrl?: string } | void;

let handler: SharePaymentHandler | null = null;

/** Register the payment handler (call once at startup from a plugin). */
export function onSharePaymentRequested(h: SharePaymentHandler): void {
  handler = h;
}

/** True when a payment integration has registered itself. */
export function hasSharePaymentHandler(): boolean {
  return handler !== null;
}

/**
 * Invoke the registered payment handler. Resolves `{ handled: false }` when
 * no payment integration is configured (the UI then shows the "not
 * configured" state); otherwise `{ handled: true, checkoutUrl? }`.
 */
export async function requestSharePayment(
  req: SharePaymentRequest,
): Promise<{ handled: boolean; checkoutUrl?: string }> {
  if (!handler) return { handled: false };
  const result = (await handler(req)) ?? {};
  return { handled: true, checkoutUrl: result.checkoutUrl };
}

/** Test/plugin helper: clear the registered handler. */
export function resetSharePaymentHandlerForTests(): void {
  handler = null;
}
