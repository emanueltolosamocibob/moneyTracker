# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AutoGasto: personal/family expense tracker. Google login, automatic expense detection by parsing bank/wallet confirmation emails from Gmail, LLM categorization. Budgets and investments have their DB schema ready but no UI yet.

## Commands

```bash
npm run dev       # Vite dev server (frontend only, localhost:5173)
npm run build     # tsc -b && vite build — the only reliable way to typecheck the frontend
npm run preview   # serve the production build locally
npm run lint      # eslint
```

There is no test suite.

**The `api/**/*.ts` serverless functions are not covered by `npm run build`** (they're outside the Vite/tsconfig.app.json project). Typecheck them manually after touching anything in `api/`:

```bash
npx tsc --noEmit --strict --esModuleInterop --skipLibCheck --moduleResolution bundler --module ESNext --target ES2020 --jsx react-jsx api/gmail/connect.ts api/gmail/scan.ts api/cron/scan-gmail.ts api/_lib/*.ts
```

### Database migrations

Migrations live in `supabase/migrations/`, applied in numeric order. The Supabase CLI is linked to the real project — apply a new migration with:

```bash
supabase db push
```

If a migration was ever applied by hand through the Supabase SQL Editor instead of the CLI, `supabase migration list` will show it as `local`-only; repair the history before pushing again (`supabase migration repair --status applied <version>`), otherwise `db push` tries to re-run it and fails on the already-existing objects.

### Deploying

`vercel --prod` deploys from the local working tree. There is no reliable auto-deploy on push — the GitHub↔Vercel webhook has been flaky in this project, so don't assume a push alone puts anything in production; ask the user to run `vercel --prod` (or run it yourself if asked) after merging.

## Architecture

**Stack**: Vite + React + TypeScript (no framework — plain SPA, React Router), Supabase (Postgres + Auth + Row Level Security), Vercel serverless functions for anything needing a secret, Linear for issue tracking. Gmail categorization calls Google Gemini directly (`GOOGLE_GENERATIVE_AI_API_KEY`) rather than through Vercel AI Gateway — see Gmail ingestion pipeline below for why.

### Auth and multi-tenancy

Every data table has a `user_id` and an RLS policy of the form `auth.uid() = user_id` — this is a shared Supabase project used by multiple people, not one project per user. `src/lib/supabaseClient.ts` requests the `gmail.readonly` scope *during the normal Google login* (`access_type=offline`, `prompt=consent`) so the refresh token arrives in the same OAuth round-trip. `src/pages/AuthCallback.tsx` reads `session.provider_refresh_token` right after that one login (Supabase never exposes it again on restored sessions) and POSTs it to `/api/gmail/connect`, which stores it in `gmail_connections` using the service-role client. That table has no `SELECT` grant for `authenticated`/`anon` at all — the client can only see connection status through the `gmail_connection_status` view (`security_invoker`), never the token.

`src/lib/AuthContext.tsx` also has a dev-only bypass: `?mock=1` in the URL (gated on `import.meta.env.DEV`, dead-code-eliminated from production builds) signs in as a fake local user with no real Supabase session, so the UI can be reviewed without doing the Google OAuth dance. Since there's no real session, any Supabase query under `?mock=1` comes back empty via RLS — fine for checking layout, useless for checking data.

### Gmail ingestion pipeline

`api/_lib/scanGmailForUser.ts` is the shared core, called from two places:
- `api/cron/scan-gmail.ts` — daily cron (`vercel.ts`, capped at 1/day on the Hobby plan), loops every row in `gmail_connections`.
- `api/gmail/scan.ts` — the "Sincronizar" button in Transactions, same logic for just the logged-in user (JWT-authenticated via `getUserIdFromRequest`).

Per connection: refresh the Google access token → build a Gmail search query (`api/_lib/bankSenders.ts`, a hardcoded list of known bank/wallet sender addresses — currently trimmed down to Santander only by explicit request, the rest are commented out in that file, not deleted) → the date floor is `max(last_scanned_at, start of current month)`, so it never reaches into prior months but stays incremental within the month → for each matching message, extract plain text and hand it to `api/_lib/categorize.ts`.

**LLM calls in `categorize.ts` go directly to Google Gemini (`@ai-sdk/google`, `GOOGLE_GENERATIVE_AI_API_KEY`), not through Vercel AI Gateway.** This was a deliberate switch away from AI Gateway: on an account without paid AI Gateway credits, Anthropic models flat-out refuse ("Free tier users do not have access to this model", confirmed by calling the gateway directly) and even OpenAI models — which do work — are rate-limited per minute tightly enough that a scan with a handful of emails would trip a `GatewayRateLimitError` mid-run. Gemini's own free tier (a real API key from https://aistudio.google.com, not a Gateway credit balance) has more headroom, generous enough that both the manual per-call delay and the tighter 3-day scan window (both temporary mitigations from the AI Gateway era) were removed/reverted once Gemini was confirmed working.

Deleting a `source: 'gmail'` transaction doesn't let it come back on the next scan — `last_scanned_at` only moves forward, so the source email is permanently outside the window once scanned. `Transactions.tsx` warns about this (via the shared `Modal` component) before deleting a Gmail-sourced row; manual entries delete without a prompt. To force a re-scan of already-seen emails (e.g. after testing), reset the row's `last_scanned_at` to `null` in `gmail_connections` directly — there's no UI for this.

The Gmail search itself (`buildGmailQuery` in `bankSenders.ts`) already does the sender filtering server-side, via Gmail's own `q` search parameter on `messages.list` (see `listMessageIds` in `gmail.ts`) — `scanGmailForUser.ts` never iterates the whole inbox, it only ever sees message IDs Gmail already filtered down to the configured senders (currently Santander only) and date window. The only per-message loop is the LLM categorization step afterward, which is unavoidable since it needs each mail's actual body.

`categorize.ts` does one `generateObject` call against the user's *actual* category list (not a fixed enum) plus payment method/last-4-digits extraction. If the first pass is low-confidence or falls back to "Otros", it does a second pass: a `google.tools.googleSearch` call to research the merchant name, then re-categorizes with that context. The LLM may propose a brand-new category name; `scanGmailForUser.ts` only actually inserts it into `categories` when confidence ≥ `NEW_CATEGORY_CONFIDENCE_THRESHOLD` (0.85, stricter than the 0.6 review threshold) and it isn't a generic catch-all — otherwise the transaction falls back to "Otros" with `needs_review = true`.

Transactions get deduped by a `unique(user_id, source_email_id)` constraint — re-scanning the same message is a no-op insert, not an error worth surfacing.

**All relative imports under `api/` need an explicit `.js` extension** (e.g. `from './supabaseAdmin.js'`), even though the source files are `.ts`. `package.json` has `"type": "module"`, so Vercel's Node runtime loads these as native ESM, which — unlike TypeScript's bundler resolution used for typechecking — refuses to resolve extensionless relative specifiers at runtime. Omitting the extension typechecks fine locally and fails silently in production (`ERR_MODULE_NOT_FOUND`, surfaced to the client as a non-JSON error body). Check `vercel logs` when an API route misbehaves in prod but works locally — this class of bug won't show up any other way.

### Custom Select component

`src/components/Select.tsx` is a hand-rolled dropdown, not a native `<select>`. This is deliberate: a native `<select>`'s open popup is drawn by the OS/browser and can't be restyled to match the rest of the app (translucent glass panels over the gradient background). It optionally supports an inline "+ agregar" one-field mini-form (`onCreate`) and a per-option delete button (`onDelete`) — currently only wired up for income sources in `Transactions.tsx` (categories used to support delete too; removed per product decision, don't re-add without checking history/asking).

**CSS pitfall already hit twice in this codebase**: never set `display: flex` directly on a `<td>` — it drops the element's table-cell behavior and misaligns the whole row. Put the flex layout on an inner `<span>`/`<div>` instead. Related: if that inner wrapper has `flex-direction: column`, any `flex-basis` set on its child via a *different*, broader selector (e.g. a generic `.form input { flex: 1 1 160px }` meant for row siblings) gets reinterpreted as a height instead of a width, because flex-basis follows the container's main axis. Scope sizing rules to direct children (`.form > input`) when the DOM nesting isn't flat.

**Another one**: `.tx-form`'s direct children are stretched to the tallest sibling's height (default `align-items: stretch`) — but that only grows a *wrapper* div like `.tx-field` or `.select`, not the actual `<input>`/`.select-trigger` inside it, which keeps its own shorter natural height. Any field wrapped in an extra div needs its inner control explicitly sized (`flex: 1` in these cases) to actually fill that stretched space, or it'll sit a couple px shorter than bare siblings like Comercio or the Agregar button.

### Mobile layout (< 720px)

Below 720px (see the `@media` block at the end of `src/index.css`), several things change together, all independent of each other's state:
- The sidebar (`Layout.tsx`) collapses into a top bar; `mobileOpen` state (separate from desktop's icon-only `collapsed` toggle) shows/hides the nav + user section as a dropdown, closing automatically on route change. The toggle icon is a chevron that flips 180° via a `.open` class, not a hamburger.
- The new-transaction form (`Transactions.tsx`) starts collapsed behind a "+ Nueva transacción" toggle (`formOpen` state), closing again after a successful add. Desktop always shows it expanded.
- The transactions table scrolls horizontally inside its own `.tx-table-scroll` wrapper (custom-styled scrollbar, `min-width: 640px` on the table itself) instead of overflowing the page — `.app-shell` has `overflow: hidden`, so without that wrapper there'd be no way to reach the clipped content. Table cells are `white-space: nowrap` for the same reason: they're meant to scroll, not wrap onto a second line.
- `.app-shell`/`.auth-screen` use `100dvh`, not just `100vh` — mobile browser chrome (address bar showing/hiding) makes plain `100vh` undershoot the real visible height, leaving a gap of near-black `body` background below the gradient when content is short.

### Modal component

`src/components/Modal.tsx` is a generic full-screen overlay (translucent gray backdrop + glass panel, `position: fixed`, blocks all clicks including on the sidebar) — used for the Gmail-delete confirmation in `Transactions.tsx` and the "Sincronizando con Gmail..." blocking overlay shown for the duration of a scan. Not a native `<dialog>` or third-party lib, to match the app's own translucent aesthetic instead of OS-drawn chrome (same reasoning as the custom Select above).

### Gradient background

`.gradient-bg` (in `src/index.css`) is the shared diagonal gradient + SVG-turbulence grain texture used on both the login screen and the app shell. It's applied as a class, not hardcoded per page, so login and the logged-in app stay visually consistent.

### Domain types

`src/types/database.ts` has hand-written interfaces (`Transaction`, `Category`, `IncomeSource`, etc.) instead of a generated Supabase `Database` type — an earlier attempt at a strict generic `Database` type fought the installed `@supabase/supabase-js` version's expected shape and wasn't worth it before a real generated schema exists. `supabase.from(...)` calls are effectively untyped at the client level; rely on the domain interfaces for shape, not compiler-enforced query typing. Regenerate proper types with `supabase gen types typescript` if this becomes painful.

## Non-obvious product decisions

- **Gmail parsing instead of a bank API**: Argentine retail banks don't expose real open banking (unlike US/Plaid or EU/PSD2), so parsing confirmation emails is the practical path, not a fallback.
- **No agent loop for categorization**: a single structured-output LLM call is enough; only the merchant web-search step is a second call, and only when the first pass is ambiguous.
- **"Nueva" indicator**: `transactions.seen` starts `false` for Gmail-sourced rows, flips to `true` right after the row is first rendered in Transactions (not before) — the orange indicator is genuinely "seen at most once," not a permanent flag. Manual entries are inserted with `seen: true` since the user just typed them.
- **`needs_review`** (confidence < 0.6) and **"nueva"** (`seen`) are separate, independently-rendered concerns — don't conflate them into one visual treatment (this caused a color conflict once: income amounts are green, and a low-confidence income row shouldn't fight that green with the review indicator's own color).
