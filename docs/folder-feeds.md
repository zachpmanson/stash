# Private folder Atom feeds (review candidate)

Implements the explicit owner always-on policy in [zpm/stash#68](https://github.com/zachpmanson/stash/issues/68), superseding the earlier opt-in and restore-disable publication policy. **Not deployed by this change.** Every existing, new, restored or unarchived active logical folder automatically has a **private authenticated** Atom feed when backend hosting is configured. No public access, new listener, auth exception or sync-build opt-in change is introduced.

## Operator configuration — future owner-approved deployment only

The **existing** Hono/Node HTTP + raw WS service generates Atom on its existing port/database. No new listener, database, content schema/version or public exception. All paths, including feeds, **must remain behind existing Caddy Basic authentication**. Caddy alone validates passwords, overwrites `X-Auth-User`, preserves public Host and overwrites forwarded scheme. Do not expose the loopback origin or change the existing WS Origin protections. There is no Hono Basic checker, secret URL, token, signing key, JWT or reader-specific account.

Set **`FEED_BASE_URL=https://stash.zachmanson.com`** in the service environment *when* the owner approves deployment. It must be an explicit credential-free HTTPS **origin** (optional trailing slash, no path/query/fragment); invalid values fail startup, absent configuration leaves feed operations unavailable (503). Host/forwarding headers never construct feed links. The existing Caddy catch-all should require no feed exception. This document does not authorize editing/activating the host configuration.

Reader credentials are account-wide: provide the existing login only to a trusted reader/aggregator **at the component actually fetching** the feed. Copy only the clean HTTPS URL, never embed credentials in it. Archiving a folder blocks subsequent fetches; unarchiving restores availability at the same URL/IDs. Reader caches cannot be recalled. There is no per-folder enable/disable control.

## Android

Edit Folder → **Feed** is read-only status, clean URL copy and plaintext XML preview/refresh. Local folders become available after syncing to the backend; opening or saving a folder needs no publication command. Settings → Sync retains its existing Android development/explicit-opt-in, preparation and recovery barriers. Only a live authenticated session after a complete initial exchange can read feeds. Sign out cancels/drains requests, clears identity/confirmation and blocks late results. Network credentials remain private to the active session, never public status, logs, URLs or WebViews. Verified mobile logins are remembered only in platform secure storage; see [mobile saved login](mobile-sync-login.md).

The page shows Pending until backend confirmation; failures/unprepared/offline/recovery/unsupported states are Unavailable, not optimistic availability. It requires the explicit `policy:"always-on"` capability, so legacy backends cannot falsely promise automatic feeds even when a legacy feed was enabled. Refresh/Retry reads current state. Copy validates the matching folder's credential-free HTTPS URL. Preview displays **plaintext Atom XML in native Text**, not a WebView. Local changes/future eligible additions appear after sync; the phone need not stay online thereafter.

## HTTP contract

Every API/feed request independently requires exact trusted owner identity, before existence or conditional-cache checks. Legacy mutation requests retain existing JSON, CSRF marker/Origin, 64 KiB body and unknown-field/type validation. Errors are generic and contain no SQL/private paths.

- `GET /api/folders/:id/feed`: `{version:1, policy:"always-on", enabled:true, url, backend, limit:50}` for an active logical folder. `enabled` is a compatibility status, never a saved publication gate.
- `PUT /api/folders/:id/feed`: **only** `{enabled:boolean}` is accepted for validation, then rejected with **409** and a clear read-only/always-on error (both true and false). No state changes and no false success. Existing auth/CSRF/body/unknown-field/query checks still apply; unconfigured hosting → 503, ineligible/missing folder → 404.
- `GET /api/folders/:id/feed/preview`: read-only Atom; no-store.
- `GET` / `HEAD /feeds/folders/:id.atom`: **Atom 1.0 only**, `application/atom+xml; charset=utf-8`. Missing/ineligible folder → authenticated 404. No `.rss`, query overrides, generic SQL or HTML note viewer.

Feeds use private/no-cache + Vary Authorization, semantic ETags and Last-Modified. If-None-Match (including weak tags) can return 304 **only after auth/configuration/eligibility checks**. Date-only If-Modified-Since is deliberately ignored: second precision must not conceal sub-second edits. Poll no more often than every five minutes in readers; 304 still recomputes a bounded current projection rather than serving stale content. No content/membership/read/listening writes occur on feed reads.

## Content and publication metadata

At most the newest **50 active text/link candidates**, `created_at DESC, id ASC`, in the selected logical folder. Membership generation duplicates collapse via indexed ID selection; orphan rows and other folders cannot leak. Invalid legacy link URLs are omitted, without unbounded backfill. This is **not** full export/backfill. Text uses its title or first line / Untitled note, readable plaintext. Links include only validated credential-free http(s) source URLs, title, description and saved plaintext article. No remote article/image fetch, media/enclosure/device-path fields, raw article HTML, location, voice/settings or listening progress. No automatic public note viewer.

Per entry, limits are 500 title, 8,000 text, 2,000 description, 12,000 article characters (4,096 for source URL); truncated values show `[Truncated]`. XML-invalid characters/lone surrogates are removed, Unicode preserved. Established `feed` Atom metadata serialization is converted structurally to explicit `type=text` nodes using `xml-js`; user content never enters HTML/CDATA serialization, including repeated `]]>` sequences. No regex replacement of user XML.

`folder_feeds` and `feed_entries` are **server-only, non-CRR tables in the same SQLite file**. Stable UUID URNs and the folder URL survive rename/edit/archive/unarchive/restore. Entries retain creation/published time and record server-observed significant exported-content changes using hashes and stable publication dates; they do not invent precise offline edit times from db_version. Polling/unexported fields do not advance them. Folder rename advances feed metadata only. Metadata records are retained to preserve identities when items return to the bounded window; they contain hashes/IDs/times, not extra content copies.

Publication uses the existing logical folder predicate, including add-wins survival: an archived folder is unavailable; a deleted tombstone is unavailable unless surviving item membership keeps the logical folder active. Missing/physically deleted folders are unavailable. Unarchiving or restoring logical membership automatically restores availability. Removed memberships, deleted/archived items disappear from output, not reader caches. The obsolete `enabled` column and its legacy maintenance triggers remain for non-destructive compatibility but have **no effect on publication**; no bulk metadata rewrite or CRDT/schema version bump is needed. Feed/entry IDs, semantic hashes and publication times are retained. GET status does not allocate or rewrite metadata; render/preview allocate it lazily as before.

## Backup/recovery

Private whole-DB snapshots include IDs/hashes/timestamps and obsolete flags. **Stop the service** and use the existing `pnpm db backup …` / `pnpm db restore …` helper. Restore preserves metadata exactly and **active folders immediately resume private authenticated feeds** when the service starts. Restoring no longer clears flags or promises publication-disablement; review the snapshot **before** restarting if restored content is sensitive. Keep the service stopped until recovery review completes. Native backup replay never carries server feed metadata; logical active content follows the same automatic policy after sync.

Do not restore by copying a SQLite file over live state. A raw filesystem copy cannot be distinguished from ordinary restart; no false raw-copy detection is claimed. Existing schema/identity/clock validation, rollback backups, private permissions, CRSQLite finalization, replacement-file journaling, atomic rename and stale-WAL removal remain intact. Ordinary restarts retain identities/dates. Existing private-backup/rollback discipline remains mandatory.

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

The devshell supplies disposable Caddy, Chromium and Python feedparser. Tests use fresh loopback ephemeral ports/temp profiles/synthetic credentials/records; Python actually fetches authenticated Atom through Caddy. Missing/wrong credentials cannot distinguish missing/active feeds or obtain 304. Existing browser cached-Basic cross-origin WS regression remains. Real native replica helpers test HTTP↔WS content, membership and archive behavior; Android tests invoke actual TSX hooks/handlers with controlled native/session boundaries, not a physical-device E2E claim.

Always-on policy tests cover legacy disabled metadata, rejected toggles, new/restored/unarchived active folders, auth-before-304, semantic identity/dates, and actual native read/copy/preview/lifecycle handlers. Tests are synthetic/disposable only; no production or phone access is authorized.

Root `pnpm lint`, preparation/lifecycle/restore/recovery/UI/teardown suites remain required. Debug APK: `pnpm prebuild --platform android --no-install`, then CPU-capped, no-daemon Gradle `assembleDebug -PreactNativeArchitectures=arm64-v8a`, with `ANDROID_HOME` and `EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS=1`. Verify `.debug` application ID, embedded `assets/index.android.bundle` (`debuggableVariants=[]`) and ARM64 `libcrsqlite.so`. **No phone/ADB or production tests/deploys.**
