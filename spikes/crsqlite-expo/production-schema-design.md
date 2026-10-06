# Stash production sync schema — design in progress

**Status:** isolated design candidate, not production integration. No production database or app schema has been changed. The disposable server still contains only its candidate `notes` schema. The exact candidate DDL is `schemas/stash-sync-v1.sql`; it is not loaded by the Expo app or Naboo service. This work records the design gate for [zpm/stash#26](https://github.com/zachpmanson/stash/issues/26).

## Evidence reviewed

- Production schema and migrations: `src/db/database.ts`.
- Persistence APIs: `src/db/items.ts`, `src/db/folders.ts`, `src/db/textSubstitutions.ts`.
- File storage and backup/restore: `src/utils/fileUtils.ts`, `src/utils/backup.ts`.
- ID creation: `src/utils/shareHandler.ts`, `src/screens/HomeScreen.tsx`, `src/components/FolderSelector.tsx`, `src/utils/randomId.ts`.
- Non-SQLite state: `src/state/settingsState.ts`, `src/state/voiceState.ts`, `src/state/recipeCheckState.ts`, `src/state/listenSession.ts`.
- CR-SQLite feasibility and race probes: `/tmp/stash-crsqlite-vertical-slice/README.md`, `test_candidate_schema.py`, and `test_membership_generation_race.py`. These are disposable host tests, not production migration tests.

A user-provided backup ZIP is available at `/tmp/stash-backup-1791287621534-967632.zip`. I inspected its manifest/file list and extracted only `stash.db` to `/tmp/wolf-stash-backup-inspect/` (mode 0600); all migration experiments used a separate copy. The original DB was opened read-only. The archive contains personal data/media and must not be committed or copied to a public share. No Android device/ADB is available, so on-device validation remains outstanding.

## Backup audit (aggregate-only)

The supplied archive's manifest matches its database: 8 folders and 163 items. The copied database passes `PRAGMA integrity_check`; `foreign_key_check` returns no violations. It contains 8 folders, 163 items (42 image, 111 URL, 10 text; no file rows), 164 item-folder relations, and 9 text substitutions. There are 110 archived items and 1 archived folder. No required/primary-key values are null, no duplicate primary IDs or duplicate membership pairs were found, and all membership references resolve. The one saved coordinate pair is present. All existing item IDs are numeric timestamp-like values; 7/8 folder IDs are numeric timestamp-like values (the other is the fixed Inbox ID). No ID collisions exist in this snapshot, but new writes across devices remain at risk until ID generation changes. All 163 items have at least one folder membership; observed membership cardinality is 1–2 folders per item. Layout, case-sensitivity, listening-progress and coordinate-range checks pass for this snapshot.

The ZIP includes all 42 image files referenced by image rows. It also has three URL-item thumbnail paths under cache that are not included in the archive; these are cached previews, not source content, and current schema has no portable thumbnail source URL. That is another reason not to sync `thumbnail_path` as a portable value.

A scratch migration probe ran against a separate copy of the real database, leaving the original schema/tables intact. It applied the exact candidate DDL in `schemas/stash-sync-v1.sql` (no FKs/CHECKs; explicit non-null PKs/defaults), omitted `last_used_at` and local cache paths, represented local image assets with `media_id = item.id`, and retained portable URL/text values. All five candidate tables enabled as CRRs; row counts matched the source for folders/items/memberships/substitutions (8/163/164/9), and all copied user-data columns matched exactly in SQL set comparisons. SQLite integrity remained `ok`, and the seed produced 3,021 CR-SQLite changes. A second independently migrated copy received the whole snapshot; independent field edits converged; an item deletion plus link deletes beat a stale offline title edit; replaying the stale seed/edit did not resurrect it; and online backup/restore preserved convergence. A real-snapshot folder-removal vs unseen new-membership race also converged under the approved policy: the link survived, app reconciliation revived the folder, and replay did not undo repair. The AU setting could not be imported from this ZIP because it lives in AsyncStorage, not the database/backup; the app must seed it from local settings during first pairing.

A separate scalar-conflict probe showed independent field edits merge, and same-field concurrent edits converge/replay deterministically. For same-base simultaneous edits under the pinned default resolver, `title='zeta'` beat `'alpha'` (value ordering); progress 60 beat 30 (numeric value ordering); and archived timestamp 200 beat `NULL` (non-NULL sorts above NULL). This is not wall-clock last-write-wins. The CR-SQLite source compares causal/column versions first, then compares values to break equal-version ties. That means a simultaneous archive vs unarchive currently favors archived, while concurrent text edits can select the lexically greater text. Zach approved the deterministic default behavior; document it and preserve regression coverage.

## Scope decisions received from Zach

- Sync saved item GPS coordinates (`lat`, `lng`).
- Sync the Australian-recipe preference (`auRecipe`).
- Permanent item/folder deletion propagates across devices.
- Recipe ingredient checkmarks are not required as cross-device persisted state. Keep them out of the sync schema; retain the app's existing local behavior unless a separate product change is requested.
- Existing decision: when a concurrent active membership points at a tombstoned folder, keep the folder alive (reconciliation policy).
- Bootstrap decision: first pairing seeds an empty server; later devices merge; confirmed non-empty-server bootstrap must fail closed rather than replace server data.
- Membership decision: accepted observed-remove/add-wins semantics; concurrent unseen adds survive removals, and active generation rows project to one logical link.

## Current data inventory

| Data | Current location | Proposed scope | Notes |
|---|---|---|---|
| Folder name, icon, creation time, archive state, layout | `folders` | Sync | User organization state. |
| Folder last-used time | `folders.last_used_at` | Device-local | Updated during navigation; avoid replication churn. Keep the local column or equivalent local state. |
| Item URL/text and descriptive/article/recipe fields | `items` | Sync | Includes `type`, canonical URL or text content, title/description/favicon, article text/HTML, recipe JSON, created/archive state and listened progress. Confirm migration representation against copied data. |
| Item/folder IDs | `items.id`, `folders.id` | Sync, with generator hardening before multi-device writes | New item/folder IDs currently use `String(Date.now())` (`shareHandler.ts`, `HomeScreen.tsx`, `FolderSelector.tsx`). Different devices can create records in the same millisecond and collide. Preserve existing IDs, but switch new shared entities to collision-resistant UUIDs before enabling sync; check copied data for duplicate IDs. |
| Item coordinates | `items.lat/lng` | Sync | Explicitly approved. These are user data and potentially sensitive; protect under the same authenticated single-tenant boundary as other item content. |
| Image/file bytes and local paths | `items.uri`, `thumbnail_path`, `<document>/stash/` | Metadata/reference in sync; bytes are a later phase | Current absolute paths are installation-specific. Never replicate them as if portable. Introduce stable media IDs and a device-local path/cache mapping before any cross-device media feature. |
| Folder membership | `item_folders` | Sync | Relationship needs replicated tombstones/generations and integrity reconciliation; no enforced FK on CRR table. |
| Text substitutions | `text_substitutions` | Sync | User-level TTS customization. |
| Australian recipe preference | AsyncStorage `settings-state` | Sync | Move/bridge the single preference into syncable settings state; keep compatibility with existing local setting. |
| Voice selections | AsyncStorage `voice-state` | Device-local | Voice availability/IDs vary by platform/device; already excluded by plan. |
| Recipe checkmarks | AsyncStorage `recipe-check-state` | Device-local, not server-synced | Zach says cross-device persistence is unnecessary. |
| Active/last listen session | Zustand in-memory `listenSession` | Device-local/transient | Not currently persisted. |

## CR-SQLite constraints and proposed representation

The existing production tables are not directly CRR-eligible as written:

1. `id TEXT PRIMARY KEY` is nullable in SQLite rowid tables unless explicitly `NOT NULL`; CR-SQLite requires non-null primary keys.
2. `item_folders` declares foreign keys (and production enables FK enforcement). CR-SQLite cannot maintain ordinary checked FKs safely across row-level replication.
3. Required non-key columns without defaults prevent CRR schema setup. CRR data validation must therefore remain in the app; SQL `CHECK` constraints on replicated tables should not be relied upon.
4. A normal SQLite `DELETE` against a CRR table is represented through CR-SQLite's change/tombstone machinery, unlike current local-only tables. A private two-peer probe confirmed a delete propagated over an offline stale edit, replayed delete/edit batches did not resurrect the row, and a backup-restored peer rejected the stale edit. This covers one isolated row, not all delete/relationship cases or tombstone garbage collection/peer-retention behavior.

Candidate replicated tables should use explicit `NOT NULL` primary keys, defaults for required columns, nullable optional columns, no FKs/CHECKs, and an app-level integrity checker. The spike's minimal candidate schema demonstrates eligibility and convergence but is not yet a full Stash schema. A separate scratch-only full-table smoke schema (folders, items, generation-keyed memberships, text substitutions, AU setting) also enabled all tables as CRRs and exchanged a representative 28-change seed on SQLite 3.51.2 / CR-SQLite 0.16.3. This proves basic eligibility/exchange only, not migration, all conflict cases, or mobile behavior.

Proposed logical changes:

- Use CR-SQLite physical row deletion for items, substitutions, and individual membership generations; the real-snapshot host test confirms item plus memberships delete over a stale edit and replay. Folders are special: the agreed concurrent-link policy preserves/revives a folder, so folder removal uses a logical `deleted` marker plus deletion of currently observed memberships, followed by reconciliation that revives the folder if an active membership arrives. Do not assume delete garbage-collection is safe until CR-SQLite peer tracking/retention is understood.
- Represent membership instances with a stable `membership_id` primary key rather than the current `(item_id, folder_id)` composite identity. Removing a membership tombstones that instance; re-adding creates a new instance. This avoids toggling one row's delete bit and was exercised in the disposable generation-race probe.
- Run reconciliation after remote batches and local relationship changes: active membership requires live item and folder; per Zach's policy, an active membership revives a tombstoned folder. Also detect missing/deleted items and duplicate active generations. The current host probe validates only one remove/re-add interleaving and folder resurrection; broaden it before adoption.
- Map `archived_at IS NULL` to an explicit stable archived/unarchived representation in the CRR schema. Preserve a timestamp if needed by UI; avoid introducing a CHECK constraint. Same-field conflicts use the accepted CR-SQLite defaults; retain the tested archive-wins tie behavior.
- Keep device-local cache paths outside replicated rows. A future media table should refer to portable opaque `media_id` values; local path/cache rows map `(item_id, media_id, role)` to the current installation's filesystem location.
- Add syncable settings state for `auRecipe`; do not include voice IDs, local listening session state, or recipe ingredient checks.

## Migration strategy to test (not approved/implemented)

1. Harden generation of new item/folder IDs to UUIDs while preserving existing IDs and relationship references. Build a deterministic migration against a copy of a real `stash.db` and its backup ZIP. Record row counts, table/index definitions, null distributions, duplicate IDs, item type distribution, folder memberships, local URI forms, and orphan/integrity findings before changing anything.
2. Prefer a staged upgrade with an untouched rollback copy and an explicit schema version. Rebuild or populate CRR-eligible tables transactionally; add CR-SQLite metadata only after the migrated schema passes validation. Preserve the current app tables/data until round-trip and rollback tests pass.
3. Seed the replica from existing local rows without changing user-visible IDs. Preserve archived rows and relationship timestamps. Keep app-level validation for item types, layouts, emoji, settings, coordinate ranges, and valid relationship targets.
4. For URLs/text, retain portable URL/text content. For local image/file URIs and cached thumbnails, do not upload or replicate absolute paths. Preserve local path mapping; add stable media identity/upload separately.
5. Validate no data loss on migration, backup/restore, restart, and rollback. Exercise two offline clients editing the same fields; create/archive/unarchive/permanently delete; link removal/re-add; folder delete versus link create; stale replay; old backup rejoin; malformed rows; and app/server schema-version mismatch.
6. Keep production sync disabled until the full gate and an explicit rollout/restore plan pass. The already-tested Naboo service is still disposable and uses a different `notes` schema.

## Remaining decisions and validation

- **Accepted field-conflict rule:** Zach approved CR-SQLite's deterministic defaults for scalar same-field conflicts. They are not wall-clock LWW: column versions/causal length are compared, then equal-version concurrent values use SQLite value ordering (e.g. `zeta` beats `alpha`, 60 beats 30, non-NULL archive timestamp beats NULL). Deletion remained deleted in the tested stale-edit race. Keep these examples in sync docs/tests so the behavior is explicit.
- **Accepted membership add/remove rule:** Zach approved observed-remove/add-wins semantics. Generation-tagged memberships allow remove/re-add; concurrent duplicate adds converge to multiple active tags, so app projections must de-duplicate `(item_id, folder_id)`. Removing all tags currently observed on a device clears those; a concurrent unseen add survives. The actual-snapshot folder-delete/link-create test exercised this rule plus folder revival and stale replay.
- Folder deletion versus concurrent active membership is governed by the accepted keep-folder-alive policy, but final folder deletion representation and any content-purge expectation still need validation. A private synthetic test confirmed an offline item delete beat a stale concurrent edit; replay and backup restore did not resurrect it. Test folder and relationship races, peer tracking/garbage collection, old device backups and restore behavior before deciding a purge horizon. No retention duration is assumed.
- The supplied backup enabled aggregate-only host migration/exchange tests; no Android device/ADB is available. Device packaging/runtime, app DB conversion, backup restore, auth/server integration, and rollout remain unverified.
