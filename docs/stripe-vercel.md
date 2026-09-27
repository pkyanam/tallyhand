# Stripe payments on Vercel (test mode)

Tallyhand's online payments run on Stripe-hosted **Checkout Sessions** —
Tallyhand never sees card data, and there is no client-side Stripe.js
(`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is intentionally not used). The flow:

1. Client opens the portal `/share/[token]` and clicks **Pay this invoice**.
2. `POST /api/share/pay` delegates to the `stripe-payments` plugin, which
   calls `createInvoiceCheckoutSession()` → Stripe Checkout Session for the
   full invoice balance → payer is redirected to `checkout.url`.
3. After payment, Stripe POSTs `checkout.session.completed` to
   `/api/v1/stripe/webhook`, which verifies the `stripe-signature` header
   (HMAC-SHA256, same construction as the Stripe SDK's `constructEvent`,
   implemented dependency-free in `src/plugins/stripe/stripe-client.ts`),
   checks the session is `paid` in the invoice's currency for at least the
   invoice total, marks the invoice paid, and emits `onInvoicePaid` +
   `onPaymentReceived`.

Programmatic access: `POST /api/v1/stripe/payment-links` (API-token auth,
idempotent) returns `{ sessionId, url, … }` for any sent invoice.

## Vercel setup (test mode)

1. Stripe dashboard → toggle **TEST MODE** on → Developers → API keys →
   copy the **Secret key** (`sk_test_…`).
2. Developers → Webhooks → (still in test mode) → **Add endpoint**:
   `https://<your-app>.vercel.app/api/v1/stripe/webhook`,
   events to send: `checkout.session.completed` →
   copy the **Signing secret** (`whsec_…`).
3. Vercel → project → Settings → Environment Variables:
   - `STRIPE_SECRET_KEY` = `sk_test_…`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_…`
   - No app-URL variable needed: the base URL falls back to `VERCEL_URL`
     automatically. Self-hosters set `TALLYHAND_APP_URL`.
4. Redeploy. Open a sent invoice's share link in test mode and pay with
   card `4242 4242 4242 4242` (any future expiry, any CVC) — the portal
   should return to `?paid=1` and the invoice should flip to **paid** after
   the webhook lands (a few seconds; Stripe dashboard → test webhooks shows
   delivery attempts).

## Test-mode safety notes

- `stripeKeyMode()` classifies the key from its prefix; a live key
  (`sk_live_…`) still works but logs a loud server warning every time a
  checkout session is created. Test mode is the documented default.
- The webhook is idempotent: already-paid invoices are a no-op, so Stripe's
  retries can't double-apply. Sessions that aren't `paid`, are in the wrong
  currency, or are for less than the invoice total are logged and skipped.
- Without `STRIPE_SECRET_KEY` the plugin registers nothing: the portal Pay
  button shows "Online payment isn't configured" and both API routes return
  400 with a clear message. Local mode is untouched.

## Cost

Test mode is free and unlimited. Live mode (whenever the user opts in)
costs Stripe's standard 2.9% + $0.30 per successful card charge, billed by
Stripe — Tallyhand itself adds no fee and no paywall.
