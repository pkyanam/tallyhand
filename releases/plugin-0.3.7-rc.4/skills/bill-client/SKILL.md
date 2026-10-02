---
name: bill-client
description: "Prepare, review and manage Tallyhand invoice drafts, recurring schedules, retainers, public invoice or timesheet links and overdue reminders."
---

# Bill a client safely

Read the client's project, settings, existing draft invoices and relevant unbilled work. Determine an explicit date window and timezone. Exclude source entries already present in an existing draft. Check terms, rate, currency, tax and payment instructions before calculating totals; do not assume Net 14.

Create a draft only after the requested work and totals are clear. Review source IDs, line amounts, due date and totals. Cloud drafts create a live public-capability link by default. Explain that anyone with the link can view the invoice/PDF, and use cloudLinkEnabled=false if sharing is not approved. Creating a draft does not send it or mark it paid. Never infer payment from a draft, due date, reminder or a verbal plan to pay.

Preview recurring schedules before saving. A schedule requires an actual runner. Current unbilled schedules sweep all dates and reserve sources when generating drafts; explain this limitation instead of promising a previous-calendar-month policy.

Use preview_overdue_reminders before run_overdue_reminders. Show recipients, message purpose and any configured late fees, then obtain explicit approval. To share, identify the target, public-link audience and expiry first; create_share_link requires confirmPublicSharing=true. Return the capability URL only to the user unless they explicitly ask to send it elsewhere.

Use get_invoice to read the complete saved invoice and its shareUrl/pdfUrl. Use update_invoice to edit draft lineItems, clientId, dates, notes, paymentMethod, currency or template; lineItems replaces the entire list, so preserve sourceType/sourceId for tracked work. Return the actual shareUrl and pdfUrl to the user. Do not invent URLs or generate a substitute PDF. If links are null, explain the sharingWarning or ask to enable cloudLinkEnabled. Disabling cloudLinkEnabled revokes existing links; re-enabling creates a new one. Downloading a PDF never sends an invoice or changes its draft status. Use send_invoice only when issuing/marking sent is approved, then get_invoice for the current links. For payment-account authorization use get_control_link. Tools record financial activity; they do not transfer money or sign contracts.

## Tool availability
The tallyhand MCP dependency supplies the account tools. For setup, get_settings and update_settings are separate required operations. If a required tool is not initially visible, use the host’s tool-discovery/search facility by its exact name. If it is still absent, report the missing tool and check the installed plugin’s scanned tool list; do not claim the account API lacks that operation or invent an alternate tool. A newly deployed schema may require the plugin connection to be refreshed/rescanned and a new conversation.

## Billing email and scheduling contract
business.email is one primary contact address. business.billingEmails is an array of up to 10 additional valid contact addresses displayed on invoices; it does not add outgoing-email recipients. Both invoice preview and PDF display the deduplicated addresses.
The open web app checks due schedules at startup and every 15 minutes, throttled to one automatic run per hour per browser. Creating a schedule does not create always-on server cron. An external authenticated runner is required for unattended execution while the app is closed. Schedule runs create drafts; they do not send invoices or record payment.

## Data boundaries
Never request or transmit credentials, government identifiers, payment-card data or health records. Use secure application controls for restricted fields.
