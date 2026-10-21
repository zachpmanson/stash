# Private folder Atom feeds (review candidate)

Implements [zpm/beltino#140](https://github.com/zachpmanson/beltino/issues/140), part of [zpm/stash#59](https://github.com/zachpmanson/stash/issues/59) / [zpm/stash#26](https://github.com/zachpmanson/stash/issues/26). **Not deployed.** This master-based branch includes reviewed, still-unmerged prerequisites [zpm/stash#58](https://github.com/zachpmanson/stash/pull/58) at `f5380c1` and [zpm/stash#60](https://github.com/zachpmanson/stash/pull/60) at `9fcdda1`. Feed-only review starts after integration commit `da60891`; it does not depend on the desktop/Tailwind task.

## Operator configuration — future owner-approved deployment only

The **existing** Hono/Node HTTP + raw WS service generates Atom on its existing port/database. No new listener, database, content schema/version or public exception. All paths, including feeds, **must remain behind existing Caddy Basic authentication**. Caddy alone validates passwords, overwrites `X-Auth-User`, preserves public Host and overwrites forwarded scheme. Do not expose the loopback origin or change the existing WS Origin protections. There is no Hono Basic checker, secret URL, token, signing key, JWT or reader-specific account.

Set **`FEED_BASE_URL=https://stash.zachmanson.com`** in the service environment *when* the owner approves deployment. It must be an explicit credential-free HTTPS **origin** (optional trailing slash, no path/query/fragment); invalid values fail startup, absent configuration leaves feed operations unavailable (503). Host/forwarding headers never construct feed links. The existing Caddy catch-all should require no feed exception. This document does not authorize editing/activating the host configuration.

Reader credentials are account-wide: provide the existing login only to a trusted reader/aggregator **at the component actually fetching** the feed. Copy only the clean HTTPS URL, never embed credentials in it. Disable blocks subsequent authenticated fetches, not global credentials, and cannot recall subscriber caches. Re-enable reuses the URL and IDs.

## Android

Edit Folder → **Feed** is separate from Save. Opening/editing/saving a local folder never publishes. Settings → Sync retains its existing Android development/explicit-opt-in, preparation and recovery barriers. After a complete initial exchange, the feed page loads the backend-owned setting; enable additionally checks the current two-way watermark before sending its explicit command. Sign out cancels/drains requests, clears identity/confirmation and blocks late results. Credentials remain in the active session closure only, not public status, storage, logs, URLs or WebViews.

The page shows Pending until backend confirmation; failures/unprepared/offline/recovery/unsupported states are Unavailable, not an optimistic Enabled/Disabled. Refresh/Retry reads current server state (also usable on another connected install). Copy returns a credential-free HTTPS URL. Preview displays **plaintext Atom XML in native Text**, not a WebView, and does not enable publication. Local changes/future eligible additions appear after sync; the phone need not stay online thereafter.

## HTTP contract

Every API/feed request independently requires exact trusted owner identity, before existence or conditional-cache checks. Management writes reuse existing JSON, CSRF marker/Origin, 64 KiB body and unknown-field/type validation. Errors are generic and contain no SQL/private paths.

- `GET /api/folders/:id/feed`: `{version:1, enabled, url, backend, limit:50}`.
- `PUT /api/folders/:id/feed`: **only** `{enabled:boolean}`, backend-confirmed response as above.
- `GET /api/folders/:id/feed/preview`: Atom without enabling; private/no-store.
- `GET` / `HEAD /feeds/folders/:id.atom`: **Atom 1.0 only**, `application/atom+xml; charset=utf-8`. Missing/disabled/ineligible folder → authenticated 404. No `.rss`, query overrides, generic SQL or HTML note viewer.

Feeds use private/no-cache + Vary Authorization, semantic ETags and Last-Modified. If-None-Match (including weak tags) can return 304 **only after auth/enabled/eligibility checks**. Date-only If-Modified-Since is deliberately ignored: second precision must not conceal sub-second edits. Poll no more often than every five minutes in readers; 304 still recomputes a bounded current projection rather than serving stale content. No content/membership/read/listening writes occur on feed reads.

## Content and publication metadata

At most the newest **50 active text/link candidates**, `created_at DESC, id ASC`, in the selected logical folder. Membership generation duplicates collapse via indexed ID selection; orphan rows and other folders cannot leak. Invalid legacy link URLs are omitted, without unbounded backfill. This is **not** full export/backfill. Text uses its title or first line / Untitled note, readable plaintext. Links include only validated credential-free http(s) source URLs, title, description and saved plaintext article. No remote article/image fetch, media/enclosure/device-path fields, raw article HTML, location, voice/settings or listening progress. No automatic public note viewer.

Per entry, limits are 500 title, 8,000 text, 2,000 description, 12,000 article characters (4,096 for source URL); truncated values show `[Truncated]`. XML-invalid characters/lone surrogates are removed, Unicode preserved. Established `feed` Atom metadata serialization is converted structurally to explicit `type=text` nodes using `xml-js`; user content never enters HTML/CDATA serialization, including repeated `]]>` sequences. No regex replacement of user XML.

`folder_feeds` and `feed_entries` are **server-only, non-CRR tables in the same SQLite file**. Stable UUID URNs and the folder URL survive rename/edit/disable/re-enable. Entries retain creation/published time and record server-observed significant exported-content changes using hashes and stable publication dates; they do not invent precise offline edit times from db_version. Polling/unexported fields do not advance them. Folder rename advances feed metadata only. Metadata records are retained to preserve identities when items return to the bounded window; they contain hashes/IDs/times, not extra content copies.

Triggers observe folder archives/physical deletion/logical tombstone disappearance (including membership/item loss) and disable publication. A native archive then unarchive observed by the backend stays disabled until explicit re-enable. Add-wins folder survival is preserved. Transitions folded away entirely offline cannot be detected. Removed memberships, deleted/archived items disappear from subsequent output, not reader caches.

## Backup/recovery

Private whole-DB snapshots include settings/IDs/hashes/timestamps. **Stop the service** and use the existing `pnpm db backup …` / `pnpm db restore …` helper. Restore preserves IDs/times but **clears all enabled flags in the replacement file before atomic rename**. Review restored content and explicitly enable afterward. Native backup replay cannot restore enablement because it is not replicated. Explicit CRSQLite statement finalization releases validation locks; replacement policy writes use DELETE journaling so a renamed-away WAL cannot resurrect publication.

Do not restore by copying a SQLite file over live state. A raw filesystem copy outside the documented recovery helper cannot be distinguished from an ordinary restart; no false automatic raw-copy detection is claimed. Ordinary service restarts retain settings and dates. Existing private-backup/rollback discipline remains mandatory.

## Validation (disposable only)

From `spikes/crsqlite-expo/server` (Node 24 devshell; retains the pinned 24.18 header workaround):

```sh
nix develop --command pnpm install --frozen-lockfile
nix develop --command pnpm typecheck
nix develop --command pnpm build
nix develop --command pnpm test
nix develop --command env NODE_PATH="$PWD/node_modules" node --test ../../../scripts/test-restore-merge.mjs
package=$(nix build .#crsqlite-sync --cores 2 --max-jobs 1 --no-link --print-out-paths)
STASH_TEST_SERVER_ENTRY="$package/dist/src/server.js" nix develop --command pnpm test
STASH_TEST_SERVER_ENTRY="$package/dist/src/server.js" nix develop --command bash -c \
  'CADDY_BIN=$(command -v caddy) CHROMIUM_BIN=$(command -v chromium) node test/browser-smoke.mjs'
```

The devshell supplies disposable Caddy, Chromium and Python feedparser. Tests use fresh loopback ephemeral ports/temp profiles/synthetic credentials/records; Python actually fetches authenticated Atom through Caddy. Missing/wrong credentials cannot distinguish missing/enabled feeds or obtain 304. Existing browser cached-Basic cross-origin WS regression remains. Real native replica helpers test HTTP↔WS content, membership and archive behavior; Android tests invoke actual TSX hooks/handlers with controlled native/session boundaries, not a physical-device E2E claim.

Recorded isolated validation, **2026-10-21 AEDT**: root `pnpm lint` + 134 preparation/lifecycle/backup/recovery/handler/teardown tests, 2 transport/schema-parity tests, server typechecks + **53 tests against the complete Nix package**, 10 additional native restore-merge tests, and real Chromium+Caddy cached-Basic cross-origin WS smoke all passed. The package tested was `/nix/store/phkf2sfbhmk9biwy39nnpcps2p49zc2n-stash-crsqlite-sync-0.1.0`; source/runtime Node 24 and the native GC/header gate passed. A transient same-signature sync outage now restores feed availability after recovery without reprojection. No production or phone access.

Root `pnpm lint`, preparation/lifecycle/restore/recovery/UI/teardown suites remain required. Debug APK: `pnpm prebuild --platform android --no-install`, then CPU-capped, no-daemon Gradle `assembleDebug -PreactNativeArchitectures=arm64-v8a`, with `ANDROID_HOME` and `EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS=1`. Verify `.debug` application ID, embedded `assets/index.android.bundle` (`debuggableVariants=[]`) and ARM64 `libcrsqlite.so`. **No phone/ADB or production tests/deploys.**
