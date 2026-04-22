# Tallyhand — Remaining Work

**For the next agent.** This doc is the working backlog. The authoritative product spec is `PRD.md` at the repo root — read it before starting anything substantial. This file is intentionally concrete: what's done, what's not, conventions in use, and gotchas already discovered.

Last updated at end of Stage 0 (foundation).

---

## 1. What is already done (Stage 0)

- Next.js 14 (App Router) + TypeScript + Tailwind scaffolded.
- shadcn/ui tokens wired via HSL CSS vars (light/dark). Base components: `Button`, `Input`, `Label`, `Card`, `Dialog`, `Separator`, `Badge`.
- Dexie v1 schema with `Client`, `Project`, `Task`, `Expense`, `Invoice`, `Settings` tables + typed repositories.
- App shell at route group `(app)`: left sidebar nav, sticky topbar with timer-widget stub, ⌘K button stub, theme toggle.
- Stub pages for `/dashboard`, `/ledger`, `/clients`, `/invoices`, `/expenses`, `/settings`.
- Landing page at `/` with "Launch app" CTA.
- PWA: `manifest.webmanifest`, SVG icons, `next-pwa` service worker (only active in production builds).
- GitHub remote wired to `https://github.com/pkyanam/tallyhand`.

---

## 2. Stack and where things live

```
src/
├── app/
│   ├── layout.tsx              # root layout — fonts, ThemeProvider, metadata
│   ├── page.tsx                # marketing landing page
│   └── (app)/                  # route group sharing the sidebar+topbar shell
│       ├── layout.tsx
│       ├── dashboard/page.tsx
│       ├── ledger/page.tsx
│       ├── clients/page.tsx
│       ├── invoices/page.tsx
│       ├── expenses/page.tsx
│       └── settings/page.tsx
├── components/
│   ├── app/                    # app-shell pieces (sidebar, topbar, timer widget, page header)
│   ├── ui/                     # shadcn-style primitives
│   ├── theme-provider.tsx
│   └── theme-toggle.tsx
└── lib/
    ├── utils.ts                # cn(), formatCurrency(), formatDuration()
    └── db/
        ├── types.ts            # entity interfaces, DEFAULT_SETTINGS
        ├── schema.ts           # TallyhandDB class, getDB() factory
        ├── id.ts               # newId(prefix), now()
        ├── repos.ts            # clientRepo / projectRepo / taskRepo / expenseRepo / invoiceRepo / settingsRepo
        └── index.ts
```

Installed but unused so far: `zustand`, `react-hook-form`, `@hookform/resolvers`, `zod`, `date-fns`, `cmdk`, `@react-pdf/renderer`, `dexie-react-hooks`, several Radix primitives.

---

## 3. Conventions to follow

- **Paths:** always use `@/*` alias (maps to `src/*`).
- **Data access:** always go through the repo helpers in `src/lib/db/repos.ts`. Do not call Dexie directly from components. `getDB()` throws if called on the server, so guard accordingly.
- **Live queries:** use `useLiveQuery` from `dexie-react-hooks` in client components. Keep the repos as the query surface — compose inside the hook call.
- **IDs:** use `newId("cli" | "prj" | "tsk" | "exp" | "inv")` from `src/lib/db/id.ts`. IDs are strings; don't use auto-increment.
- **Forms:** react-hook-form + zod resolver. Co-locate schemas with the form, not in shared files, until there's a second consumer.
- **Styling:** Tailwind only. Use the CSS vars (`bg-background`, `text-muted-foreground`, etc.) — no hard-coded hex. `cn()` from `@/lib/utils` to merge classes.
- **Icons:** lucide-react 1.8.0 is installed. **It does not ship brand logos** (no `Github`, `Twitter`, etc.). If you need a brand glyph, inline an SVG. See the `GithubIcon` in `src/app/page.tsx` for the pattern.
- **Client vs server components:** default to server components. Mark `"use client"` only when you need state, effects, browser APIs, or Dexie. Dexie imports force a client component.
- **Timestamps:** `createdAt` / `updatedAt` are epoch ms numbers, set by the repos. Don't set them in callers.

---

## 4. Known gotchas

1. **lucide-react is 1.8.0, not 0.x.** Surprising — the npm registry resolves `lucide-react@latest` to `1.8.0`, which has a different icon set than the `0.4xx` line most docs reference. Brand logos are missing. If you need `0.x`, pin explicitly.
2. **next-pwa is CJS.** The config in `next.config.mjs` uses `createRequire` to load it. Don't convert to a top-level `import`.
3. **Dexie is browser-only.** `getDB()` throws server-side. Always use it from client components or inside effects/handlers.
4. **PWA service worker is disabled in dev.** `next-pwa` only emits `sw.js` on `next build`. Test offline behavior against `npm run build && npm start`.
5. **Route group `(app)` vs root `/`:** landing page lives at `src/app/page.tsx` (root layout). App lives under `src/app/(app)/...` which injects the sidebar+topbar shell. Don't collapse these.

---

## 5. Stage 0 loose ends

- [ ] Add `LICENSE` file (MIT) at repo root. `package.json` declares MIT but there's no LICENSE file.
- [ ] Verify PWA installs on desktop Chrome + iOS Safari + Android Chrome against a production build.
- [ ] Preview deploy (Vercel recommended — static-friendly, no server-side state needed).
- [ ] `public/` has SVG icons only. Generate PNG fallbacks (192, 512) for broader PWA compatibility if testing reveals install issues.

---

## 6. Stage 1 — Clients, Projects, and the Timer

**Goal:** The daily-use loop works end to end.

### Clients
- [ ] `/clients` — list view. Columns: name, default rate, project count, last activity. Actions: new, edit, archive.
- [ ] `/clients/new` and `/clients/[id]/edit` forms (react-hook-form + zod). Fields per `Client` interface.
- [ ] `/clients/[id]` detail view. Shows client info + list of projects + recent tasks.
- [ ] Archive (soft delete) via `clientRepo.archive()`. Archived clients are hidden from pickers but visible in an "Archived" tab.

### Projects
- [ ] Nested under `/clients/[id]` — inline project CRUD.
- [ ] Rate override field (falls back to client `defaultRate` when unset).
- [ ] Archive flag (same pattern as clients).

### Timer (real this time)
- [ ] Replace the stub in `src/components/app/timer-widget.tsx` with a Zustand store that persists to localStorage so the timer survives reloads.
- [ ] Project picker dropdown in the widget (searchable; lists active projects grouped by client).
- [ ] **Stop Prompt** dialog on stop. Fields: task name (required), project (required, pre-filled), editable start/end times, notes, tags (free-form chips). Save writes a `Task` via `taskRepo.create()`.
- [ ] If the user closes the Stop Prompt without saving, persist the unsaved draft (in store + localStorage) and reopen it on next app load. PRD 4.2 — "nothing is lost."
- [ ] Keyboard shortcut **⌘⇧T** to start/stop the timer, bound globally (including when focus is in inputs — contractor is likely mid-task).

### Manual entry
- [ ] `/ledger/new` or a modal action "Add entry" — same fields as Stop Prompt, minus the timer. Date/time pickers.

### Done when
A user can create a client + project, start the timer, stop it, fill the Stop Prompt, and see the saved task in IndexedDB. Dismissing the Stop Prompt preserves a draft.

---

## 7. Stage 2 — Ledger and Command Palette

**Goal:** One unified view of the user's work, keyboard-first.

### Ledger
- [ ] `/ledger` — chronological feed of tasks **and** expenses (unified row type). Virtualized list (use `@tanstack/react-virtual` — not yet installed).
- [ ] Row renders: date, project → client, task name, duration, amount, billed badge, tag chips. Expenses render as a distinct row variant.
- [ ] Filters panel (sticky top): date range (with week/month presets), client, project, billed/unbilled, tag, free-text search. URL-encode filters so views are shareable within an install.
- [ ] Inline edit on any cell (click → input → save on blur/enter). Use `taskRepo.update()` / `expenseRepo.update()`.
- [ ] Bulk selection: row checkboxes + shift-click range select. Selection count pill in a sticky action bar with "Invoice selected" CTA (wire to Stage 3).
- [ ] Export actions on the current filtered view: **CSV** (per entity), **JSON** (combined), **Markdown ledger** (chronological, human-readable — PRD 2.5).

### Command Palette
- [ ] Replace the ⌘K stub in `src/components/app/topbar.tsx` with a real `cmdk` dialog.
- [ ] Actions: start/stop timer, new client, new project, new invoice, jump to Ledger, toggle theme.
- [ ] Entity search: fuzzy over clients, projects, recent tasks, invoice numbers.
- [ ] Bind global **⌘K**.

### Dashboard
- [ ] Real widgets: hours this week, unbilled $ by client (top 5), open invoices, recent entries (last 10).
- [ ] Aggregations live in a `src/lib/aggregations.ts` helper.

### Done when
A user with 100+ entries can filter, search, inline-edit, bulk-select. Every primary action is reachable from ⌘K.

---

## 8. Stage 3 — Invoicing

**Goal:** Turn selected ledger entries into a professional PDF.

- [ ] `/invoices` list with status badges (draft / sent / paid), sortable by date/number.
- [ ] "Invoice selected" from Ledger → `/invoices/new?tasks=id1,id2,...` — new invoice draft with auto-populated line items from those tasks.
- [ ] Invoice editor layout: left pane = form (client picker, issue/due dates, number with configurable prefix + auto-increment from `Settings.invoice.nextNumber`, line items table, notes, payment instructions). Right pane = live PDF preview.
- [ ] Line items: description (editable), quantity, rate, amount (auto). Source type retained (`task` / `expense` / `manual`). Add manual line items for flat-fee deliverables.
- [ ] **PDF export** via `@react-pdf/renderer`. Build the template in `src/components/invoices/pdf-template.tsx`. One polished default template — open PRD question about whether to offer variants.
- [ ] Mark-as-sent, mark-as-paid (manual status buttons, no email integration — PRD Section 9).
- [ ] When invoice is marked sent: flip `isBilled = true` and set `invoiceId` on every linked task/expense.
- [ ] Invoice appearance settings (under Settings → Invoices): logo upload (base64), accent color, footer text, default payment terms.
- [ ] Invoice numbering: `${prefix}${nextNumber}`, atomic increment.

### Done when
User selects a week of tasks in the Ledger, clicks Invoice, edits the draft, exports a PDF they'd actually send a client.

---

## 9. Stage 4 — Expenses and Weekly Reckoning

### Expenses
- [ ] Expense form: amount, category (dropdown from `Settings.expenseCategories`), date, optional client/project, optional note, optional receipt image.
- [ ] Receipt upload: resize client-side to ~1600px max edge, store as base64 on the `Expense.receiptB64` field. Warn above ~500KB.
- [ ] Expenses appear in the Ledger (Stage 2 row variant).
- [ ] Expenses addable as invoice line items in Stage 3's editor, with optional markup % field.

### Weekly Reckoning (the signature feature — do not skimp)
- [ ] `/reckoning` full-screen layout. Hidden from nav but reachable via ⌘K and auto-opened on schedule.
- [ ] Scheduled trigger: at `Settings.reckoning.dayOfWeek + hourOfDay` (default Friday 16:00 local). Check on app mount; if the scheduled moment has passed since last-seen and user hasn't opened Reckoning this week, open it.
- [ ] Summary panels: total hours this week, unbilled hours by client, total expenses, total unbilled dollars.
- [ ] **Gap detector:** for each weekday in the current week, flag 9:00–17:00 blocks with less than 2 cumulative tracked hours. Prompt the user to fill each gap with a quick-add form.
- [ ] Per-client "Invoice unbilled time for ClientX" one-click actions that jump into the Stage 3 flow pre-populated.
- [ ] Completion event logged so the auto-open logic doesn't re-trigger.

### Settings page (complete)
- [ ] Tabs or sections: Business, Invoices, Reckoning, Expense Categories, Appearance, Data.
- [ ] Data tools: **Export all** (JSON / CSV / Markdown), **Import** (JSON), **Reset** (wipe IndexedDB, confirm twice). Export should be a single download button per format.

### Done when
You (the founder) use Reckoning on a real Friday, fill a gap, and generate a real invoice from it.

---

## 10. Stage 5 — Polish, Docs, Launch

- [ ] Empty states for every list view (Ledger, Clients, Invoices, Expenses). Loading states on all async boundaries. Error boundaries at route level.
- [ ] Keyboard shortcut reference page (or modal from ⌘K → "Keyboard shortcuts").
- [ ] Round-trip test: export all → reset → import → verify byte-equivalence. Same for Markdown ledger (idempotent parse/render).
- [ ] Theme polish pass. Ensure nothing uses hex literals.
- [ ] **README.md** rewrite: screenshots (Ledger, Stop Prompt, Invoice preview, Reckoning), feature list, quickstart, self-host instructions, "what's out of scope and why."
- [ ] `CONTRIBUTING.md`, code of conduct, issue templates (.github/ISSUE_TEMPLATE).
- [ ] `Dockerfile` + docker-compose example. Target: `docker run -p 3000:3000 tallyhand/tallyhand`.
- [ ] `LICENSE` file (MIT) at repo root (see Stage 0 loose ends).
- [ ] Community-hosted instance deployed to a domain.
- [ ] **Public invoice link** feature (self-hosted only): read-only route `/invoice/public/[token]` that renders the invoice from its `publicToken`. No auth, no writes. Show warning in UI if enabled on the hosted instance (no server-side state available).
- [ ] Onboarding notice about local-first data loss + nudge to export weekly (PRD Section 8 mitigation).
- [ ] Launch: Show HN, r/freelance, r/selfhosted, Product Hunt.

---

## 11. PRD open questions (decide before the stages that need them)

Answers drive implementation direction; none are blocking for Stage 1.

1. **Markdown as canonical export?** PRD 10.1. Affects Stage 2 export design and Stage 5 roundtrip testing. Recommend deciding before Stage 2.
2. **Stop-Prompt rounding setting (5/10/15 min)?** PRD 10.2. Affects Stage 1 Stop Prompt. Low effort to add later.
3. **One invoice template vs three styles?** PRD 10.3. Affects Stage 3 scope. Recommend one template for MVP; add variants after launch if users ask.
4. **Cross-device sync via user-controlled cloud folder (Dropbox/iCloud)?** PRD 10.4. Out of scope for v1 — park in the "considered and deferred" list in the README.

---

## 12. Quick start for the next agent

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build — runs next-pwa
npm run lint
```

- Read `PRD.md` for product vision and non-goals.
- Start with Stage 1 unless the user directs otherwise. The Timer + Stop Prompt is the load-bearing UX of the product — take it seriously.
- When in doubt, **ask the user** before expanding scope. The PRD's "Non-Goals" (Section 1.3) and "Out of Scope" (Section 9) lists are real.
