# Stash sync/restore and deployability progress

_Last updated: 2026-10-20, 20:37 AEDT (Melbourne time)_

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

## Current state
- Work was stopped at Zach's request, then resumed on his explicit instruction.
- The earlier backend review was cancelled without a final readiness verdict. Fresh read-only lifecycle and backend-readiness reviews are now running; their results are pending.
- Disposable backend/Caddy processes were stopped. Temporary data, isolated debug app and ADB reverse mapping were not removed at the stop; check their state before reuse or cleanup.
- Slippy currently owns Pixel `3A111FDJH0062B` for Emissions checks. Stash device work waits for his release in `testing@muc.chat.zachmanson.com`.
- A temporary single-action UI helper has been prepared to select fields from live layout and verify focus/content before proceeding; it has not yet been used on-device.

## Remaining gates
1. Synthesize independent lifecycle review findings and fix/retest any accepted blockers.
2. Coordinate Pixel ownership, repair endpoint/input focus, and establish a verified disposable authenticated connection.
3. Complete native backup → file-picker restore → reconnect on ARM64, checking app/server convergence, local data/files, offline writes, and native DB errors.
4. Verify seeded-demo requirements and whether native backup retains required CR-SQLite metadata after local preparation/server sync. Source exposes local-only replica preparation; a server connection must not be assumed necessary without validation. No validated seeded artifact exists.
5. Finish backend audit: loopback/auth boundary, schema parity, persistence, health/logging, backup/recovery and rollback. Never deploy test endpoints or expose the raw backend port.
6. Refresh issue/PR evidence and clean up disposable services, ADB mapping, data and isolated app when no longer needed. No production deployment without approval.
