# Tallyhand — Product Requirements Document (MVP)

**Version:** 1.0 (MVP)
**License:** Open Source (MIT)
**Distribution:** Self-hostable web app + optional community-hosted free instance
**Build stack assumption:** Claude Code (primary implementation), Codex (completions / refactors), Cursor (editor-side edits, chat, debugging)

---

## 1. What is Tallyhand?

**Tallyhand** is a free, open-source web app that gives independent contractors a single place to track time, manage clients and projects, log expenses, and generate invoices. It runs entirely in the browser with local-first storage, requires no account, and has zero third-party integrations. You own your data, it lives on your device, and the whole thing is free forever.

The name is a play on *"tally"* (counting hours) and *"hired hand"* (the contractor). Short, memorable, no SaaS suffix.

### 1.1 Principles

1. **Free and open-source, forever.** MIT license. No paid tiers, no feature gates, no "Pro" edition.
2. **Local-first.** All data lives in the user's browser (IndexedDB). No server required to use the app.
3. **No integrations.** No Google Calendar, no Slack, no Stripe, no OAuth. Tallyhand does one job well, without dependencies that can break, change pricing, or deprecate.
4. **Self-hostable in one command.** A single Docker image or `npm run build` gives anyone their own instance.
5. **Portable data.** Every byte the user creates can be exported to JSON or CSV at any moment.

### 1.2 Goals

1. Ship a usable v1 in **6 weeks** with a solo builder using AI coding tools.
2. Reach **1,000 GitHub stars** and **500 weekly active users** within 90 days of launch.
3. Become the default answer on r/freelance and Hacker News when someone asks "what's the simplest contractor tracker?"

### 1.3 Non-Goals

- Multi-user, team, or agency mode.
- Payment processing or payment collection.
- Any third-party API integrations.
- Mobile native apps (the web app must be responsive and PWA-installable — that's enough).
- Bookkeeping or double-entry accounting.

### 1.4 Target User

A single independent contractor billing 1–10 clients — hourly, fixed-fee, or retainer. They want to stop reconstructing their week from memory on Friday night. They don't trust SaaS with their business data. They like tools that respect their time and attention.

---

## 2. What Makes Tallyhand Different

Most time trackers are either bloated (QuickBooks, Harvest) or skeletal (a spreadsheet). Tallyhand stands out through a small number of deliberate design choices that no competitor combines:

### 2.1 The Stop-Prompt
When the user stops the timer, Tallyhand doesn't silently save an entry. It opens a **Stop Prompt** — a focused dialog that asks: *What did you just do?* The user types a task name, optionally adjusts the end time, picks a project if not already set, and hits Save. This turns every timer session into a structured, billable record without forcing the user to fill anything out *before* starting work. Friction lives at the end, not the beginning.

### 2.2 The Ledger View
Instead of a generic "time entries" list, Tallyhand presents a **Ledger** — a chronological, scannable feed of everything that happened across clients, projects, time, and expenses. Think of it as your contractor's journal. One view, filterable, searchable, exportable. It's how you answer "what did I do for ClientX in March?" in under ten seconds.

### 2.3 Invoice-From-Selection
Most tools make you create an invoice, then attach line items. Tallyhand flips this: in the Ledger, the user selects entries (checkboxes or drag-select), clicks **"Invoice these"**, picks a client, and a draft invoice is generated from the selection. The natural direction of thought — "these hours need billing" — maps directly to the action.

### 2.4 The Weekly Reckoning
Every Friday at a user-chosen time, Tallyhand opens a dedicated **Reckoning** view: a full-screen summary of the week's tracked hours, unbilled time, expenses, and any gaps in the calendar. It prompts the user to fill in any missing entries, then generate invoices for any client with unbilled time. It's a ritual, not a reminder. Reckoning is the single feature most likely to change whether a contractor actually uses the app consistently.

### 2.5 Human-Readable Export
Tallyhand exports to JSON and CSV — but also to a single, hand-editable **Markdown ledger file**. A contractor who wants to leave Tallyhand, fork it, or archive their work can open that `.md` file in any text editor and read their history like a journal. No lock-in, ever.

### 2.6 Offline-First, Keyboard-First
The entire app works offline. Every primary action has a keyboard shortcut shown in a command palette (⌘K). Start timer, stop timer, new client, new invoice, jump to Ledger — all without touching the mouse.

### 2.7 Public Invoice Links (Self-Hosted Only)
If the user self-hosts Tallyhand on a domain, they can publish a generated invoice at a public, tokenized URL to share with clients. No server-side state beyond the invoice itself. No client login. No tracking pixels.

---

## 3. Core User Stories

1. As a contractor, I can create clients and projects and assign default hourly rates.
2. As a contractor, I can start a timer tied to a project with one click or one keystroke.
3. As a contractor, when I stop the timer, I'm prompted for a task name and can adjust start/end times before saving.
4. As a contractor, I can add time entries manually after the fact — date, start, end, project, task name.
5. As a contractor, I can see every entry in a unified Ledger view, filter by client/project/date, and search by task name.
6. As a contractor, I can log expenses (amount, category, date, optional note, optional client/project).
7. As a contractor, I can select ledger entries and generate a draft invoice from them in one action.
8. As a contractor, I can customize invoice appearance (logo, colors, footer, payment instructions) and export to PDF.
9. As a contractor, I can run a Weekly Reckoning every Friday that shows unbilled time, gaps, and nudges me to invoice.
10. As a contractor, I can export all my data to JSON, CSV, or a Markdown ledger — and import it back.

---

## 4. Feature Scope (MVP)

### 4.1 Core Entities
- **Clients** — name, contact info, default hourly rate, notes, archive flag.
- **Projects** — belongs to a client, name, optional rate override, active/archived.
- **Tasks (Time Entries)** — project, task name, start time, end time, duration, optional notes, billed flag.
- **Expenses** — amount, category, date, optional client/project, optional note, optional receipt image (stored as base64 in-browser).
- **Invoices** — client, invoice number, issue date, due date, line items (from selected tasks or manual), status (draft / sent / paid), notes, totals.

### 4.2 Timer
- Persistent timer widget visible from anywhere in the app.
- Start with or without a pre-selected project.
- Keyboard shortcut to start/stop (⌘⇧T).
- On stop → **Stop Prompt** opens with:
  - Task name (required)
  - Project (required; pre-filled if set at start)
  - Start/end time (editable)
  - Notes (optional)
  - Tags (optional, free-form)
- If the user closes the prompt without saving, the entry is preserved as a draft so nothing is lost.

### 4.3 Ledger
- Unified chronological view of tasks and expenses.
- Filters: date range, client, project, billed/unbilled, tagged, search by keyword.
- Bulk select → "Invoice selected" action.
- Inline edit on any row.
- Export current filtered view to CSV, JSON, or Markdown.

### 4.4 Invoices
- Create from ledger selection or from scratch.
- Line items auto-populated from selected tasks, with ability to edit descriptions and amounts.
- Add manual line items (e.g., flat-fee deliverables).
- Invoice numbering with customizable prefix + auto-increment.
- Live preview panel while editing.
- Export to PDF via client-side rendering.
- Mark as sent / mark as paid (manual status updates — no email integration).
- Invoices archived in an Invoices view, searchable.

### 4.5 Expenses
- Standalone form: amount, category (from editable user list), date, note, optional client/project association.
- Optional receipt image upload — stored as base64 in IndexedDB.
- Expenses appear in the Ledger alongside tasks.
- Expenses can be added to invoices as line items (with optional markup).

### 4.6 Weekly Reckoning
- Triggered automatically at a user-configurable day/time (default: Friday 4pm local).
- Full-screen summary: total hours, unbilled hours by client, expenses, unbilled total amount.
- "Gaps" detector: flags weekdays between 9am–5pm with less than 2 hours tracked, prompting the user to fill them in.
- One-click "Invoice all unbilled time for ClientX" actions inline.
- Can be opened manually at any time from the command palette.

### 4.7 Command Palette
- ⌘K to open from anywhere.
- Fuzzy search over actions, clients, projects, tasks, invoices.
- Keyboard-driven navigation.

### 4.8 Settings
- User info (name, business name, address, tax ID, default payment instructions).
- Invoice defaults (logo upload, color, footer, payment terms, invoice number prefix).
- Reckoning schedule.
- Expense categories (editable list).
- Data tools: export all (JSON/CSV/Markdown), import, reset.
- Appearance: light / dark / system.

---

## 5. Technical Architecture

### 5.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | Next.js 14 (App Router) + React + TypeScript | Excellent AI-tool compatibility; deploys anywhere |
| Styling | Tailwind CSS + shadcn/ui | Consistent, maintainable, AI-friendly |
| Local storage | IndexedDB via Dexie.js | True local-first, works offline |
| PDF generation | `@react-pdf/renderer` | Runs client-side, no server dependency |
| PWA | `next-pwa` | Installable, offline-capable |
| Icons | Lucide | Clean, open-source |
| State | Zustand + Dexie-live-queries | Lightweight, reactive to DB |
| Testing | Vitest + Playwright | Standard, well-documented |
| Packaging | Docker + static export option | Self-hostable two ways |

### 5.2 Data Model (conceptual)

```
Client:        id, name, email, address, default_rate, notes, archived, timestamps
Project:       id, client_id, name, rate_override, archived, timestamps
Task:          id, project_id, name, start_at, end_at, duration_minutes,
               notes, tags, is_billed, invoice_id, timestamps
Expense:       id, client_id, project_id, date, amount, category,
               note, receipt_b64, is_billed, invoice_id, timestamps
Invoice:       id, client_id, invoice_number, issue_date, due_date, status,
               line_items, subtotal, total, notes, public_token, timestamps
Settings:      singleton — user info, invoice defaults, reckoning schedule, categories
```

### 5.3 Storage & Portability

All data sits in the browser's IndexedDB. No backend is required for any feature in this PRD. The app ships with:
- **Export all** → downloadable `.json`, `.csv` (per entity), and `.md` (combined ledger).
- **Import** → accepts any previously-exported JSON.
- **Reset** → wipes local database with confirmation.

A self-hosted instance is just the same static build served from a domain. There is no server-side user data.

### 5.4 Distribution

- **GitHub repo** with MIT license, clear README, contributing guide.
- **Community-hosted instance** at a domain like `tallyhand.app` — a plain static deployment, no account system, no analytics beyond privacy-respecting page counts.
- **Docker image** for self-hosters: `docker run -p 3000:3000 tallyhand/tallyhand`.
- **Downloadable static build** for users who want to run from `file://` or a local web server.

---

## 6. Development Stages

Six stages, each roughly one week of solo work with heavy AI-tool leverage. No code is written in this PRD — each stage describes the goal, the outputs, and the AI-tool division of labor.

---

### Stage 0 — Foundation (Week 1)

**Goal:** Project scaffolded, design system in place, local database layer working.

**Outputs:**
- Next.js project initialized, deployed to a preview domain.
- Tailwind + shadcn/ui configured with the core design tokens: typography scale, color palette (light/dark), spacing, shadows.
- Dexie database initialized with the five entity tables.
- App shell: top bar with active timer display, left sidebar nav (Dashboard, Ledger, Clients, Invoices, Expenses, Settings), main content area.
- PWA manifest and service worker configured.
- Empty landing page with project description, GitHub link, and "Launch app" button.

**AI-tool usage:**
- **Claude Code:** scaffold app, set up Dexie schema and typed repository functions, build layout shell.
- **Cursor:** refine Tailwind tokens, responsive breakpoints down to 375px.
- **Codex:** boilerplate completions for repository functions.

**Done when:** The shell renders, the database accepts writes and reads, and the PWA installs on desktop and mobile.

---

### Stage 1 — Clients, Projects, and the Timer (Week 2)

**Goal:** The daily-use loop works end to end.

**Outputs:**
- `/clients` — list, create, edit, archive.
- `/clients/[id]` — detail view with associated projects.
- Project CRUD nested under client.
- Persistent timer widget with project picker, start/stop controls, and elapsed display.
- Stop Prompt dialog: task name, project, editable start/end, notes, tags.
- Keyboard shortcut ⌘⇧T to toggle timer.
- Draft entry preservation if the Stop Prompt is dismissed.
- Manual time entry form for after-the-fact logging.

**AI-tool usage:**
- **Claude Code:** CRUD flows with react-hook-form + zod, timer state machine, Stop Prompt.
- **Cursor:** UX refinement on the prompt — focus handling, time editing controls.
- **Codex:** date and duration utility completions.

**Done when:** A user can create a client and project, start the timer, work for any duration, stop it, fill in the Stop Prompt, and see the saved task in the database.

---

### Stage 2 — Ledger and Command Palette (Week 3)

**Goal:** A single unified view of the user's work, with keyboard-first navigation.

**Outputs:**
- `/ledger` — chronological feed of tasks and expenses (expenses stubbed with seed data for now).
- Filters: date range, client, project, billed/unbilled, tag, search.
- Inline edit on any row.
- Bulk selection via checkbox or shift-click.
- Export current view to CSV, JSON, Markdown.
- Command Palette (⌘K): fuzzy-searchable actions and entities.
- Dashboard showing this-week totals, unbilled amount, and recent entries.

**AI-tool usage:**
- **Claude Code:** ledger virtualization for performance, command palette search index.
- **Cursor:** keyboard interaction polish, focus traps.

**Done when:** A user with 100+ entries can filter, search, edit inline, and select rows, and all major actions are reachable via ⌘K.

---

### Stage 3 — Invoicing (Week 4)

**Goal:** Turn selected ledger entries into a professional PDF invoice.

**Outputs:**
- `/invoices` — list view of all invoices with status badges.
- "Invoice selected" action from the Ledger → new invoice flow pre-populated with line items.
- Invoice editor: header (client, dates, numbers), line items (editable descriptions and amounts), manual line item additions, subtotal and total, notes, payment instructions.
- Live preview panel showing the rendered invoice.
- PDF export via `@react-pdf/renderer`.
- Invoice numbering with user-configurable prefix.
- Mark-as-sent, mark-as-paid status actions.
- Invoice appearance settings: logo, accent color, footer text.

**AI-tool usage:**
- **Claude Code:** PDF template component, invoice editor, preview sync.
- **Cursor:** visual iteration on the invoice design — this requires human review to look good.

**Done when:** The user selects a week of tasks, clicks Invoice, edits the draft, and exports a PDF they'd be willing to send to a real client.

---

### Stage 4 — Expenses and Weekly Reckoning (Week 5)

**Goal:** Complete the contractor's toolkit with the signature ritual feature.

**Outputs:**
- Expense entry form with category, amount, date, optional client/project, optional receipt image (base64).
- Expenses appear in the Ledger.
- Expenses can be added as invoice line items, with optional markup percentage.
- **Weekly Reckoning** full-screen view:
  - Triggered on user-set schedule (default Friday 4pm).
  - Shows weekly summary: hours, unbilled hours by client, expenses, total unbilled dollars.
  - Gap detector highlights weekday business-hours blocks with under two hours tracked.
  - Inline "Invoice ClientX's unbilled time" actions.
  - Accessible anytime via the command palette.
- Settings page complete: user info, invoice defaults, reckoning schedule, categories, appearance, data tools.

**AI-tool usage:**
- **Claude Code:** reckoning aggregation logic, gap detection algorithm, settings page.
- **Cursor:** the reckoning UX is high-signal; iterate on layout and copy.

**Done when:** The founder uses the Reckoning on a real Friday, fills in gaps, and generates a real invoice from it.

---

### Stage 5 — Polish, Docs, and Launch (Week 6)

**Goal:** Open-source release, public launch, community foundation.

**Outputs:**
- Empty states, loading states, error boundaries across every page.
- Full keyboard shortcut reference page.
- Data import flow tested against exported JSON.
- Markdown ledger export verified to round-trip.
- Light/dark/system theme finalized.
- GitHub repository public with:
  - MIT license
  - README with screenshots, feature list, quickstart
  - `CONTRIBUTING.md` and a code of conduct
  - Docker build file and instructions
  - Issue templates
- Community-hosted instance deployed to a domain.
- Launch: Hacker News "Show HN", r/freelance, r/selfhosted, Product Hunt.
- Public invoice link feature enabled for self-hosted instances (tokenized URL, read-only invoice view).

**AI-tool usage:**
- **Claude Code:** Docker packaging, public invoice view route, README generation.
- **Cursor:** final UX polish pass.

**Done when:** The repo is public, the hosted instance is live, and a new user can go from landing page to first tracked task in under two minutes.

---

## 7. Success Metrics (90 days post-launch)

| Metric | Target |
|---|---|
| GitHub stars | 1,000 |
| Weekly active users (hosted instance) | 500 |
| Self-hosted instances reported | 100+ |
| Community PRs merged | 10+ |
| Average Reckoning completions per active user per month | 2+ |
| User-reported "replaced my spreadsheet" testimonials | 25+ |

---

## 8. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Local-first data loss when a user clears their browser data | Medium | Prominent onboarding notice, weekly export reminder, one-click JSON backup |
| PDF quality doesn't match a good Google Doc template | Medium | Dedicate full days in Stage 3 and Stage 5 to visual iteration; get contractor friends to review |
| Feature creep from community requests | High | Maintain a strict out-of-scope list in the README; a public "considered and declined" log |
| No monetization means the project dies when the founder loses interest | Medium | Open-source license ensures forkability; encourage co-maintainers from Day 1 |
| Community-hosted instance gets abused (storage quota, etc.) | Low | No server storage — data is in the user's browser; hosting cost is near-zero |

---

## 9. Out of Scope for MVP

These are tracked publicly in the repo as "considered and not planned" so users know what Tallyhand will never become, or "considered and deferred" for possible future work by the community:

- Any third-party integrations (Google, Slack, Stripe, QuickBooks, Xero, etc.)
- Payment processing or payment link generation
- Multi-user, team, or agency mode
- Cloud sync across devices
- Mobile native apps
- Tax estimation or 1099 generation
- Recurring invoices
- Multi-currency support in a single instance
- Contract templates
- Client-side login or accounts

---

## 10. Open Questions

1. Should the Markdown ledger export be the *canonical* format, with JSON as a secondary? A Markdown-first approach would emphasize the "your data is forever yours" value.
2. Should the Stop Prompt allow rounding to nearest 5/10/15 minutes as a setting? Contractors bill differently.
3. How opinionated should the default invoice template be? One polished template vs three style options.
4. Should cross-device sync be addressable via the user pointing Tallyhand at their own cloud storage (e.g., a folder they sync with Dropbox/iCloud), rather than a server we operate? This preserves the "no integrations" principle while solving the multi-device problem.