# Private phone ↔ web images

Implements the private image scope of [zpm/beltino#143](https://github.com/zachpmanson/beltino/issues/143), related to [zpm/stash#26](https://github.com/zachpmanson/stash/issues/26). No share links, tokens, anonymous media, new hostname, browser replica, S3 or second database.

## Policy

- **JPEG, PNG and single-frame WebP only.** Actual format, full raster decoding, page count, dimensions and pixels are checked, not the filename or caller MIME. Maximum original **20 MiB**, **24,000,000 pixels**, **12,000 pixels per edge**. GIF/animation, HEIC/HEIF, AVIF, SVG, HTML, video and generic files are unsupported. Android reports unsupported originals rather than pretending they transferred; existing originals remain available locally. Converting an original is an explicit separate import, not a silent transport operation.
- Original bytes are immutable and server-hashed with SHA-256. EXIF/orientation and original encoding are retained in the original. V1 derivatives auto-orient, flatten transparency onto white and encode JPEG quality 80: reader preview at most 1600×1600, thumbnail at most 384×384, never enlarged. Derivative hashes are distinct identities; they do not replace original identity.
- Two concurrent receivers maximum, 30-second receive deadline, isolated decoder process with 10-second kill deadline, one libvips thread, disabled libvips cache, 64 MiB V8 heap cap and decoded-pixel bounds. Native/external allocations are **not** covered by V8's heap limit: the reviewed Stash Nix service additionally bounds the entire process family to 1 GiB (768 MiB high-water pressure). Synthetic two-worker maximum-policy RGBA tests exercise the budget; this is not an OOM-proof guarantee for every corrupt codec input.
- All responses are authenticated and item-scoped, `Cache-Control: private, no-store`, and `nosniff`. GETs also reject foreign Origin/cross-site Fetch Metadata. Binary writes require `application/octet-stream`, `X-Stash-Request: 1` and `X-Stash-Content-SHA256`; native Basic auth works without browser Origin headers. Present Origin must exactly match the trusted public scheme/host/port. No CORS permission. JSON API limits/CSRF middleware remain intact; finalization has its own 4 KiB JSON bound. CSP changes only `img-src 'none'` → `'self'`; no blob/data/external images.
- Caddy remains the **password verifier**, overwriting `X-Auth-User` and forwarded scheme, preserving Host. Node accepts only the configured exact stamped tenant and remains loopback-only. A correctly forged stamp on direct loopback is not an external authentication proof. Do not expose Node or alter this proxy boundary.

## Storage and protocol

`sync_items.media_id = item.id` remains unchanged, including ordinary Android mirror writes. No CR-SQLite content schema/version/clock migration is introduced. Two ordinary, server-local tables in the same metadata DB hold manifests and idempotent browser creation state:

```
sync_items.id/media_id
    → stash_media_v1(original_sha, preview_sha, thumbnail_sha, dimensions, MIME, size)
    → DATA_DIR/media/sha256/<first-two-hex>/<full-SHA256>
stash_media_uploads_v1(upload_id, finalized, final_request, created_at)
```

Files are streamed to private temporary names, bounded and hashed, decoded in a separate process, fsynced and atomically linked into CAS without overwriting existing objects. Ancestor/shard directory entries are fsynced too. Only then does a synchronous `FULL` SQLite transaction publish the manifest. Reopened upstream DB handles default to `NORMAL`, so media acquisitions reassert `FULL`. A failed DB commit can leave complete unreferenced blobs, never a completed manifest pointing at an unfinished upload. Same ID/different bytes returns **409**; same bytes deduplicate and retries are idempotent. Reads verify the file's hash before streaming. Missing/damaged bytes produce an error, not a false success.

| Route under `/api/media` | Meaning |
| --- | --- |
| `GET /items/:id/status` | Existing supported image: `pending` or verified-upload descriptor (`sha256`, `bytes`, MIME/dimensions) |
| `PUT /items/:id/original` | Native backfill; metadata must exist before and after receipt; never creates/resurrects an item |
| `GET /items/:id/original` | Immutable original, header `X-Stash-Content-SHA256` |
| `GET /items/:id/preview` / `thumbnail` | Bounded JPEG derivative, independent digest header |
| `PUT /uploads/:uuid` | Browser staging under a stable random creation UUID; no visible item yet |
| `POST /uploads/:uuid/finalize` | `{title?, folderId?}`; transaction creates image, optional initial folder relationship and finalized marker after durable bytes |

Finalize retries with identical fields return the same item. Changed retry fields conflict. A deleted finalized item returns **410** rather than being recreated; a stale native upload rechecks live identity and fails. Archive is not deletion. The UUID/hash is not an access token; there is no digest lookup route or filesystem directory exposure. Web DTOs contain only authenticated same-origin item URLs, never local paths, raw HTML or credentials. Existing clients remain metadata-compatible and ignore server-local tables.

## Android

The separately durable device-local `stash_media_queue_v1` is keyed by normalized account + item ID; it contains direction, local source path, attempts, retry deadline and sanitized status, **never credentials**. `stash_media_local_v1` contains verified local download mappings only. These are not replicated.

After the full metadata/recovery exchange, one serial byte transfer runs per cycle. Existing local images are discovered without reimport/ID changes; remote images wait normally for bytes. Network failures/404s use bounded exponential backoff, unsupported/conflicting/oversize images require explicit retry, and Settings → Sync shows pending/retrying/error counts plus **Retry image transfers**. Metadata completion is labelled separately from image completion. Reconnect rechecks completed local originals, allowing backfill after backend restore; exact bytes deduplicate. This may retransmit originals after reconnect rather than trusting stale server availability.

Upload reads at most 20 MiB into a byte view and hashes **those same bytes** before sending. A File/Blob body is deliberately not used: Expo SDK55 overrides its Content-Type with `File.type`, which breaks the dedicated octet-stream route. Tests invoke the installed Expo normalization helper to guard this behavior.

Downloads stream to an attempt-owned partial file, check declared size/MIME and both descriptor/response digest, compute SHA-256, then move to `document/stash/synced-<sha>.image`. Only a live matching metadata row can receive its verified mapping. The normal completed-exchange projection publishes local paths; no remote filesystem path is trusted. Restart retries may download again, but cannot project incomplete bytes. Disconnect/restore aborts and drains transfers before DB replacement or account changes. The existing recovery read-only barrier, login gate, SecureStore exclusions and source-compiled persistence patch remain in force.

Downloaded originals share the existing **stash** file tree so native ZIP backups retain them. Fresh restore converts verified mappings into device-local restore resources, retargets copied paths into a new namespace, retains current originals/rollback and resumes only after metadata recovery. Byte jobs are rediscovered rather than restoring another session's credentials or trusting old completion state.

## Web

New item → Image supports file picker, drop and paste; shows upload progress/validation state and retryable errors. Save retries retain the same selected File and UUID until the editor is dismissed. Finalization and initial filing are atomic; a lost finalization response does not create a duplicate. Dismissing/reloading a draft loses its selected File/UUID; this is not an offline browser upload queue. Grid loads thumbnails only, reader loads the bounded preview (not full originals), and failed reader images offer Retry. Existing editor baseline/dirty-field, selection/history/modal and busy navigation safeguards remain; image title/archive/folder writes never replace original bytes.

## Backup, recovery and retention

**Stop the service first.** A DB-only snapshot is insufficient once manifests exist.

```sh
cd spikes/crsqlite-expo/server
nix develop --command pnpm db backup /private/stash-2026-10-23.sqlite
# Keep BOTH files/directories together:
# /private/stash-2026-10-23.sqlite
# /private/stash-2026-10-23.sqlite.media/
nix develop --command pnpm db restore /private/stash-2026-10-23.sqlite
```

Backup refuses an existing destination, snapshots/validates the DB, copies and verifies its referenced originals **and derivatives**, fsyncs, publishes the sidecar first and final DB filename last. A partial/published-only sidecar is evidence, not a complete backup: retain it and choose a new destination rather than blindly deleting it. Legacy DBs with no manifests remain readable. V1 intentionally preserves derivatives too; a regeneration CLI is not yet provided, so do not discard them from these snapshots.

Restore verifies the selected DB and blobs before replacing anything. It copies immutable objects first, retains damaged ordinary objects under private `media/retained-corrupt/` before publishing verified replacements, and creates a **full DB+media** timestamped rollback. It checkpoints the stopped old DB into DELETE journal mode, fsyncs it and removes now-redundant WAL/SHM **before** atomically replacing it. Thus interruption before replace retains complete old state; interruption after replace cannot replay old WAL over the selected snapshot. Keep the service stopped until recovery verification completes. Corrupt snapshot bytes, symlinks, missing files or disk/fsync failures fail closed. A failed repair may leave quarantined objects/partial recovery evidence; verify/retry the independently retained snapshot before startup rather than deleting evidence.

Naboo's service-owned stopped-state `preStart` checkpoint already copies all `data/` and `schemas/`; its updated validation additionally verifies each media manifest's referenced original/derivative hashes and original size before `COMPLETE.json`. This must be tested and deployed together with the server. The DynamicUser/private-state boundary is unchanged; agents do not read/copy live personal content to verify it. See the Nix `hosts/naboo/services/stash-crsqlite-sync.md` runbook for actual privileged recovery constraints.

An old binary can ignore these additive ordinary tables but cannot provide image transport. **Do not use old DB-only backup/restore tooling after images are introduced.** Preserve media directories and updated recovery/checkpoint tooling on a code rollback. Reusing a synchronized DB snapshot's identity/cursors is a separate coordinated recovery concern, not solved by changing binaries.

**No destructive GC in v1.** Complete orphan/staged/conflicting uploads, crash partials, deleted-item originals, quarantined bytes, native originals and retained backups remain on disk. Archive never frees storage. Reconnect retransmission deduplicates identical bytes but not recompressed photos. Monitor disk capacity; local checkpoints multiply storage and are not off-host backups. A future GC policy needs explicit age/grace windows covering offline devices, staged uploads, concurrent transfers and retained snapshots; no distributed reference counter is assumed.

## Disposable validation and artifacts

Use the project devshells and synthetic fixtures only:

```sh
nix develop --command pnpm install --frozen-lockfile
nix develop --command pnpm lint
nix develop ./spikes/crsqlite-expo/server --command node --test scripts/test-*.cjs scripts/test-*.mjs
(cd spikes/crsqlite-expo/server && nix develop --command bash -c 'pnpm install --frozen-lockfile && pnpm typecheck && pnpm build && pnpm test')
(cd spikes/crsqlite-expo/app && nix develop ../../.. --command bash -c 'pnpm typecheck && pnpm test')
(cd spikes/crsqlite-expo/server && nix develop --command bash -c 'CADDY_BIN=$(command -v caddy) CHROMIUM_BIN=$(command -v chromium) node test/browser-smoke.mjs')
```

Media tests cover duplicate/conflicting/hash-mismatched/interrupted uploads, native metadata-first/delete races, auth/CSRF/traversal/active/oversize/huge-decoded inputs, fsync/manifest/disk failure, receiver limits and decoder kill, read verification, full DB+blob restore/repair/rollback, old WAL replay fault boundaries, actual durable native queue restart/retry/read-only/account cancellation, real CR-SQLite replica phone→web→other-phone transfers and real Caddy/Chromium pick/drop/paste/display/lost-response retry. No physical phone or owner-browser acceptance is inferred.

Self-contained ARM64 debug APK, **no installation/ADB**:

```sh
nix develop --command bash -c 'export NODE_ENV=production EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS=1; pnpm exec expo prebuild --platform android --no-install; /home/beltino/beltino/scripts/build-capped.sh "$PWD" -- --no-daemon assembleDebug -PreactNativeArchitectures=arm64-v8a'
```

The capped runner takes the **project root**, not `android/`. Verify `.debug` app ID/signature, embedded JS, ARM64 `libcrsqlite.so`, compiled SecureStore class and patched persistence error string before delivery. Ordinary release sync opt-in remains unchanged.
