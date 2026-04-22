# Agent handoff — Stage 5 (Tallyhand)

**Copy everything below the line into a new chat for the next agent.**

---

## Project

**Tallyhand** — local-first contractor time tracker + invoices. **Next.js 14** (App Router), **Dexie** (IndexedDB), **Zustand**, **shadcn/ui**. Product spec: `PRD.md` §6 Stage 5. Backlog and conventions: `TODO.md` (especially **§0 Deploy**, **§4 gotchas**, **§10 Stage 5**).

### Engineering guardrails (unchanged)

- **Data access:** only through `src/lib/db/repos.ts`. `getDB()` is client-only; Dexie code must run in `"use client"` components or event handlers.
- **Live queries:** `useLiveQuery(() => someRepo.read(), [])` — queriers must be **pure reads**. Use `settingsRepo.read()` in `useLiveQuery`, not `settingsRepo.get()`; call `get()` once from `useEffect` to seed defaults if needed. See `TODO.md` §4.7.
- **PDF:** `@react-pdf/renderer` only via **dynamic `import()` inside handlers** (see `pdf-download-button.tsx`). Never static-import in a file that loads on first paint.
- **Icons:** `lucide-react@1.8.0` — no brand icons. Prefer **`Array.from`** over spreading `Set`/`Map` in lib code if TS/build complains (`TODO.md` §4.6).
- **Dev on macOS:** if you see `EMFILE: too many open files, watch` and 404s for all routes, `next.config.mjs` already sets webpack **dev polling** (`watchOptions.poll`). You can also raise `ulimit -n` in the shell before `npm run dev`.

## Deploy (do not reinvent)

- **GitHub → Vercel:** Pushing to the connected repo **automatically deploys** to Vercel.
- **Production URL:** **https://tallyhand.vercel.app** — smoke-test here after UI or data-layer changes that might behave differently in production (PWA, minification, env).
- Stage 5 README should spell out: repo link, **tallyhand.vercel.app**, and how deploy is triggered (which branch → Production vs Preview is a doc detail—confirm in Vercel dashboard if unsure).

## Done already (do not redo)

- **Stages 0–4** — see `TODO.md` §1 and §6–9. Includes: clients, projects, timer, ledger, command palette, invoicing + PDF, expenses, Weekly Reckoning (`/reckoning`), full settings (reckoning schedule, categories, appearance + theme persistence, `tallyhand.v1` export/import/reset), aggregations + gap detection + tests.
- **Ledger row polish** — `ledger-content.tsx`: meta line alignment (date · client · project · duration/amount); working **Open** links; **Delete** for unbilled entries only (`TODO.md` §7 Ledger).
- **MIT `LICENSE`** — present at repo root since Stage 0 (`TODO.md` §10 marks this done).
- **Vercel hosting** — live at tallyhand.vercel.app via GitHub (`TODO.md` §0).

## What’s left — Stage 5 (Polish, Docs, Launch)

Work from **`TODO.md` §10** and **`PRD.md` §6** “Stage 5 — Polish, Docs, and Launch”. Suggested order:

1. **UX resilience** — Empty states on Ledger, Clients, Invoices, Expenses (and any other list-first views). Loading states on async boundaries. Route-level **error boundaries** where missing.
2. **Keyboard discoverability** — Shortcut reference: dedicated page **or** modal reachable from ⌘K (“Keyboard shortcuts”).
3. **Data trust** — Automated or scripted **round-trip**: export `tallyhand.v1` bundle → reset → import → assert integrity (and Markdown ledger idempotence if you scope it that way).
4. **Theme / tokens** — Pass called out in TODO: reduce stray hex in UI code where it violates project conventions; respect user invoice accent from settings as intentional color.
5. **README** — Screenshots (Ledger, Stop Prompt, Invoice preview, Reckoning), features, quickstart, **deploy** (§0), self-host / static notes, out-of-scope / non-goals pointer to PRD.
6. **Community repo hygiene** — `CONTRIBUTING.md`, code of conduct, `.github/ISSUE_TEMPLATE/*`.
7. **Docker** — `Dockerfile` + minimal `docker-compose` or run instructions for self-hosters who do not use Vercel.
8. **Public invoice link** (PRD Stage 5) — Read-only `/invoice/public/[token]` from `Invoice.publicToken`; no writes; copy that explains static/Vercel has no server-side user data.
9. **Onboarding** — Short notice: local-first data loss risk + nudge to use Settings → Data export (`PRD` §8 style mitigation).
10. **Launch** — Show HN, r/freelance, r/selfhosted, Product Hunt when README + production smoke are ready.

**Optional later:** custom domain in front of Vercel; not required to close Stage 5 if README documents tallyhand.vercel.app.

## Verify before you claim Stage 5 done

```bash
npm run lint
npm run test
npm run build
```

Then **browser smoke** on **https://tallyhand.vercel.app** (and locally) on: landing → launch app, timer, ledger, invoice create/PDF, expenses, reckoning, settings export/import (use a throwaway export in a test profile).

## Key files to read first

| Area | Files |
|------|--------|
| Backlog | `TODO.md` §0, §4, §10 |
| Product scope | `PRD.md` §6 Stage 5, §1.3 non-goals |
| App shell / ⌘K | `src/components/app/app-chrome.tsx`, `command-palette.tsx` |
| Settings / data | `src/components/settings/settings-content.tsx`, `src/lib/app-bundle.ts` |
| Invoices / token | `src/lib/db/types.ts` (`Invoice.publicToken`), invoice editor + routes under `src/app/(app)/invoices/` |

**Do not commit** unless the user asks.

---

_End of handoff block._
