# Tallyhand

**Local-first time tracking and invoicing** for independent contractors. Next.js 14 (App Router), Dexie (IndexedDB), Zustand, shadcn/ui. **MIT licensed.**

**Try it:** [tallyhand.vercel.app](https://tallyhand.vercel.app) (production, deployed from `main` via GitHub → Vercel).

## Features

- **Timer + Stop Prompt** — Start/stop from the top bar; capture task, project, times, notes, and tags when you stop (⌘⇧T / Ctrl+Shift+T).
- **Ledger** — Unified feed of time entries and expenses; filters, inline edit, bulk select, CSV/JSON/Markdown export.
- **Clients & projects** — Rates, archive, activity hints.
- **Invoices** — Build from ledger selections or blank; live HTML preview; PDF download; mark sent/paid; optional **read-only public link** (same browser / imported data only — see below).
- **Expenses** — Categories, receipts (client-side), ledger + invoice integration.
- **Weekly Reckoning** — Summary, gap detector, “new invoice” shortcuts (⌘K → Weekly Reckoning).
- **Settings** — Business profile, invoice defaults (accent, logo, numbering), reckoning schedule, expense categories, theme, **Data** export/import (`tallyhand.v1` JSON) and reset.

## Screenshots

Add captures under `docs/screenshots/` and link them here (or embed in GitHub):

| Area | Suggested filename |
|------|--------------------|
| Ledger | `docs/screenshots/ledger.png` |
| Stop Prompt | `docs/screenshots/stop-prompt.png` |
| Invoice preview | `docs/screenshots/invoice-preview.png` |
| Weekly Reckoning | `docs/screenshots/reckoning.png` |

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then **Launch app**. No account or API keys.

**Checks before a PR:**

```bash
npm run lint
npm run test
npm run build
```

## Deploy

Pushing to the GitHub repo connected to Vercel deploys automatically. Production: **https://tallyhand.vercel.app**. Preview deployments apply to other branches/PRs per your Vercel project settings.

## Self-host / static notes

- Run `npm run build` then `npm start` (Node server) anywhere you can run Next.js 14.
- Data is **only** in each visitor’s browser (IndexedDB). The hosted demo does not store your clients or hours on the server.
- **Public invoice URLs** (`/invoice/public/[token]`) resolve against **that browser’s** IndexedDB. Sharing a link does not upload the invoice; recipients only see data if they use the same profile or import your bundle.

## Public invoice link

Each invoice can get an opaque `publicToken` (minted on save). The URL path is `/invoice/public/<token>`. It is **read-only** and **no-auth** by design, with the limitations above.

## What we are not building (MVP)

See **`PRD.md`** §1.3 and §9: no cloud sync, no QuickBooks/Stripe integrations, no multi-user mode, no mobile native apps, etc. PRs that add server-side user storage would change the product model — discuss in an issue first.

## Contributing

See **`CONTRIBUTING.md`**. Bug reports and ideas: use the [GitHub issue templates](https://github.com/pkyanam/tallyhand/issues).

## License

MIT — see `LICENSE`.

## Launch / community

When README and production smoke look good: Show HN, r/freelance, r/selfhosted, Product Hunt (see `HANDOFF.md` / `TODO.md` §10).
