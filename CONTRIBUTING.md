# Contributing to Tallyhand

Thanks for helping improve Tallyhand. This project values small, reviewable changes that match existing patterns.

## Before you start

1. Read **`PRD.md`** for scope and non-goals.
2. Read **`TODO.md`** §4 for gotchas (Dexie live queries, PDF lazy import, `settingsRepo.read()` vs `get()`, etc.).
3. Data access goes through **`src/lib/db/repos.ts`** only — no ad-hoc Dexie calls from UI code.

## Development

```bash
npm install
npm run dev
```

```bash
npm run lint
npm run test
npm run build
```

All three should pass before you open a PR.

## Code style

- TypeScript strictness as in the repo; use the `@/*` path alias.
- Tailwind + design tokens (`bg-background`, `text-muted-foreground`, …). Avoid new hard-coded hex except where a format requires it (e.g. user invoice accent, PDF internals).
- `"use client"` only where needed (Dexie, hooks, browser APIs).
- Prefer **`Array.from`** over spreading `Set`/`Map` in library code if the build complains (`TODO.md` §4.6).

## Pull requests

1. One logical change per PR when possible.
2. Describe **what** and **why** in the PR body (complete sentences).
3. If the change is user-visible, mention how you tested it (local routes, production smoke URL if relevant).

## Conduct

Please follow **`CODE_OF_CONDUCT.md`** in all project spaces.
