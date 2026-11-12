# Stash online web UI and CR-SQLite service

Node 24/TypeScript, Hono HTTP routing, bundled React, and the existing raw Node HTTP/WebSocket server with CR-SQLite 0.16.3. This implements the online-only first slice of [zpm/stash#59](https://github.com/zachpmanson/stash/issues/59). It uses the **same** `stash-backend` room/database and unchanged `stash-sync-v1.sql` identity/version as native sync, not a second application database or browser replica.

Source baseline: **`9f238df`**, the reviewed but unmerged prerequisite [zpm/stash#58](https://github.com/zachpmanson/stash/pull/58). This branch includes that prerequisite until it integrates; review the new implementation with `git diff 9f238df..HEAD`. Implementation/review used only disposable state and synthetic credentials, with no live service/database/device access. Zach subsequently authorized deployment **after independent review/fixes pass**; activation, exact pin and private backup evidence are tracked on the issue and Nix operational runbook rather than inferred from a successful build. Private image transport is implemented by the same process/DB; see [private-images.md](../../../docs/private-images.md) for its format/size/auth/queue/backup protocol. Other backend parity remains under [zpm/stash#26](https://github.com/zachpmanson/stash/issues/26).

Always-on private folder Atom feeds and read-only Android status/copy/preview: see [`../../../docs/folder-feeds.md`](../../../docs/folder-feeds.md) for review baseline, API/content/cache/recovery semantics, disposable validation and future owner-approved configuration. Feeds stay behind Caddy Basic authentication; this change is **not deployed**.

## Trust boundary

- The listener is fixed to `127.0.0.1`; there is no bind-address override or firewall listener. Naboo Caddy is the only ingress.
- Caddy requires its existing Basic-auth identity for **root HTML, assets, API and WebSockets**, and overwrites `X-Auth-User` with the configured single-tenant identity. Independently, every API path (including unknown routes), each asset route and WebSocket upgrade requires exact `AUTH_USER` (default `zach`). Browser requests are same-origin and do not supply the stamped header. Do not forward a client-supplied identity or expose the origin.
- Writes require `application/json` and `X-Stash-Request: 1`; foreign `Origin` hosts and cross-site Fetch Metadata are rejected. There is no CORS permission. JSON bodies are limited to 64 KiB, with smaller field/type/URL limits and unknown-field rejection. Errors omit SQL, stack traces and private paths. Plaintext rendering, validated credential-free http(s) links, a restrictive CSP and exact static-file routes prevent HTML injection and filesystem traversal.
- Raw WebSocket upgrades also validate any supplied browser `Origin` against the request's public origin (including scheme/port), rejecting opaque/malformed/foreign origins and cross-site Fetch Metadata. Caddy must overwrite `X-Forwarded-Proto` and preserve the public Host; the same-host trusted proxy boundary is unchanged. Native peers without Origin remain supported. This prevents browser-cached Basic credentials from authenticating an attacker-origin WebSocket; HTTP CSRF middleware alone cannot protect raw upgrades.
- No JWT, users table or custom auth. HTTP Basic credentials remain browser-managed: there is deliberately **no fake signout button**.
- The service cannot authenticate a direct-origin client that can reach loopback and forge the header. That is why it must remain loopback-only, with Caddy proxying to it on the same host. Never change the bind address or expose this port directly.
- `ENABLE_TEST_ENDPOINTS=1` exposes disposable offline-write/inspection HTTP hooks. It is disabled by default and must not be set in deployment.

Malformed WebSocket handshakes are rejected with HTTP 400 instead of throwing through the upstream upgrade handler. Malformed authenticated payloads (including empty, unknown-tag, truncated and illegal client messages) terminate only the offending WebSocket, not the service. The lifecycle tests verify continued health and replication by another valid peer, reject upgrades without `X-Auth-User` (HTTP 401), accept the stamped identity, and exercise an active connection during shutdown. They also back up/restore a CR-SQLite database and verify persistence after restart.

## Runtime configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | TCP port; validated as 1–65535 |
| `DATA_DIR` | `./data` | Persistent directory containing the `stash-backend` SQLite file |
| `SCHEMA_DIR` | `./schemas` | Server schema directory (the pinned candidate schema is written at startup) |
| `AUTH_USER` | `zach` | Exact Caddy-stamped `X-Auth-User` for HTTP API/assets and WS upgrades |
| `ENABLE_TEST_ENDPOINTS` | unset | Set to `1` only for local integration tests |
| `FEED_BASE_URL` | unset | Explicit credential-free HTTPS origin for private Atom links; unset → feed operations unavailable. Never inferred from Host. |

Before invoking the upstream database factory or writing a schema file, startup opens any existing database **read-only** and requires its stored schema name/version to match the compiled candidate exactly. Missing/unrecognized metadata also fails closed. An existing resident schema file must match the compiled DDL byte-for-byte; it is never silently overwritten. This prevents the upstream factory's automatic migration from running on a database with an unexpected identity/version. Fresh databases remain supported; current-schema startup then checks all five candidate CRR tables and SQLite `integrity_check` before opening the listener. This is not a general migration policy or a full DDL-drift detector for a database whose metadata has been manually forged; schema changes require a separately reviewed migration/recovery procedure. Rolling back code alone is not a data rollback. `/healthz` reports readiness and the schema version. `/sync/status?clientSiteId=<hex>` requires the Caddy-stamped identity and reports the highest outbound version available to that client (excluding changes the client already originated), plus the highest version received from it and aggregate table counts. The app also compares its tracked version for the server site ID. Together these checks form the two-way completion barrier before destructive projection into Stash's local tables. The high-water marks follow ws-client 0.2.0's `(db_version, 0)` whole-version-group convention. Logs are newline-delimited JSON; the upstream websocket library may also emit its own logs.

## Local development and tests

Install workspace dependencies from this server directory using its own flake (the devshell includes `unzip`):

```sh
cd ~/projects/stash/spikes/crsqlite-expo/server
nix develop --command pnpm install --frozen-lockfile
```

Build the isolated x86_64 Linux service package used by Naboo:

```sh
nix build .#packages.x86_64-linux.crsqlite-sync --cores 2 --max-jobs 1
```

Run static checking and the auth/restart/backup test:

```sh
nix develop --cores 2 --max-jobs 1 --command pnpm typecheck
nix develop --cores 2 --max-jobs 1 --command pnpm build
nix develop --cores 2 --max-jobs 1 --command pnpm test
```

The same lifecycle/preflight regressions can exercise a built package rather than the checkout's `tsx` entry:

```sh
package=$(nix build .#packages.x86_64-linux.crsqlite-sync --cores 2 --max-jobs 1 --no-link --print-out-paths)
STASH_TEST_SERVER_ENTRY="$package/dist/src/server.js" nix develop --cores 2 --max-jobs 1 --command pnpm test
```

For the end-to-end Android flow, see [`../app/README.md`](../app/README.md). The disposable `/test/*` hooks remain disabled unless explicitly opted in; do not use them as a product API. `/sync/status` is part of the candidate authenticated app protocol, not a replacement for the WebSocket data channel.

## Backup, restore, and reset

**Stop the service before backup, restore, or reset.** The helper uses SQLite's online backup API and checks SQLite integrity, CR-SQLite schema identity/version, and CRR metadata in both the produced backup and restore source:

```sh
cd ~/projects/stash/spikes/crsqlite-expo/server
nix develop --command pnpm db backup /safe/path/stash-backend.sqlite
nix develop --command pnpm db restore /safe/path/stash-backend.sqlite
```

Backups now consist of the SQLite file **plus its `.media/` sidecar** with verified referenced originals and derivatives. Restore first verifies both, preserves a complete timestamped DB+media rollback, safely checkpoints/removes old WAL/SHM before atomic DB replacement and retains corrupted objects in private quarantine during verified repair. See [private-images.md](../../../docs/private-images.md); DB-only snapshots are insufficient after media manifests exist. Keep the rollback file until the service has restarted and health/data checks pass. To reset only the disposable peer, stop the service and remove `spikes/crsqlite-expo/server/data/`; the next startup creates an empty database from the candidate schema. Never point a development/test process or reset operation at Naboo state; privileged live recovery follows the separately reviewed Nix operational procedure.

## Active-client shutdown

The upstream `@vlcn.io/ws-server@0.2.3` installs a SIGINT handler that destroys its DB cache before active WebSocket peers release references. Its upgrade handler also throws on malformed/missing `Sec-WebSocket-Protocol` headers; the local patch turns those into HTTP 400 responses. Payload decoding and handling now share the broker's exception boundary; an invalid payload terminates that socket, cleanup is idempotent, and a connection that finishes opening after socket closure is released without starting its streams. Its outbound stream also leaves retry timers running on close, and its filesystem watcher shutdown did not expose/await the underlying close. A narrow local patch cancels those timers and returns the watcher-close promise. This service removes only the upstream SIGINT listener and uses ordered SIGINT/SIGTERM shutdown: stop accepting connections, destroy active sockets, wait for connection handlers, then destroy the database cache and await the filesystem watcher. The upstream watcher/debounce stack still leaves timer handles after close, so after all data-bearing resources are drained the service flushes its logs and exits explicitly. The automated test sends a real `AnnouncePresence` over an authenticated WebSocket (holding the server DB cache reference), stops under SIGTERM, and verifies persistence/backup/restore/restart.

## Dependency/runtime notes

The server uses Node 24, `@vlcn.io/ws-server@0.2.3`, `@vlcn.io/ws-common@0.2.0`, and `@vlcn.io/crsqlite@0.16.3`. The CR-SQLite package's Node 24 JSON-module compatibility adjustment is maintained as a small local patch. `better-sqlite3@12.6.2` is pinned because the older version requested upstream does not compile on Node 24.

## Online frontend development

The only favicon is `/assets/favicon.svg` (`image/svg+xml`, same authentication/no-cache/nosniff policy as the other allowlisted assets). Its white circle has transparent outer corners; the five rounded black strokes trace `assets/icon.png` exactly, translated by (-80,-95) into a 500×500 viewBox to remove launcher padding. `ic_launcher.zip` contains no vector source. Native assets/configuration are unchanged; no raster favicon fallback or embedded raster is shipped. The existing same-origin image CSP (needed for private media) also permits the favicon without further relaxation.

Web interface icons and the shared refresh/loading spinner use pinned `@tabler/icons-react` SVGs, bundled locally through named imports. Decorative icons remain 18px/currentColor with control-owned accessible labels; the spinner retains idle/loading/reduced-motion behavior. Folder emoji and the Stash brand favicon are unchanged.

All web source is under this standalone flake's input (`web/`); esbuild bundles React/TS into `dist/public/app.js`; pinned **Tailwind v4.1.18** compiles the single `web/style.css` entry into `dist/public/app.css`. CSS is not imported into esbuild: there is exactly one CSS output pipeline, no CDN, runtime engine or Vite server. `pnpm build` preserves **`dist/src/server.js`** as the package entrypoint. The Nix derivation builds the frontend and CRSQLite/native addon using Node 24, pinned Node headers, the lockfile and `fetchPnpmDeps` hash. Do not run these native addons in the root app's potentially Node 22 devshell. `pnpm build` must precede `pnpm dev`/`pnpm start` so the assets exist. Rebuild after web-source edits; `pnpm dev` watches the service TS only.

Use **fresh disposable directories**, never the Naboo paths:

```sh
# From spikes/crsqlite-expo/server; run in foreground.
PORT=18787 AUTH_USER=dev DATA_DIR="$(mktemp -d)" SCHEMA_DIR="$(mktemp -d)" \
  nix develop --cores 2 --max-jobs 1 --command pnpm dev
```

For a local browser, use a separately started **loopback-only disposable** Caddy instance with Basic authentication protecting every path, proxying to the disposable port `127.0.0.1:18787` and overwriting `X-Auth-User` with `dev`. Supply a disposable development password hash, not a real credential. Example Caddyfile (replace the placeholder before running):

```caddyfile
http://127.0.0.1:8080 {
  bind 127.0.0.1
  basic_auth {
    dev <disposable-development-password-hash>
  }
  reverse_proxy 127.0.0.1:18787 {
    header_up X-Auth-User dev
  }
}
```

Visit only the disposable local proxy. Direct browser access to the raw backend correctly fails authentication. No dev-mode bypass is provided. This example does not authorize editing the production Caddy/Nix host configuration.

## Narrow HTTP contract and projection

All `/api` paths require the trusted stamped identity. `src/contracts.ts` defines browser-safe DTOs; the API never returns article HTML, media IDs/paths/bytes, favicon URLs, locations, recipes, settings or internal CRSQLite state.

| Route | Input / result |
| --- | --- |
| `GET /api/folders` | Logical folders, including archived; tombstones hidden unless native add-wins survival applies |
| `POST /api/folders` | `{name}` (1–200 characters after trimming); server-generated ID |
| `PATCH /api/folders/:id` | Nonempty subset `{name, archived: boolean, layout: "grid" | "list"}` |
| `GET /api/items?folderId=…&archived=false&offset=0` | Stable newest-first pages of 100 plus `hasMore`; content/article/description omitted; text `excerpt` ≤240 characters and credential-free URL `domain` only |
| `GET /api/items/:id` | Plaintext detail and distinct logical `folderIds`; explicit media-unavailable placeholder |
| `POST /api/link-title` | `{url}` → `{title}`; read-only public-page lookup, URL fallback on failure; no database handle |
| `POST /api/items` | `{type: "text" | "url", content, title?, folderId?}`; server-generated ID; optional initial membership validated and inserted atomically |
| `PATCH /api/items/:id` | Nonempty subset `{content, title, archived: boolean}`; type cannot change |
| `PUT /api/items/:id/folders/:folderId` | `{present: boolean}`; pair-specific observed removal / fresh generation add |

Text content: nonblank, at most 48,000 JS characters; link content: credential-free absolute http(s), at most 4,096 characters; title: nullable, at most 500 characters; JSON body: at most 65,536 bytes (so multibyte content can hit this earlier). All body fields are validated and unknown fields rejected. Supported images have authenticated item-scoped derivative URLs and separate binary upload/finalization routes; see [private-images.md](../../../docs/private-images.md). Image title/archive/folder mutations preserve immutable originals; unavailable image bytes are a pending state. Other files remain placeholders. No delete endpoints, generic SQL endpoint, arbitrary sort/SQL filters, article extraction, offline browser support, browser WebSocket or browser CRSQLite replica.

Reads derive native logical views: membership generations collapse by pair, missing parents/items cannot contribute links, folder tombstones survive only without a live add-wins relationship, and item/folder archives remain independent (archiving a folder does not archive its items). Before a write, the transaction performs the same folder revival/orphan-membership repairs as `reconcileSyncRelationshipsOwned`. It changes only requested fields; pair removal deletes **all observed generations**, and a re-add inserts a new UUID generation. It does not replace the entire membership set or invent a timestamp protocol. CRSQLite generates the clocks. Failed validation/SQL rolls back the complete mutation and any relationship repairs.

New web links fetch their page title before saving. The fetcher retains at most the first **256 KiB** of an identity-encoded HTML response, closes at that limit even if the body has not finished, and parses only the first **32 Ki characters**. A large `Content-Length` does not disqualify an early title. Open Graph, Twitter and HTML titles are tried in that order; unavailable/late titles, unsupported responses and lookup failures fall back to the URL. The five-second total deadline, four concurrent lookups, public-address DNS pinning and per-redirect checks remain unchanged. No scripts execute or credentials are forwarded; this is not article extraction or a paywall bypass. Existing saved links are not retitled automatically.

HTTP and native WS borrow the same extension-loaded `DBCache` handle. Transactions are synchronous and contain no await. After a successful commit, the added `FSNotify.notifyChanges(room)` explicitly wakes existing outbound peers while the HTTP acquisition is still held; filesystem/WAL event timing is not required. No changes are made to schema/version, seed markers, migration policy, sync protocol or voice/user preferences. Existing preflight checks still run before the listener opens.

The UI polls every 30 seconds while visible, refreshes on focus, and provides manual Refresh/Retry. Editing pauses background refresh; its observed baseline is frozen and only dirty fields are submitted, so changing a title does not overwrite concurrent native content. Unchanged edits make no write. A deleted selected item or removed folder filter is cleared rather than poisoning later refreshes; writes show pending/error feedback. This is online-only: no optimistic/offline browser write queue, conflict editor, hard delete or browser Basic signout. Private image creation/display and Android's separate durable byte queue are documented in [private-images.md](../../../docs/private-images.md). The shared folders API orders by `name COLLATE NOCASE, id` rather than creation time (SQLite ASCII case folding, deterministic ID ties). Navigation preserves its active/archived groups; membership and other web folder views consume the same order. Pagination is offset-based; concurrent creation can move page boundaries, so refresh to reconcile.

## Desktop interface

- Fixed app/collection headers and independently scrolling folder/collection-content/reader panes. The collection toolbar sits outside the content scroller, so offsets never include its height. Scrollbar gutters are reserved on the scrolling panes (`scrollbar-gutter: stable`, with an `overflow-y: scroll` fallback); folder/archive/page changes reset content scroll, while selecting/reading/editing retains it. Below 1200 CSS pixels the reader becomes a focused drawer; below 760 pixels the sidebar becomes a keyboard-contained drawer and the reader replaces the collection with Back. A 200% desktop-zoom-equivalent viewport is tested.
- All items is virtual and defaults to list. Its layout lives only in browser storage. Real folders use replicated `sync_folders.layout`; changing layout writes only that column, waits for success, and preserves selection/collection scroll. Grid is always exactly two columns, including an unspanned odd final card.
- Archive is **archived-only**, never mixed and never a bulk mutation. It retains the folder filter, includes active folders plus a separate archived-folder group, and hides creation. Item archive/restore selects the next visible item (or previous/empty) and offers Undo. Folder archive does not cascade.
- Folder/item/archive/page state is in the URL for refresh, deep links and Back/Forward; record content and credentials are never put there. Draft navigation/unload requires confirmation. Editors freeze their observed baseline and skip unchanged writes; remote item deletion/folder disappearance invalidates editing but preserves unrelated new drafts.
- New item creation in a selected folder includes its initial membership in the same transaction. Organise changes one explicit membership at a time without replacing others. Card excerpts are escaped plaintext; link cards show safe domain metadata without per-card fetches.
- Arrow keys move card focus; Enter opens, Escape/Back returns focus. Buttons are labelled and focus is visible. Refresh keeps loaded cards, with separate saving/loading/refresh/error states. No fake Basic-auth logout.

No staging target is defined. This source/build does **not** authorize deploying to the owner-connected production service. Offline browser sync, search, general drag/drop/bulk actions, resizable splitters and other native feature parity remain deferred under [zpm/stash#26](https://github.com/zachpmanson/stash/issues/26).

## Web controls (Base UI)

The compact purple/dark theme and Tabler SVGs stay local. `@base-ui/react@1.9.0` now provides the actual shared **Button**, folder/create/rename/feed **Dialog**, folder action **Menu**, icon-action **Tooltip**, collection **ToggleGroup/Toggle**, membership **Checkbox**, text/URL **Input**, item-type and global archive **Select**, Organise **Collapsible**, and composed **Field.Root/Label/Description/Error** implementations—not just CSS or a dependency import. Refresh and header New item are icon-only with permanent accessible names and keyboard/hover tooltips; empty-state actions stay descriptive.

App still owns target identity, mutation locks and dirty/discard decisions. Base UI owns menu navigation/positioning/dismissal and dialog focus containment. Dialog portals use an explicit backdrop and inert app root (including programmatic focus protection), and restore a visible trigger after the closing commit. Layout is exclusive and nonempty; roving arrow-key focus replaces tabbing through every layout choice. Native button DOM refs/currentTarget, submit buttons, uncontrolled input identity and FormData/constraint validation remain intact.

The global Active items / Archived items Select lives in the sidebar footer below all folders and New folder, not in the header. It stays at the bottom with a short list and follows a long list in the scrollable sidebar. It uses the same guarded route/history transition as before; folder archive groups remain separate from this global item filter. Item type uses a named Select hidden input so native FormData still contains `type`. Organise uses an associated Collapsible trigger/panel and keeps membership controls mounted while hidden. Folder, editor and feed fields compose Field labels/descriptions; required and URL errors accompany native constraint validation. Menu invalidation restores a visible surviving navigation control only if the closing menu owned focus; it does not take outside-click or dialog focus.

Intentional native inventory: textarea and file-picker controls (explicit label/description associations), submit forms and disabled fieldsets (FormData and browser constraints), membership labels/legend, safe anchors and live status regions. The responsive sidebar remains the existing custom drawer/focus loop; it is **not** a newly converted Base UI Dialog. Mobile migration is out of scope; existing narrow/touch regressions are retained, not a claim of new mobile work.

API research: official [Button](https://base-ui.com/react/components/button), [Dialog](https://base-ui.com/react/components/dialog), [Menu](https://base-ui.com/react/components/menu), [Checkbox](https://base-ui.com/react/components/checkbox), and [Toggle Group](https://base-ui.com/react/components/toggle-group), [Select](https://base-ui.com/react/components/select), [Collapsible](https://base-ui.com/react/components/collapsible), and [Field](https://base-ui.com/react/components/field) docs plus pinned 1.9.0 installed types. Changing the dependency lock requires refreshing `flake.nix`'s `pnpmDeps.hash` and revalidating `nix build`.

## Added validation and limitations

`pnpm test` runs existing auth/cache/schema/preflight/lifecycle tests plus:

- Real isolated HTTP service, real CRSQLite and real authenticated WS → **actual immutable native `StashReplica`, mirror and projection helpers** from this checkout. Asserts projected values/memberships, native-created link and edits → API, equal-clock scalar conflict convergence, archives, observed-remove/concurrent-add membership behavior, fresh generations, folder survival masks, deletion and unavailable media. It does not merely count rows or fake replication.
- Missing/wrong identities (including unknown API routes), malformed and oversized JSON including chunked bodies, types/unknown fields, URL schemes/credentials, SQL injection, rollback, CSRF, pagination, static traversal/MIME/CSP and test-hooks-off behavior.
- Explicit same-process notifications with the filesystem watcher stopped, plus patched runtime/source parity.
- Exact-origin/scheme/proxy/native-no-Origin WS upgrade guards, dirty-field edits across concurrent refresh, unchanged-edit no-op, selected-item404 recovery and removed-folder filter recovery.
- React component state/interaction tests and static rendering safety checks, including guarded new-folder/rename → item-edit transitions, mutually exclusive editors, Back discards, and filter-independent new-folder identity after remote removal (owned renames still invalidate). `pnpm test` preloads `test/renderer-base-ui.mjs` using Node 24 module mocks: only DOM portals and scroll locking are substituted for renderer-only tests, leaving actual controls/popup logic intact. Those tests cannot attest focus, modality or geometry. `react-test-renderer` currently emits its upstream deprecation warning; these are **not** a real browser/accessibility-engine/physical Android E2E claim.

Optional real-browser smoke (provide installed Chromium/Caddy binaries; uses only fresh disposable loopback services/profiles/synthetic credentials and blocks external browser traffic):

```sh
STASH_PACKAGE="$package" nix develop --cores 2 --max-jobs 1 --command bash -c '
  CADDY_BIN=$(command -v caddy) CHROMIUM_BIN=$(command -v chromium) \
  STASH_BROWSER_HEADED=1 STASH_TEST_SERVER_ENTRY="$STASH_PACKAGE/dist/src/server.js" \
  STASH_SCREENSHOT_DIR=/tmp/stash-synthetic-screenshots \
  xvfb-run -a node test/browser-smoke.mjs'
# Set/export STASH_PACKAGE to the package built above, or omit STASH_TEST_SERVER_ENTRY
# to exercise source. Without STASH_BROWSER_HEADED=1, Chromium runs headless.
```

This loads the actual static bundle through Basic auth, creates/edits an item without overwriting a concurrent untouched field, exercises real dirty-draft confirmation dialogs, creates a folder and atomically files an item, checks exact two-column CSS/layout persistence/scroll retention/selection/history/archive/Undo, keyboard focus return, narrow drawers and a 200%-zoom-equivalent layout. Base UI-specific checks additionally exercise actual Tab/Shift+Tab/Escape/outside and touch dismissal, menu arrow/Home/End focus, guarded pending/failed dialogs, keyboard tooltips, exclusive layout toggles and Space checkbox mutations. Desktop completion checks use real Select keyboard navigation, FormData/mode-switch drafts, associated field labels/descriptions/native validation, Organise keyboard disclosure, and open-menu target deletion via background focus refresh (without clicking Refresh). The footer archive Select is checked for short/long-list positioning, keyboard route/content changes, Back/Forward and accepted/rejected dirty navigation. Desktop/320px tests use many items to assert a separate stable toolbar, focus visibility, folder scroll resets, independent reader scroll and no width jump between scrolling/empty content. Optional screenshots contain synthetic examples only. The headed Xvfb run additionally requires Chromium's automatic favicon request (headless has no tab favicon loader); canvas pixels in both modes verify the SVG MIME, CSP, transparent corners, white circle and black mark at 16/32/48px. `STASH_FAVICON_PREVIEW` selects its synthetic light/dark contact-sheet PNG (default `/tmp/stash-favicon-preview.png`); these are chrome-colour swatches, not a headless-browser tab strip or owner acceptance. It additionally verifies both folder-draft regressions with real input values/DOM identity/confirmation dialogs, and combined desktop atomic filing/layout with private Atom feeds behind cached Basic authentication. It also verifies same-origin replication and asserts an attacker-origin WebSocket cannot reuse cached Basic credentials or receive private frames. It is separate from the component suite and is not exhaustive accessibility/device/production-TLS acceptance.

The test script sets `NODE_PATH=./node_modules` so the immutable native harness resolves the server's TypeScript without installing the root app dependency tree. To additionally run its existing restore regressions from this server directory:

```sh
nix develop --cores 2 --max-jobs 1 --command \
  env NODE_PATH="$PWD/node_modules" node --test ../../../scripts/test-restore-merge.mjs
```

Every test uses temporary files/ports, with `ENABLE_TEST_ENDPOINTS=0` in product API tests. `STASH_TEST_SERVER_ENTRY` selects an exact built package for HTTP/WS/static/API validation; native adapter source and component tests still run from the checkout. No live endpoint, real database, credential or device is part of validation. Independent code review and owner-approved deployment remain required.
