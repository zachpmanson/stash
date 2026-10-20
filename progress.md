# Stash sync/restore and deployability progress

_Last updated: 2026-10-20 (Melbourne time), actual-app recovery implementation checkpoint_

## Scope and approval
Work is in the **actual Stash app** (`src/db`, backup/restore and Settings), not only the isolated pilot. Testing uses separate debug packages and disposable authenticated loopback services. Production app/data, production sync and Naboo deployment are not authorized.

Zach selected **merge restored backup history with current server data**, not server replacement. Restored synced data may be browsed but stays read-only until its first full merge completes; ordinary offline editing resumes afterward. Restore still explicitly replaces this device's local app view; unrelated current-device histories are not silently unioned, and private rollback preserves them.

Draft [zpm/stash#58](https://github.com/zachpmanson/stash/pull/58) targets `backend`; rollout/media sync remain gated under [zpm/stash#26](https://github.com/zachpmanson/stash/issues/26).

## Prior verified native evidence
- Two same-process Disconnect → offline-write → reconnect cycles converged on Pixel 8; later deletion propagation and backup creation were observed.
- A fresh self-contained ARM64 debug APK and opt-in sync-tools bundle built and ran without Metro. Only `com.zachmanson.stash.debug` was used.
- The resumed native old-backup test reproduced a real defect: backup at replica version 3; a subsequent upload advanced server-seen to 4; picker restore rewound the same identity to 3; reconnect reported synced, but a new version-4 item stayed local while the server retained a different pre-restore item. Counts matched despite divergent contents. This was **failed convergence**, not native acceptance.
- Native restore mechanics completed (165 items,8 folders), and the backup contained CR-SQLite state. Whether local-only replica preparation suffices for a seeded demo still needs separate validation.

## Implemented safety work
### Database, sync and media ownership
- Existing pushed `dada2ca`, `9251651`, `b7977ae` serialize DB ownership, drain/cancel sync setup and active work, finalize CR-SQLite before close, and suppress stale transport/startup/retry callbacks.
- Media saves now stage privately before slow EXIF/permission/location/network work, validate replacement generation, and promote media plus transactionally save under one ownership window. Existing/restored bytes are never overwritten or deleted by rejected saves. This bounded slice independently passed review; 25 persisted real-source media regressions were added.

### Actual fresh-replica restore
- `restoreBackup()` constructs a genuinely fresh SQLite file. Supported seeded snapshots replay all nine public CR-SQLite change columns, including tombstones, original clocks/origins and membership-generation IDs; no cloned active identity, raw clock tables or old peer cursors.
- Source integrity, exact supported schema/seed/configuration and genuine fresh destination are validated before replacement. Unsupported/partial history fails closed. Local-only restores remain local and do not implicitly merge missing-history legacy data into a populated server.
- A persistent recovery marker blocks mutations/Prepare/mirroring until compatible, complete two-way exchange and successful projection. Relationship repairs must themselves upload before pending clears. Committed setting metadata and pending consumption are transactional.
- Private `stash-rollback-<id>` retains the old DB/unsynced history and media. Backup media goes into fresh namespaces using validated relative paths; device resources remain available without merging unrelated account histories. Native file copies avoid whole-media JS buffers.
- Persistent `stash-restore-install.json` blocks ordinary startup after an interrupted installation. Pre-close preparation failure leaves the old DB usable; unsafe post-close failure stays fail-closed for private rollback recovery.
- Shared Android development/explicit-build opt-in gates seeded recovery before sync shutdown/replacement. A pending bit cannot authorize production Connect. Settings is scrollable and uses truthful read-only/recovery messages. UI mutation handlers consume/display expected rejection errors.
- Startup hydrates AsyncStorage before applying authoritative committed SQLite recipe-setting metadata; later offline changes update that metadata transactionally.

### Backend safeguards
- Read-only persistent schema identity/version and resident-DDL preflight occurs before upstream factory/migration or schema-file overwrite.
- Malformed payloads terminate only their socket. Failed first DB factory acquisition is evicted without poisoning later peers; constructor failures close SQLite handles. Patch source/dist and dependency integrity are maintained.
- Authenticated status advertises the small recovery capability and actual `merge-equal-values` setting. No SQL schema/hash or wire protocol redesign.
- Independent backend review passed checkout19/parity1 and17 tests against the exact cache-fix package `/nix/store/yj1v4h5zr9w5znbcx9136zcjyam309yb-stash-crsqlite-sync-0.1.0`. That package predates the later status-capability source addition; it is not the final deployment artifact.

## Current validation and review
- Latest implementation validation: **102 root tests**, **10 pinned native SQLite/actual app-server adapter merge tests**, **19 server tests**, **1 schema parity test**, root/server TypeScript and diff checks pass.
- Durable tests execute actual backup/builder/lifecycle/media/UI handlers and real pinned host SQLite. They cover the original v3/serverSeen4 defect, two fresh identities/new uploads, both exchange orders, origin filtering, same-ID conflicts, tombstones/repair upload, pending/restarts, release/platform rejection without data/session changes, rollback/install failures and settings hydration races.
- Expo filesystem/ZIP/transport and Android UI boundaries are controlled host test seams. These are **not** Android picker/extension/change-notification/WebSocket acceptance.
- Independent core-merge correctness review found no source blockers. Filesystem/UX review requested the build-boundary, UI error, durable-setting, Settings reachability and native-copy fixes described above; those are implemented and their final independent review also found no remaining scoped blockers (focused43/typecheck independently rerun).
- Parent independently reran root102 and native10 successfully. In the additional concurrent server rerun, two source-preflight subprocesses exceeded their 5-second startup/exit deadlines under host/build load. The managed test group was stopped and its test children cleaned; this is not a final passing server rerun. Retry isolated/serial after the APK build; do not count shutdown assertions interrupted by group cleanup as independent service failures.
- A pre-fix embedded-JS ARM64 build passed; a fresh build including the review fixes is running. No reviewed-recovery APK has yet been installed or accepted natively.

## Operational state
- Earlier disposable backend/proxy stopped; debug app disconnected/force-stopped; owned reverse/download ZIP removed. Fox subsequently released the Pixel. Check current coordination-room ownership and claim before native use.
- Isolated app/cache, private rollback/test data and host diagnostic artifacts remain; cleanup is not complete. Never publish data-bearing backups/SQLite/screenshots blindly.
- Native acceptance plan: `/tmp/stash-falco-native-acceptance-plan.md`; current private old ZIP `/tmp/stash-falco-native-backup.zip` and DB inspections preserve the failure fixture.
- Source/review reports: `/tmp/stash-falco-app-restore-merge-implementation.md`, `/tmp/stash-falco-recovery-review-fixes.md`, `/tmp/stash-falco-restore-correctness-review.md`, `/tmp/stash-falco-restore-filesystem-review.md`, `/tmp/stash-falco-backend-final-review.md`, `/tmp/stash-falco-media-independent-review.md`.

## Remaining gates
1. Commit/push the independently reviewed coherent source/tests checkpoint, including new test files. Finish fresh APK build and isolated/serial server rerun after host/build contention; do not claim the interrupted parent server run passed.
2. Coordinate Pixel ownership and run the fresh embedded-JS APK against disposable authenticated Caddy/backend. Exercise old backup → post-backup server write → picker restore → readonly rejection → reconnect → new write, comparing exact contents/site IDs/cursors/media, not only counts/status. Include server delete and another isolated install importing the same backup where feasible.
3. Record actual native evidence, stop owned services/remove reverse/download copies/release Pixel, refresh issue/PR/checkpoint and complete deliberate private test cleanup.
4. Production gates remain: Nix input still pins incompatible pilot `752b6d4`; validate an explicitly selected compatible package/host runtime, operational backups/retention/recovery, code-plus-data rollback/migration and monitoring. No deployment/pin update or production enablement without approval. Network media sync remains unimplemented.
