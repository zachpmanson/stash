# Stash sync/restore and deployability progress

_Last updated: 2026-10-20 (Melbourne time), resumed review/native test checkpoint_

## Goal and boundaries
Validate experimental Android CR-SQLite backup/restore/reconnect using only an isolated debug app and disposable backend. Assess backend readiness without deploying or enabling production sync. Production rollout and media sync remain gated under [zpm/stash#26](https://github.com/zachpmanson/stash/issues/26).

## Committed implementation
Branch `falco/stash-reconnect` is pushed through `b7977ae`:
- `dada2ca`: serialize Android sync database reads.
- `9251651`: coordinate sync shutdown with backup restore.
- `b7977ae`: serialize DB ownership across reads/writes, backup staging and replacement; finalize CR-SQLite before close; fail closed on unsafe replacement/cleanup; cancel/drain sync setup and active work; suppress stale WebSocket callbacks, startup, outbound retries and transport reopen after teardown.
- The sync provider reuses the prepared DB/site ID rather than opening again inside `createSyncedDB()`.
- Draft [zpm/stash#58](https://github.com/zachpmanson/stash/pull/58) targets `backend`. It is not production-readiness clearance.

## Verified evidence
### Earlier disposable native runs (not the latest attempt)
- Two same-process Disconnect → offline-write → reconnect cycles converged on Pixel 8.
- App deletion propagated to the disposable server.
- A server-written item reached the app and was backed up. File-picker restore → reconnect was not completed.

### Latest build/device attempt, morning of 2026-10-20
- Fresh ARM64 debug build passed after prebuild; an opt-in sync-tools rebundle/build also passed and was installed as `com.zachmanson.stash.debug`.
- Debug JavaScript is embedded with `debuggableVariants = []`; experimental sync controls appeared without Metro. Previous generated-package/build failures are historical, not current blockers.
- Disposable backend bound `127.0.0.1:18787`, behind Caddy Basic authentication on port `18788`. Authenticated health passed; unauthenticated health returned HTTP 401. Only the proxy was forwarded via ADB reverse. Test endpoints were enabled only on this disposable backend.
- Latest UI attempt did **not** connect: coordinate-based input appended credentials to the URL, leaving the intended credential fields empty and sync stopped. No new convergence or restore evidence resulted.
- Production app/data and production sync were untouched.

### Resumed local checks, evening of 2026-10-20
- `nix develop --command sh -c 'node --test scripts/test-db-lifecycle.cjs && node --test scripts/test-ws-teardown.cjs && pnpm lint && git diff --check'` passed (`stash-resumed-lifecycle-checks`, exit 0).
- 18 mocked DB/sync lifecycle tests and 14 WebSocket teardown tests passed, plus TypeScript and diff checks. These do not establish native restore safety.

### Resumed native backup → picker restore → reconnect: failed convergence
- Slippy released the Pixel; Stash explicitly claimed it. Keyboard obscured fields while accessibility still reported their underlying bounds. Verified keyboard focus with Tab navigation and field-by-field checks; disposable authentication and initial convergence succeeded.
- Created a native backup while synced, exported it privately for inspection, and selected that exact ZIP through Android's system file picker. Restore reported **165 items across 8 folders** and disconnected sync as designed.
- Backup integrity was `ok`; it contained CR-SQLite site ID `995070e3723a4107a40469e5ab612488`, DB version **3**, seed marker **1** and CRR state. This demonstrates that this post-sync native backup retains replica identity/history; it does not prove server sync is required to produce them. Local-only preparation remains a separate untested path.
- Before restore, saved a disposable text probe and verified upload: server watermark advanced to **4**, with **166 items**. Restoring the older backup rewound that same site ID to version **3** and removed the probe locally.
- Reconnected in the same app process: UI reported **“Stash data is in sync.”** Then saved a different post-restore probe. UI still reported synced, but the server retained only the pre-restore probe; the new probe existed only locally. Server watermark stayed **4**. Inspection of a stopped-app DB/WAL copy confirmed the same site ID, local version **4**, 166 items, and only the post-restore probe. SQLite integrity remained `ok`.
- **Conclusion:** native restore mechanics ran, but restore/reconnect is unsafe: rewound identity/version history can produce false convergence and skipped uploads. This is a reproduced blocker, not a passing round trip.
- Private evidence: `/tmp/stash-falco-native-backup-inspect/`, `/tmp/stash-falco-restored-before-reconnect.sqlite`, `/tmp/stash-falco-post-restore-inspect/`, and `/tmp/stash-falco-restore-false-sync.{png,xml}`. Do not publish the data-bearing artifacts.

## Independent review findings
- Lifecycle review reproduced seeded-backup identity/version rollback false success in a mock; the native test above confirms the practical divergence. Zach explicitly chose **merge restored data with current server state**, not replacement. Design a fresh-replica recovery path; do not merely reset watermarks.
- Lifecycle review also reproduced an in-flight media save surviving restore and inserting a URI whose copied file was deleted. Replacement ownership does not yet span media preparation/save.
- Backend audit: configured Nix input still pins incompatible notes-spike revision `752b6d4`; authenticated malformed payload can crash the process; upstream automatic schema migration precedes the service's version validation and can destructively change data before checking.
- Backend TypeScript, 3 isolated server tests and schema-parity test passed; those tests did not cover the reproduced malformed-frame/migration defects. Operational backup, rollback/convergence and monitoring remain unvalidated.
- Review artifacts: `/tmp/stash-falco-lifecycle-resumed.md`, `/tmp/stash-falco-backend-readiness-resumed.md`.

## Current state and cleanup
- Native convergence blocker reported to Zach; he approved merge-with-current-server recovery. Backend crash/schema safeguards are the next implementation slice, with no Nix pin change or deployment.
- Debug app disconnected then force-stopped. Both disposable services stopped; own ADB reverse and downloaded test ZIP removed. Pixel explicitly released in the coordination room. Production Stash and Emissions untouched.
- Isolated app/cache and private host test data/evidence remain for diagnosis; cleanup is not complete.

## Remaining gates
1. Fix backend malformed-frame containment and reject unexpected persistent schema before upstream migration; add isolated regressions and independently review fixes. Keep exact-package/Nix pin review separate from deployment.
2. Implement the approved merge policy via a supported fresh-replica recovery/reconciliation strategy and persisted identity/version rollback regressions. A simple watermark reset is insufficient.
3. Fix in-flight media-save versus restore race and preserve a deferred-permission/file-existence regression test.
4. Repeat native backup → old-snapshot restore → reconnect → new write with directly observed app/server convergence after the fix; include media and cross-install identity behavior.
5. Finish seeded-demo/local-only preparation validation and operational backup, schema migration, code-plus-data rollback and monitoring prerequisites.
6. Refresh issue/PR evidence and finish disposable cleanup. No production deployment without approval.
