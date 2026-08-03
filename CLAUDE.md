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

Vercel auto-deploys everything pushed/merged to `main` via the GitHub↔Vercel integration (confirmed working by the user directly) — a merge to `main` is enough, no separate deploy step needed. `vercel --prod` still works for deploying the local working tree directly (e.g. to ship something before it's merged), but isn't required as part of the normal merge-to-`main` flow.

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

### Telegram alert ingestion (Inversiones)

El bloque "Alertas de Telegram" en `Investments.tsx` (componente `src/components/TelegramAlerts.tsx`) lee un grupo donde mandan alertas de compra/venta y genera un análisis on-demand.

**Usa MTProto (la API de cliente), no la Bot API, y eso no es una preferencia sino un requisito.** Se evaluó la Bot API primero y no sirve para este caso: un bot no puede leer el historial anterior a su ingreso al grupo (no hay endpoint), necesita que alguien con permisos lo agregue — el usuario no es admin de este grupo —, y arranca con el modo privacidad prendido, viendo solo mensajes dirigidos a él. Con la cuenta propia alcanza con ser miembro: se lee el historial completo, sin tocar el grupo. El export manual de Telegram Desktop tampoco servía como base automatizable: "Exportar historial" es una acción de la GUI, no hay CLI ni endpoint que la dispare.

El precio de esa decisión es que `TELEGRAM_SESSION` es una credencial de la cuenta personal del usuario, no de un bot descartable, y **ata la feature a un solo usuario** — el chat se configura por env var (`TELEGRAM_CHAT_ID`), no por usuario, a diferencia del resto de la app que es multi-tenant por RLS.

Env vars necesarias: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` (de my.telegram.org), `TELEGRAM_SESSION`, `TELEGRAM_CHAT_ID`. La sesión se genera **una sola vez a mano** con `node scripts/telegram-login.mjs` — Telegram pide un código por app para crear una sesión nueva, así que ese paso no puede correr en Vercel. Ese script también lista los grupos con su id, que es de dónde sale `TELEGRAM_CHAT_ID`.

`api/_lib/telegramSync.ts` es el core compartido, llamado desde `api/cron/sync-telegram.ts` (diario) y `api/telegram/sync.ts` (botón "Sincronizar", JWT-gated). Tiene dos fases que nunca corren juntas: **backfill** camina el historial hacia atrás desde el mensaje más nuevo y puede necesitar muchas invocaciones (corta por `MAX_PAGES_PER_RUN` y por presupuesto de tiempo, devolviendo `hasMore` para que el cliente repita — mismo patrón que `BATCH_SIZE`/`hasMore` en `scanGmailForUser.ts`), e **incremental**, que solo trae lo posterior a `last_message_id`. Hasta que el backfill no llegue al principio del grupo, los mensajes nuevos esperan; la UI lo avisa. La fila de `telegram_sync_state` la crea el endpoint manual, no el cron — es el único punto donde hay un JWT del que sacar el `user_id` (igual que `gmail_connections`).

`api/telegram/analyze.ts` corre sobre lo que ya está en la base, no habla con Telegram. Un `generateObject` contra Gemini (mismo modelo y el **mismo** `throttleGeminiCall` exportado desde `categorize.ts` — la cuota es por proyecto, así que tienen que compartir el contador) devuelve resumen narrativo + señales estructuradas. Se cachea el resultado en `telegram_analyses` para que volver a entrar a Inversiones no dispare otra llamada paga; solo el botón genera uno nuevo.

**El rendimiento de las señales se calcula en código, nunca en el LLM** (un modelo no sabe a cuánto cerró un papel, lo inventa). `api/_lib/priceHistory.ts` usa el endpoint de chart de Yahoo Finance: no está documentado ni tiene contrato de estabilidad, pero es la única fuente gratis que cubre BCBA — el free tier de Twelve Data (el que usa `api/investments/symbols.ts`) son 3 exchanges, todos de EE.UU., y data912 solo expone precios en vivo, no series. Necesita `User-Agent` de browser o contesta 403/429. Como es frágil, todo ahí devuelve `null` en vez de tirar: una señal sin precio se muestra sin evaluar y no rompe el análisis. Los tickers se resuelven probando `SÍMBOLO.BA` **antes** que el pelado, porque varios papeles de ByMA tienen ADR con el mismo nombre (GGAL, YPF, PAM) y al revés se evaluaría el papel de Nueva York, en otra moneda.

El frontend nunca lee `telegram_messages` — solo el análisis derivado (decisión de producto: menos datos de terceros a la vista).

### UI conventions: colors, fonts, buttons, inputs, dialogs, scrollbars

All of this lives in the one global `src/index.css` (no CSS modules, no styled-components, no Tailwind) — every page/component just reaches for these shared classes rather than writing its own variant. When adding a new form or panel, match these instead of inventing new styles.

**Colors and shape** — CSS vars on `:root`: `--bg` (near-black page background), `--text`, `--danger` (`#ff6b6b`, red), `--income` (`#4ade80`, green), `--warning` (`#f5a623`, orange). The brand blue `#1a1fb8` and the gradient sweep (`#1a1fb8` → `#3a2fd6` → `#6c3fe6` → `#4433c8`, plus a soft pink radial accent `#ffd9ea` in one corner) are hardcoded where used (`.gradient-bg`, primary-button text color) rather than promoted to a var — there's only ever one gradient in the app. `--radius: 2px` is deliberately almost-square, not the rounded-corner "glass" look you'd expect from a translucent-panel aesthetic — every bordered element (buttons, inputs, panels, badges) uses `var(--radius)`. `color-scheme: light dark` is set on `:root`, but there's no actual light theme built — the whole app is dark-only; that line mainly keeps native form control chrome (date pickers, etc.) from looking out of place.

**Fonts**: `--font-heading` (Space Grotesk) is both the body default and headings — there's no separate body font. `--font-mono` (Space Mono) is reserved for *numbers that need to line up or read as data*: monetary amounts (`.tx-amount`, `.budget-summary-amount`, `.budget-card-spent`), the masked amount input (`.amount-input`), and payment-method/card-digit text. Regular labels and buttons stay on the heading font.

**Buttons** — three recurring visual treatments, all `border-radius: var(--radius)`, `font-family: inherit`, `cursor: pointer`:
- *Translucent/secondary* (the default almost everywhere: `.gmail-scan-btn`, `.nav-btn`, `.tx-pagination-*` buttons, `.modal-actions button`, plain `<input>`-adjacent buttons): `background: rgba(255,255,255,0.08)`, `border: 1px solid rgba(255,255,255,0.2)`, white text, hover brightens the background to `~0.16–0.18` opacity.
- *Primary/CTA* (`.tx-form > button`, `.budget-empty button`, `.modal-actions button.primary`): solid `rgba(255,255,255,0.9)` background, brand-blue (`#1a1fb8`) text, bold, hover goes to `#f4f4ff`. Used for the one "main" action in a form/dialog (Agregar, Crear presupuesto, Guardar cambios).
- *Danger* (`.modal-actions button.danger`): translucent red — `rgba(255,107,107,0.16)` background, `rgba(255,107,107,0.4)` border, `var(--danger)` text — matching the translucent language of the other button styles instead of a solid fill (an earlier solid `rgba(255,107,107,0.85)` + dark-text version read as too heavy on mobile). Used only for destructive confirms (Eliminar). `.gmail-scan-btn.danger` (e.g. "Vaciar" in Configuración) still uses the older solid treatment — not revisited.
- *Icon-only* (`.tx-edit-btn`, `.tx-delete-btn`): same translucent treatment but square-ish (`padding: 0.3rem`, no text), row-level actions in tables.
- *Segmented toggle* (`.type-toggle`, e.g. Egreso/Ingreso, Mensual/Personalizado): a bordered pill container with transparent buttons inside; the active one gets `rgba(255,255,255,0.15)` background, or `rgba(74,222,128,0.22)` + `var(--income)` text for the income-flavored active state specifically.

**Inputs** (`<input>` of any type, always inside a form using the shared pattern) — same recipe wherever they appear (`.tx-form input`, `.budget-form input:not([type='checkbox'])`, `.tx-edit-form > input`): `width: 100%`, `padding: 0.5rem`, `border-radius: var(--radius)`, `border: 1px solid rgba(255,255,255,0.2)`, `background: rgba(255,255,255,0.08)`, white text, placeholder at `rgba(255,255,255,0.55)`. Checkboxes are explicitly excluded from this (kept as native checkboxes, not restyled). There's no native `<select>` in the app — see "Custom Select component" below. Because this exact block gets copy-pasted per form context instead of shared via one class, **two real layout bugs have already come from it** — see the two CSS-pitfall paragraphs under "Custom Select component" below before wiring inputs into a new flex container, especially a column one.

**Dialogs**: see "Modal component" below — every dialog in the app (confirms, edit forms, the Gmail-sync spinner) is the same `Modal.tsx` + `.modal-panel` + `.modal-actions` combo, never a native `<dialog>` or a one-off overlay. `.modal-actions` right-aligns its buttons by default (`justify-content: flex-end`, wraps on overflow). When a dialog needs a destructive action separated from the save/cancel pair (e.g. editar presupuesto's "Eliminar presupuesto"), give that button `.modal-actions-start` — `flex: 1 0 100%` forces it onto its own full-width row, and the `.modal-actions-start ~ button` sibling rule makes the remaining buttons split the next row evenly instead of shrinking to content width. This is scoped via the `~` combinator so it only kicks in for dialogs that actually have a `.modal-actions-start` button — other two-button confirm dialogs (borrar transacción, borrar categoría, etc.) keep the plain compact/right-aligned look.

**Category icons**: `src/lib/categoryIcons.tsx` exports `ICON_OPTIONS` (a fixed set of line icons, each with a short string `key` like `shopping-cart`) and `getCategoryIcon(name, icon?)`. The icon-picker grid in Configuración (`.icon-picker` / `.icon-picker-option`, a plain button grid, active state = filled white like the primary button) writes one of those keys into `categories.icon`. `getCategoryIcon` checks that key first, and only falls back to a hardcoded name→icon map for older/default categories that predate the picker and don't have a recognized key yet (seeded categories actually have an *emoji* in `icon`, e.g. `🛒`, which intentionally doesn't match any key so it falls through to the name map) — so don't assume `category.icon` is always one of `ICON_OPTIONS`'s keys, and always pass both `name` and `icon` when calling `getCategoryIcon`.

**Backgrounds**: see "Gradient background" below — `.gradient-bg` is the only background treatment in the app (login, app shell, every modal panel); don't introduce a flat/solid panel background as an alternative.

**Scrollbars**: two places currently scroll internally (`.tx-table-scroll` horizontally, `.budget-category-list` vertically) and both hand-style their scrollbar the same way — Firefox via `scrollbar-width: thin` + `scrollbar-color: rgba(255,255,255,0.35) rgba(255,255,255,0.08)` (thumb, then track), Chrome/Safari/Edge via `::-webkit-scrollbar{track,thumb}` with matching colors and a `4px`/`8px` radius-vs-thickness pairing. Copy this exact block for any new internally-scrolling container rather than leaving the browser default — but note iOS Safari draws its own overlay scrollbar that ignores all of this; there's no way to restyle it there.

### Custom Select component

`src/components/Select.tsx` is a hand-rolled dropdown, not a native `<select>`. This is deliberate: a native `<select>`'s open popup is drawn by the OS/browser and can't be restyled to match the rest of the app (translucent glass panels over the gradient background). It optionally supports an inline "+ agregar" one-field mini-form (`onCreate`) and a per-option delete button (`onDelete`) — currently only wired up for income sources in `Transactions.tsx` (categories used to support delete too; removed per product decision, don't re-add without checking history/asking).

**CSS pitfall already hit twice in this codebase**: never set `display: flex` directly on a `<td>` — it drops the element's table-cell behavior and misaligns the whole row. Put the flex layout on an inner `<span>`/`<div>` instead. Related: if that inner wrapper has `flex-direction: column`, any `flex-basis` set on its child via a *different*, broader selector (e.g. a generic `.form input { flex: 1 1 160px }` meant for row siblings) gets reinterpreted as a height instead of a width, because flex-basis follows the container's main axis. Scope sizing rules to direct children (`.form > input`) when the DOM nesting isn't flat.

**Another one**: `.tx-form`'s direct children are stretched to the tallest sibling's height (default `align-items: stretch`) — but that only grows a *wrapper* div like `.tx-field` or `.select`, not the actual `<input>`/`.select-trigger` inside it, which keeps its own shorter natural height. Any field wrapped in an extra div needs its inner control explicitly sized (`flex: 1` in these cases) to actually fill that stretched space, or it'll sit a couple px shorter than bare siblings like Comercio or the Agregar button.

### Custom DateField component

`src/components/DateField.tsx` replaces every `<input type="date">` in the app (`Transactions.tsx` ×2, `Investments.tsx` ×3, `Budgets.tsx` ×2 custom-range) with a hand-built button-trigger + calendar popup, reusing `Select.tsx`'s exact `.select`/`.select-trigger`/`.select-panel` classes so it looks identical to every other dropdown in the app, with a bit of extra CSS (`.date-field-*`) just for the calendar grid itself. Shows numeric `d/m/aaaa` (e.g. "15/8/2026"), not a locale-dependent spelled-out format.

This started as a mobile-only swap (desktop's native input was never broken) fixing a real bug: iOS Safari's native date input was painting its internal day/month/year segments wider than its own border-box in the mobile-stacked form layout, overflowing off-screen and getting clipped by `.app-shell`'s `overflow: hidden`. Multiple rounds of CSS (`font-size`, `flex-shrink`, `min-width: 0`, `overflow: hidden`, `-webkit-text-size-adjust`) did not fix it on a real device — the eventual conclusion was that this is a genuine WebKit rendering bug, not a sizing/flex miscalculation fixable from CSS, so the control got replaced outright (same reasoning as `Select.tsx`/`Modal.tsx` replacing other native controls that can't be restyled). Once confirmed working on a real iPhone, it was switched on for desktop too for consistency — there's no `matchMedia`/breakpoint branching left in the component, it's just the custom picker everywhere now.

### Investment symbol search

`src/components/SymbolSearch.tsx` is the "Símbolo" field in Inversiones — same `.select`/`.select-panel` wrapper as `Select.tsx` (so the dropdown looks identical) but with a real `<input>` instead of a button-trigger, since here the value is typed, not picked from a fixed list. It debounces (250ms) and calls `GET /api/investments/symbols?q=...`, which only ever returns ticker strings — never price. The ARS/USD toggle in the form does **not** filter this search — both sources are always queried and merged, because the toggle only picks how the position gets valued, not which symbols are legitimate to buy in which currency. Selecting an option calls a separate `onSelect` prop (vs. `onChange`, which fires on every keystroke too) — `Investments.tsx` uses that distinction to require an actual pick from the list before `handleAdd` will insert a lot, rejecting free-typed text that never matched a suggestion.

`api/investments/symbols.ts` is JWT-gated (`getUserIdFromRequest`, same as the Gmail routes) so an anonymous caller can't burn through the Twelve Data quota via this proxy. Every request queries both sources in parallel (`Promise.allSettled`, so one source failing doesn't sink the other) and returns the merged, deduped result:
- `https://data912.com/live/arg_stocks` — an unauthenticated public endpoint mirroring ByMA, but with no CORS headers, so it has to be proxied server-side even though it needs no secret.
- Twelve Data's `symbol_search` endpoint, which does need a key — `TWELVE_DATA_API_KEY` in Vercel env vars (already set). Twelve Data's response actually includes more than the symbol (`instrument_name`, `exchange`, `country`, `currency`, `instrument_type`, `mic_code`) — all discarded today since only the ticker is used, but there if a richer picker (e.g. showing the company name) is wanted later.

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
- **"Nueva" indicator removed**: `Transactions.tsx` used to show an orange `!` badge (`.new-badge`) next to unseen Gmail-sourced rows, backed by `transactions.seen`, flipping to `true` right after first render. Removed by explicit product decision — the read/render logic and the "mark seen" mutation in `load()` are gone from `Transactions.tsx`. The `seen` column itself is untouched in the DB (no migration), just unused by the frontend now; `.new-badge` the CSS class is still live and used for an unrelated "Activo" marker in `Budgets.tsx`'s period history table, so don't remove that rule.
- **`needs_review`** (confidence < 0.6) is still shown via `.review-dot` on the merchant/source cell — kept independent of any other visual treatment (this caused a color conflict once: income amounts are green, and a low-confidence income row shouldn't fight that green with the review indicator's own color).
