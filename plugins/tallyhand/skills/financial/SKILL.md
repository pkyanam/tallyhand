---
name: financial
description: "Inspect collection records, recover known financial work, or prepare an explicitly authorized invoice checkout."
---

Use `request_financial_operation` for `timeline`, `payments`, `reconcile`, or `checkout`.
Require an owner-issued financial grant ID for the exact principal, Stripe account,
mode and action. General `tally:read`, `tally:write` or `tally:manage` consent does
not authorize collection. Never mint or broaden a grant through bearer access.
The grant ID is a reference, not a credential; do not store bearer credentials.

Before checkout, review the saved sent invoice and obtain the user's authorization
to collect its amount. Supply `invoiceId`, an explicit collect grant and a stable
`operationId`; reuse that ID for retries. Checkout creates a payer link, not proof
of payment. Do not claim payment until financial history confirms the collection.

HTTP 202 means pending or uncertain work requiring inspection/reconciliation,
not confirmed payment. HTTP 501 means unsupported backend; do not invent success
or bypass authority. For 403, request owner review of the separate grant. Recovery
only processes known work and never blindly creates a second checkout.

Keep pending and failed refunds separate from confirmed refunds. Manual payment
evidence is an owner assertion, not provider confirmation. Stripe collection
records are not bank balances, payouts or settlement verification. Refund
initiation is unavailable through this tool. Preserve returned continuation
cursors when reading or reconciling bounded pages.
