---
name: bill-client
description: "Prepare, review and manage Tallyhand invoice drafts, recurring schedules, retainers, public invoice or timesheet links and overdue reminders."
---

# Bill a client safely

Read the client's project, settings, existing draft invoices and relevant unbilled work. Determine an explicit date window and timezone. Exclude source entries already present in an existing draft. Check terms, rate, currency, tax and payment instructions before calculating totals; do not assume Net 14.

Create a draft only after the requested work and totals are clear. Review source IDs, line amounts, due date and totals. Creating a draft is separate from sending it, marking it paid or sharing it publicly. Never infer payment from a draft, due date, reminder or a verbal plan to pay.

Preview recurring schedules before saving. A schedule requires an actual runner. Current unbilled schedules sweep all dates and reserve sources when generating drafts; explain this limitation instead of promising a previous-calendar-month policy.

Use preview_overdue_reminders before run_overdue_reminders. Show recipients, message purpose and any configured late fees, then obtain explicit approval. To share, identify the target, public-link audience and expiry first; create_share_link requires confirmPublicSharing=true. Return the capability URL only to the user unless they explicitly ask to send it elsewhere.

For PDF printing or payment-account authorization use get_control_link. Tools record financial activity; they do not transfer money or sign contracts.
