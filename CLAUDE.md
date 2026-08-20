# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                      # API (:3000) + static web server (:5173) together
npm run dev:api                  # API only
npm test                         # node --test tests/*.test.js  (176 tests, ~1.5s)
node --test tests/notices.test.js                       # one file
node --test --test-name-pattern="reparent" tests/       # one test by name
npm run migrate                  # apply services/api/db/migrations to data/brianhub.sqlite
npm run seed:test-data
npm run security:semgrep         # rules in .semgrep.yml (no eval, no shell:true, no Math.random for ids)
```

Web UI at `http://localhost:5173/apps/web/`; `/shoppinglist` redirects to `/apps/shopping/`.
No linter or formatter is configured — match surrounding style.

## Architecture

Three layers, no build step anywhere. Everything is ESM, vanilla JS, no framework, no bundler.

**`apps/web/`** — the browser client. `app.js` is a **32,000-line single-module monolith** holding one
global `state` object and ~1,200 top-level functions; it is the whole UI (tasks, kanban, calendar,
scheduling, admin, settings). Its helpers are split out: `api.js` (fetch wrapper, sends
`X-Client-Id`/`X-Request-Id`, `credentials: 'include'`), `localData.js` (localStorage domain snapshot +
pending-change queue), `syncState.js` (applying remote changes, reconciling against pending), `syncQueue.js`
(replay with exponential backoff), `config.js` (API base: port 5173 → 3000 in dev, same-origin in prod).

**`services/api/`** — Fastify v4. `server.js` (3k lines) is routes + auth middleware only; all domain logic
lives in `taskService.js` (4.2k lines, raw SQL against the db client). `routeSchemas.js` attaches JSON
Schema validation to routes after they are registered (`attachRouteSchemas(server)` near the end of
server.js) — new routes need their schema added there, not inline.

**`concepts/data-layer/`** — the DbClient abstraction (`query`/`queryOne`/`exec`/`transaction`) that
`services/api/src/db.js` wires up. SQLite via `sql.js` today, `postgres-client.js` stubbed for later.

`packages/core/` holds the pure logic shared by client and server (`priority.js`, `taskState.js`, `tree.js`).

### Local-first sync model

Writes go to the API when online; when offline or on failure they land in `state.local.pendingChanges` via
`queueLocalChange()` and are replayed by `replayPendingChanges()`. Replay semantics matter: a 409 or any 4xx
marks the change `needs_attention` and **halts the queue** (order is preserved, nothing after it replays);
5xx/network errors get backoff retries. `/sync/push` dedupes on `client_mutation_id`; `/sync/pull` is a
`change_log` cursor scan by `seq`.

`apps/web/sync.js` is dead legacy code — hardcoded `localhost:3000`, references a `state.changeLog` shape
that no longer exists, imported by nothing. Don't extend it.

### Auth and tenancy

Every domain route funnels through `ensureWorkspaceAccess()`. Two principal types: users (session cookie) and
service accounts (`Authorization: Bearer bht_…`, permissions from `permissionRegistry.js`, plus explicit
per-workspace grants). `BRIANHUB_REQUIRE_AUTH` defaults to **false** — with it off, access checks are
effectively bypassed, so a change that looks fine locally may 403 in production. Data is scoped org →
workspace → entity; `assertTenantCtx` enforces this in the repo layer.

## Gotchas

**Two divergent migration lineages.** `services/api/db/migrations/` (36 files) is the live schema used by the
API and `npm run migrate`. `concepts/data-layer/migrations/` is a separate, incompatible `001_init.sql`
lineage used only by `tests/task-repo.test.js` and `npm run migrate:data-layer`. Schema changes go in the
`services/api/db/` one; number the file after the highest existing prefix (gaps like 009/011/013 are
intentional and permanent — the runner keys on filename in the `migrations` table).

**sql.js rewrites the entire DB file on every write.** `exec()` outside a transaction calls `db.export()` and
atomically replaces `data/brianhub.sqlite`. Batch multi-statement work inside `db.transaction()` or a loop
turns into N full-file writes.

**UI tests assert on literal source text.** `tests/mobile-ui.test.js`, `task-sidebar-ui.test.js`,
`workflow-ui.test.js` and friends `readFileSync` `apps/web/index.html`, `app.js`, and `styles.css` and regex
them for exact element ids, class strings, and CSS declarations. Renaming an id or reflowing a CSS rule
breaks tests with no runtime failure. Run the suite after any markup or stylesheet edit.

**`apps/shopping/` is a second, self-contained app** — an installable offline-first PWA at `/shoppinglist`
that will eventually replace the shopping surface inside `apps/web`. Both are live right now and write to the
same API, so shopping behaviour exists in two places until the web surface is removed. It deliberately
imports nothing from `apps/web` (own config, API client, storage key `brianhub_shopping_v1`, and client id
`brianhub_shopping_client_id` — sharing the web app's client id would make each app invisible to the other,
since `/sync/pull` filters out changes matching the caller's id). A test enforces the no-import rule.

Three rules that are easy to break there. Never send `sort_order` when creating a shopping item: an explicit
sort order makes the server skip hint-aware placement, which is the trained per-store aisle ordering
(`taskService.js` `planShoppingItemInsertion`). Keep the service worker network-first for shell assets —
stale-while-revalidate serves the previous release's `app.js` on the first load after a deploy. And note
that **aisle-order learning only fires for a list with a `store_name`** — `getShoppingListStoreKey()` returns
null without one and `learnShoppingItemOrderHints` no-ops, so any change that lets a list be created without
a store silently switches the learning off. The PWA learns by PATCHing `sort_order` in check-off order when
a list is completed (`learnOrderFromCheckoff`), which is why that gate matters.

Item names in the PWA are standardised through `canonicalKey()` in `apps/shopping/store.js` (case,
punctuation, accents, plurals, filler words and word order collapse; quantities do not). Server-side hint
keys are just `lowercase + collapse whitespace`, so the client sending a consistent name is what keeps one
item from training several aisle positions. `state.aliases` maps merged-away keys to their target — without
it, re-typing a tidied spelling recreates the entry. `STATE_VERSION` bumps rebuild the derived catalogue
from items and must never discard `lists`, `items` or `pending`.

The needs queue (`Stuff we need`) is an ordinary server-backed shopping list, found by
`findNeedsList()` (by id, falling back to name so a reinstall re-adopts it) and excluded from
`getVisibleLists`. Per-item store restrictions (`onlyAt`) and purchase history (`purchases`, feeding
`estimateFrequency`) live on the catalogue entry, i.e. **device-local**. Purchase history self-heals from
server `updated_at` on bought items; `onlyAt` and `aliases` do not — they are the only knowledge a new
device cannot recover, and want a server table if that ever matters. Do not repurpose the `store_rules`
table for "sold only here": the web app auto-learns those keywords from list contents as a fuzzy
store-guessing hint, so its existing rows mean the opposite.

## Deployment

Manual, host-side, from `origin/main`: immutable releases under `/opt/brianhub/releases`, symlink flip at
`/opt/brianhub/current`, systemd + Caddy on a dedicated VPS. `npm run deploy:host` runs on the host, not
locally. `npm run rollback:host` reverts the symlink. See `docs/deployment.md`.

## Documentation policy (enforced by convention here)

Behavior changes ship with doc updates in the same workstream:
- `docs/product-features.md` for user-facing behavior and IA changes
- `apps/web/help/api-docs.js` for any API or auth-surface change (it is the source of truth for the in-app
  API reference at `/apps/web/help/api/`)
- `README.md` when setup, scripts, or top-level behavior change
- `docs/roger-api-brief.md` when the production API path or its guardrails change

`docs/agents.md` declares CERES governance (single-concept commits, prompt artifacts) with canonical files at
`.ceres/`, but that directory is not present in this checkout.
