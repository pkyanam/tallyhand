# Tallyhand — Remaining Work

**For the next agent.** This doc is the working backlog. The authoritative product spec is `PRD.md` at the repo root — read it before starting anything substantial. This file is intentionally concrete: what's done, what's not, conventions in use, and gotchas already discovered.

Last updated for **Stage 5** handoff + **Ledger** row fix (Open links, delete unbilled, meta-line alignment). Stage 4 is complete.

---

## 0. Deploy (already wired)

- **GitHub → Vercel:** Pushing to the connected repository triggers a **Vercel** production deploy.
- **Production URL:** https://tallyhand.vercel.app — use it for smoke tests after shipping user-facing changes.
- Stage 5 **README** should document this flow (branch/trigger as you prefer: e.g. `main` → Production). Custom domain is optional later.

---

## 1. What is already done

### Stage 0 (foundation)

- Next.js 14 (App Router) + TypeScript + Tailwind scaffolded.
- shadcn/ui tokens wired via HSL CSS vars (light/dark). Base components: `Button`, `Input`, `Label`, `Card`, `Dialog`, `Separator`, `Badge`.
- Dexie v1 schema with `Client`, `Project`, `Task`, `Expense`, `Invoice`, `Settings` tables + typed repositories.
- App shell at route group `(app)`: left sidebar nav, sticky topbar with timer-widget stub, ⌘K button stub, theme toggle.
- Stub pages for `/dashboard`, `/ledger`, `/clients`, `/invoices`, `/expenses`, `/settings`.
- Landing page at `/` with "Launch app" CTA.
- PWA: `manifest.webmanifest`, SVG icons, `next-pwa` service worker (only active in production builds).
- GitHub remote wired to `https://github.com/pkyanam/tallyhand`.
- `LICENSE` file (MIT) at repo root.

### Stage 1 (clients, projects, timer)

- Extra shadcn primitives added: `Textarea`, `Checkbox`, `Select`, `Popover`, `DropdownMenu`, `Tabs`, `Command` (cmdk).
- **Clients**: `/clients` (active/archived tabs, search, project count + last activity), `/clients/new`, `/clients/[id]` detail, `/clients/[id]/edit`. Archive/unarchive + delete.
- **Projects**: inline CRUD in the client detail view with rate override that falls back to `client.defaultRate`. Archive + unarchive.
- **Timer**: `src/lib/timer-store.ts` — Zustand store persisted to `localStorage` (key `tallyhand.timer`). Survives reload. Project picker (`src/components/app/project-picker.tsx`) is searchable via cmdk, grouped by client.
- **Stop Prompt**: `src/components/app/stop-prompt.tsx` opens on stop. Fields: task name, project, editable start/end (datetime-local), notes, tags (chips). Dismissing keeps the entry as a draft; auto-reopens on next load. Explicit **Discard** button clears the draft after confirm.
- **⌘⇧T global shortcut**: `src/components/app/timer-hotkey.tsx` — bound with `{ capture: true }` so it fires even when focus is in an input.
- **Manual entry**: `src/components/app/manual-entry-dialog.tsx` — modal with same fields as Stop Prompt plus date/time pickers. Exposed on Dashboard and Ledger page headers.
- **Dashboard**: real data — hours this week, unbilled $, active clients, total tracked entries, recent 10 entries with client/project links.

### Stage 2 (ledger, command palette, dashboard)

- **`/ledger`**: unified virtualized feed (tasks + expenses), URL-synced filters (date range + week/month presets, client, project, billed, tag, search), inline edit (tasks: name, duration, tags; expenses: amount, category, note), bulk select with shift-range, “Invoice selected” → `/invoices/new?tasks=…&expenses=…`, CSV/JSON/Markdown export with canonical JSON + human-readable MD note. Dev-only **Seed 5 expenses** when `NODE_ENV=development`.
- **Command palette (⌘K)**: `CommandDialog` + global capture-phase hotkey; actions (timer, nav, theme, Reckoning stub notice); fuzzy entity search over clients, projects, recent 50 tasks, invoices.
- **Dashboard**: `src/lib/aggregations.ts` powers week totals, unbilled-by-client (top 5 widget), recent entries; **Open invoices** count (draft + sent) with zero-state copy.
- **Tests**: `vitest` + `src/lib/aggregations.test.ts`; `npm run test` script.

### Stage 3 (invoicing)

- **`/invoices`** list: live query, sortable by issue date / number, status badges (draft / sent / paid), draft delete with confirm, empty state.
- **`/invoices/new`**: parses `?tasks=…&expenses=…` query params, hydrates line items from tasks (quantity=hours, rate from project override → client default) and expenses (qty=1, rate=amount). Silently drops missing IDs with a notice. Also serves as a blank-start page when no params supplied. Infers client from the first selected task/expense; user can re-pick.
- **`/invoices/[id]`**: shared `InvoiceEditor` with form on the left (client picker, dates, number, editable line items with source-type icon + manual lines, notes) and live HTML preview on the right. Editable invoice number; editable descriptions / quantities / rates with auto-recomputed amount.
- **Invoice numbering**: `${Settings.invoice.numberPrefix}${Settings.invoice.nextNumber}`. `assignNextInvoiceNumber()` in `src/lib/invoice-helpers.ts` reads-and-bumps inside a Dexie `rw` transaction. On new-invoice save, if the user hasn't manually changed the pre-filled number it's replaced with the atomically-assigned one and the counter bumps; if they did change it the counter is left alone.
- **PDF export**: `src/components/invoices/pdf-template.tsx` renders a `@react-pdf/renderer` `Document` that mirrors the HTML preview (LETTER, Helvetica, accent color, logo, footer, notes, payment instructions). `pdf-download-button.tsx` lazy-imports `@react-pdf/renderer` + the template only on click (via `pdf(...).toBlob()`) so it stays out of the main bundle and never runs server-side.
- **Status workflow (no email)**: `Mark as sent` calls `markInvoiceSent(invoice)` which in one Dexie `rw` transaction flips invoice → `sent` and sets `isBilled=true` + `invoiceId=<inv.id>` on every task/expense referenced via `lineItem.sourceId`. Idempotent. `Mark as paid` updates status only. Paid invoices become read-only in the editor.
- **Settings → Business + Invoices**: `src/components/settings/settings-content.tsx` — auto-commit-on-blur form for business info (name, owner, email, tax ID, address, payment instructions) and invoice defaults (number prefix, next-number preview, payment terms days, accent colour, footer, logo upload-as-base64 with 500 KB warning).
- **Helpers + tests**: `src/lib/invoice-helpers.ts` + `src/lib/invoice-helpers.test.ts` (round2, computeLineAmount, sumLineItems, computeDueDate, taskToLineItem / expenseToLineItem, inferClientIdFromSelection, invoiceTotals). 10 new tests; full suite passes `vitest`.

### Stage 4 (expenses + Weekly Reckoning + settings)

- **Expenses** (from prior work, verified in this stage): list/create/edit, categories from settings, client→project filter, receipt resize + warn, Ledger integration, delete confirm, ⌘K **New expense**.
- **Expense markup on invoices**: optional `InvoiceLineItem.markupPercent` on expense lines; helpers in `invoice-helpers.ts`; tests in `invoice-helpers.test.ts`.
- **Weekly Reckoning**: `/reckoning` (not in sidebar), `reckoning-content.tsx`, summary + gap detector + per-client **New invoice** → `/invoices/new?tasks=…&expenses=…`, **Mark reckoning complete** writes `Settings.reckoning.lastCompletedAtMs`. Aggregations: `weeklyReckoningSummary`, `detectGaps`, `unbilledTaskIdsForClient` / `unbilledExpenseIdsForClient`, `minutesOverlapWorkWindow`; tests in `aggregations.test.ts` + `reckoning-schedule.test.ts`.
- **Auto-open**: `reckoning-auto-open.tsx` + `isReckoningDue` / `lastReckoningInstantMs` (`reckoning-schedule.ts`); session guard `sessionStorage` key `tallyhand.reckoning.autoOpened`.
- **⌘K**: **Weekly Reckoning** navigates to `/reckoning` (replaces Stage 4 stub notice).
- **Settings**: Reckoning schedule, expense category list (add/remove/reorder), appearance theme (Select) synced with **next-themes** via `settings-theme-sync.tsx` + `persistThemeChoice` from topbar/command palette, **Data** — `tallyhand.v1` JSON bundle export/import, ledger JSON, tasks/expenses CSV, Markdown export, reset with double `confirm` + reload.
- **Persistence**: `settingsRepo.get()` deep-merges via `normalizeSettings()` (`settings-normalize.ts`) so new fields backfill; `lastCompletedAtMs` optional on `Settings.reckoning`.
- **Dev stability**: `next.config.mjs` webpack `watchOptions.poll` when EMFILE on macOS (see `HANDOFF.md`).

---

## 2. Stack and where things live

```
src/
├── app/
│   ├── layout.tsx              # root layout — fonts, ThemeProvider, metadata
│   ├── page.tsx                # marketing landing page
│   └── (app)/                  # route group sharing the sidebar+topbar shell
│       ├── layout.tsx          # mounts StopPrompt + TimerHotkey
│       ├── dashboard/page.tsx
│       ├── ledger/page.tsx     # Suspense + LedgerContent
│       ├── clients/
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   └── [id]/
│       │       ├── page.tsx
│       │       └── edit/page.tsx
│       ├── invoices/page.tsx
│       ├── expenses/page.tsx
│       ├── reckoning/page.tsx
│       └── settings/page.tsx
├── components/
│   ├── app/                    # app-shell pieces
│   │   ├── app-chrome.tsx      # Provider + theme/reckoning sync + CommandPalette + hotkey
│   │   ├── app-chrome-provider.tsx
│   │   ├── command-palette.tsx
│   │   ├── command-hotkey.tsx
│   │   ├── reckoning-auto-open.tsx
│   │   ├── settings-theme-sync.tsx
│   │   ├── sidebar.tsx
│   │   ├── topbar.tsx
│   │   ├── page-header.tsx
│   │   ├── timer-widget.tsx    # reads useTimerStore
│   │   ├── timer-hotkey.tsx    # ⌘⇧T global binding (capture phase)
│   │   ├── stop-prompt.tsx     # opens on stop; auto-reopens on draft
│   │   ├── manual-entry-dialog.tsx
│   │   ├── project-picker.tsx  # cmdk popover, grouped by client
│   │   └── tags-input.tsx
│   ├── clients/
│   │   ├── client-form.tsx     # react-hook-form + zod
│   │   ├── clients-list.tsx
│   │   ├── client-detail.tsx
│   │   ├── project-form.tsx
│   │   └── projects-section.tsx
│   ├── dashboard/
│   │   └── dashboard-content.tsx
│   ├── ledger/
│   │   └── ledger-content.tsx
│   ├── reckoning/
│   │   └── reckoning-content.tsx
│   ├── ui/                     # shadcn-style primitives (see list above)
│   ├── theme-provider.tsx
│   └── theme-toggle.tsx
└── lib/
    ├── utils.ts                # cn(), formatCurrency(), formatDuration()
    ├── aggregations.ts         # week totals, unbilled-by-client, reckoning + gaps
    ├── app-bundle.ts           # tallyhand.v1 export / import / reset
    ├── ledger-export.ts        # CSV / JSON / Markdown export helpers
    ├── reckoning-schedule.ts   # last reckoning instant, isReckoningDue
    ├── settings-normalize.ts   # merge persisted Settings with defaults
    ├── datetime.ts             # to/fromLocalInputValue(), formatElapsed()
    ├── timer-store.ts          # Zustand store, persisted to localStorage
    └── db/
        ├── types.ts            # entity interfaces, DEFAULT_SETTINGS
        ├── schema.ts           # TallyhandDB class, getDB() factory
        ├── id.ts               # newId(prefix), now()
        ├── repos.ts            # clientRepo / projectRepo / taskRepo / expenseRepo / invoiceRepo / settingsRepo
        └── index.ts
```

Installed but still unused: `date-fns`, `@react-pdf/renderer`.

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
6. **`Set` / `Map` iteration in `next build`:** the project TypeScript target can flag `for..of` on `Set` and spreads like `[...map.entries()]` unless `downlevelIteration` is enabled. Prefer `Array.from(set)` / `Array.from(map.entries())` in library code.
7. **Dexie liveQuery callbacks must be pure reads — no writes.** Stage 3 blew up on this: `settingsRepo.get()` writes `DEFAULT_SETTINGS` on first read, and wiring it into `useLiveQuery(() => settingsRepo.get())` silently stalls the observable and spams errors ("DexieError"). Fix pattern now in `settingsRepo`: `read()` is the pure getter for `useLiveQuery`; `get()` is the write-if-missing helper, called once from `useEffect`. Any repo method that writes-on-miss needs the same split.
8. **`@react-pdf/renderer` is browser-only and heavy.** Never import it at the module level of a component that ships in the main bundle — it will bloat the client payload and break if it ever gets evaluated server-side. The pattern in `pdf-download-button.tsx` is the one to copy: dynamic `await import("@react-pdf/renderer")` inside the click handler, then `pdf(<Doc/>).toBlob()`. Also: the `<Image>` component has no alt prop, so any `jsx-a11y/alt-text` lint needs an `eslint-disable-next-line` at that line.
9. **Next.js `PageHeader` now takes `ReactNode` for `title` and `description`.** Stage 3 needed a status badge inline with the invoice number in the header; relaxing the prop types was the minimum change. Existing callers passing strings are unaffected.
10. **`settingsRepo.get()` may write on read.** Older settings rows are normalized against `DEFAULT_SETTINGS` and re-`put` when nested keys drift — safe, but avoid calling `get()` from inside Dexie `liveQuery` queriers (same rule as `read()` vs `get()` split in §4.7).
11. **Theme persistence.** `SettingsThemeSync` applies `appearance.theme` after load; `ThemeToggle` and the command palette theme cycle call `persistThemeChoice()` so IndexedDB stays aligned with next-themes.

---

## 5. Stage 0 loose ends

- [x] Add `LICENSE` file (MIT) at repo root.
- [ ] Verify PWA installs on desktop Chrome + iOS Safari + Android Chrome against a production build.
- [x] **Vercel production deploy** — GitHub push triggers deploy; app at **https://tallyhand.vercel.app** (document in README for Stage 5).
- [ ] `public/` has SVG icons only. Generate PNG fallbacks (192, 512) for broader PWA compatibility if testing reveals install issues.

---

## 6. Stage 1 — Clients, Projects, and the Timer ✅

All items landed. `npm run lint` clean, `npm run build` green, all routes return 200 in dev.

### Clients
- [x] `/clients` list with active/archived tabs, search, project count, last activity, row-level archive/unarchive/edit.
- [x] `/clients/new` and `/clients/[id]/edit` forms (react-hook-form + zod, shared `ClientForm`).
- [x] `/clients/[id]` detail — info card, projects section, recent activity list.
- [x] Archive + unarchive via `clientRepo.update({ archived })`. Delete with confirm.

### Projects
- [x] Inline CRUD in the client detail (`ProjectsSection`).
- [x] Rate override field with client `defaultRate` fallback and "override" badge in the effective rate line.
- [x] Archive/unarchive actions; archived section rendered after active.

### Timer
- [x] `src/lib/timer-store.ts` — Zustand + `persist` middleware keyed at `tallyhand.timer`.
- [x] `ProjectPicker` — cmdk popover, searchable, grouped by client, empty-state CTA to create first client.
- [x] `StopPrompt` — name/project/start/end/notes/tags. Validates project exists and end > start. Dismiss preserves draft; `Discard` button clears it after confirm. Auto-reopens on next mount if a draft exists.
- [x] ⌘⇧T global binding via `{ capture: true }` so input focus doesn't swallow the key.

### Manual entry
- [x] `ManualEntryDialog` modal (default: last hour → now). Wired into Dashboard and Ledger headers.

### Gotchas surfaced

- **Zod v4 + `@hookform/resolvers`.** `.transform()` on an `.optional()` field drifts the resolver's input/output types and TSC rejects it. Workaround used in `ClientForm` / `ProjectForm`: keep the rate field as `z.string().optional().refine(...)` and parse to `number` manually inside `handleSubmit`. Revisit if you adopt coerced or preprocessed schemas elsewhere.
- **Zustand `persist` + SSR.** The timer widget reads from the persisted store; to avoid hydration mismatches, the project picker inside `timer-widget.tsx` is gated on a `hydrated` flag set in `useEffect`.
- **Stop Prompt re-open on mount.** `promptOpen` is intentionally excluded from `partialize` — `pending` alone drives the auto-reopen effect so a stale `promptOpen=true` can't ship from localStorage.

---

## 7. Stage 2 — Ledger and Command Palette ✅

**Goal:** One unified view of the user's work, keyboard-first.

### Ledger
- [x] `/ledger` — chronological feed of tasks **and** expenses (unified row type). Virtualized with `@tanstack/react-virtual`.
- [x] Row renders: **meta line** (date · client · project · duration or amount) on one horizontal line; task name / expense category + note below; tag chips (tasks). Expenses use a distinct row variant.
- [x] Per-row **Open** → `/invoices/new?tasks=…` or `?expenses=…` when unbilled; **Open** → `/invoices/[id]` when billed (uses `invoiceId`). **Delete** (trash icon) with confirm for **unbilled** rows only (`taskRepo.remove` / `expenseRepo.remove`); billed rows are protected.
- [x] Filters panel (sticky top): date range (with week/month presets), client, project, billed/unbilled, tag, free-text search. URL-encoded via `useSearchParams`.
- [x] Inline edit (click → input → save on blur/enter) via `taskRepo.update()` / `expenseRepo.update()`.
- [x] Bulk selection: checkboxes + shift-click range; sticky bar with count + **Invoice selected** → `/invoices/new?tasks=…&expenses=…` (Stage 3 route may 404 until invoicing ships).
- [x] Export: **CSV** (tasks + expenses files), **JSON** (combined canonical payload), **Markdown** ledger; UI notes JSON = canonical, MD = human-readable.

### Command Palette
- [x] `topbar.tsx` opens the real `CommandDialog` from `src/components/ui/command.tsx`; global **⌘K** / Ctrl+K via capture-phase `command-hotkey.tsx`.
- [x] Actions: start/stop timer, new client, new project, new invoice, Ledger, toggle theme, Weekly Reckoning → `/reckoning`.
- [x] Entity search: client-side fuzzy filter over clients, active projects, 50 most recent tasks, invoice numbers (`useDeferredValue` on the query).

### Dashboard
- [x] Top 5 **unbilled clients** + **open invoices** (draft + sent) + existing stat cards; `recentEntries` from aggregations.
- [x] `src/lib/aggregations.ts` + `aggregations.test.ts` (`vitest`).

### Done when
A user with 100+ entries can filter, search, inline-edit, bulk-select. Primary actions are reachable from ⌘K.

---

## 8. Stage 3 — Invoicing ✅

**Goal:** Turn selected ledger entries into a professional PDF.

- [x] `/invoices` list with status badges (draft / sent / paid), sortable by date/number.
- [x] "Invoice selected" from Ledger → `/invoices/new?tasks=id1,id2,...` — new invoice draft with auto-populated line items from those tasks (and expenses).
- [x] Invoice editor layout: left pane = form (client picker, issue/due dates, number with configurable prefix + atomic bump from `Settings.invoice.nextNumber`, line items table, notes). Right pane = live HTML preview that mirrors the PDF.
- [x] Line items: description (editable), quantity, rate, amount (auto = qty × rate). Source type retained (`task` / `expense` / `manual`). Add manual line items for flat-fee deliverables.
- [x] **PDF export** via `@react-pdf/renderer` — template at `src/components/invoices/pdf-template.tsx`, triggered via `PdfDownloadButton` with lazy `import()` on click.
- [x] Mark-as-sent, mark-as-paid (manual status buttons, no email integration — PRD Section 9).
- [x] When invoice is marked sent: flip `isBilled = true` and set `invoiceId` on every linked task/expense, all in one Dexie `rw` transaction.
- [x] Invoice appearance settings (under Settings → Invoices): logo upload (base64), accent color, footer text, default payment terms.
- [x] Invoice numbering: `${prefix}${nextNumber}`, atomic increment in a Dexie transaction.

### Skipped for Stage 4+

- ~~Expense line markup %~~ **Done in Stage 4** (optional markup on expense-sourced invoice lines).
- Reverting a sent/paid invoice back to draft (users can delete and recreate if truly needed).
- Multiple PDF templates (PRD §10.3 — shipping one polished template for MVP).

### Done when ✅
Founder can: select ledger entries → click Invoice → edit the draft → download a PDF → mark sent → see tasks/expenses flip to billed with `invoiceId` set.

---

## 9. Stage 4 — Expenses and Weekly Reckoning ✅

### Expenses
- [x] Expense form: amount, category (dropdown from `Settings.expenseCategories`), date, optional client/project, optional note, optional receipt image.
- [x] Receipt upload: resize client-side to ~1600px max edge, store as base64 on the `Expense.receiptB64` field. Warn above ~500KB.
- [x] Expenses appear in the Ledger (Stage 2 row variant).
- [x] Expenses addable as invoice line items in Stage 3's editor, with optional markup % field.

### Weekly Reckoning (the signature feature — do not skimp)
- [x] `/reckoning` layout (same app shell; not in sidebar). Reachable via ⌘K and auto-opened on schedule when due.
- [x] Scheduled trigger: `Settings.reckoning.dayOfWeek` + `hourOfDay` (default Friday 16:00 local). `ReckoningAutoOpen` + `isReckoningDue` / `lastReckoningInstantMs`; session guard `sessionStorage` so auto-open runs once per browser session.
- [x] Summary panels: tracked hours this week, unbilled task $ by client, expenses this week (+ unbilled portion), gap count card.
- [x] **Gap detector:** Mon–Fri 9:00–17:00 local, under 2 hours → gap; `ManualEntryDialog` with `defaultDayStartMs` for quick-add.
- [x] Per-client **New invoice** → `/invoices/new?tasks=…&expenses=…` with all unbilled tasks/expenses for that client.
- [x] **Mark reckoning complete** → `lastCompletedAtMs` so auto-open does not loop.

### Settings page (complete)
- [x] Sections: Business, Invoices, Reckoning, Expense Categories, Appearance, Data.
- [x] Data tools: **tallyhand.v1** bundle JSON export + import, ledger JSON (`tallyhand.ledger.v1`), tasks CSV, expenses CSV, Markdown export; **Reset** clears all tables + re-init settings (double `confirm`, full reload).

### Done when
You (the founder) use Reckoning on a real Friday, fill a gap, and generate a real invoice from it. **Ship checklist:** `npm run lint && npm run test && npm run build` — all green after Stage 4 land.

---

## 10. Stage 5 — Polish, Docs, Launch

**Hosting:** Production is already on **Vercel** at **https://tallyhand.vercel.app** via GitHub integration (see §0). Remaining work is polish, docs accuracy, optional Docker/custom domain, and launch comms.

- [x] Empty states for every list view (Ledger, Clients, Invoices, Expenses). Loading states on async boundaries; `(app)/error.tsx` route error boundary.
- [x] Keyboard shortcut reference page at `/shortcuts` + ⌘K action + sidebar/mobile footer links.
- [x] Round-trip test (`app-bundle-roundtrip.test.ts`): export → reset → import with `fake-indexeddb` + jsdom; Markdown export idempotence at fixed clock.
- [x] Theme polish: invoice HTML preview accent fallback uses `hsl(var(--foreground))` when unset (user accent from settings unchanged).
- [x] **README.md** rewrite: feature list, quickstart, deploy URL, self-host / public-link caveats, non-goals pointer; screenshot table → `docs/screenshots/`.
- [x] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/*`.
- [ ] `Dockerfile` + docker-compose example (deferred unless you want Docker).
- [x] **`LICENSE` (MIT)** at repo root — shipped in Stage 0; no action unless you change license terms.
- [x] **Hosted instance** — **https://tallyhand.vercel.app** (Vercel). README documents URL + deploy; optional: custom domain + DNS later.
- [x] **Public invoice link**: read-only `/invoice/public/[token]` + `publicToken` on save/create + share panel + local-only warnings.
- [x] Onboarding: dismissible banner in app shell + landing copy → Settings → Data export.
- [ ] Launch: Show HN, r/freelance, r/selfhosted, Product Hunt (manual when ready).

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
- Stages 0–4 are complete. **Start on Stage 5 (Polish, Docs, Launch)** unless the user directs otherwise.
- **Production:** https://tallyhand.vercel.app (GitHub → Vercel). Smoke-test there after risky changes.
- `@tanstack/react-virtual` is installed for the Ledger list.
- When in doubt, **ask the user** before expanding scope. The PRD's "Non-Goals" (Section 1.3) and "Out of Scope" (Section 9) lists are real.
