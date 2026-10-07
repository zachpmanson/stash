# Stash

## CR-SQLite integration work in progress

The production app remains local-only by default. Android development builds expose
Settings actions to seed a CR-SQLite mirror and manually connect to a matching Stash
sync server; the sync client is opt-in, checks the server schema before sending data,
and waits for an authenticated two-way sync-version barrier before projecting remote
state into app tables. Basic-auth credentials remain in memory and are not saved.
Do not point this at the existing Naboo `notes` service or run replica seeding against
an irreplaceable database. CR-SQLite is packaged on Android only; iOS hides the sync
developer actions and continues local-only even when opening a database with replica
tables. Migration, local writes, and incoming replication share an in-process write
gate. Projection is refused unless the sync driver marks a complete exchange, and the
marker is consumed after projection to prevent partial snapshots deleting local rows.
The Stash-schema server and populated-backup/device integration still require validation;
production sync remains disabled.

Android CR-SQLite libraries are pinned to v0.16.3. Recreate them with
`nix develop --command ./scripts/prepare-crsqlite-android.sh`; arm64 is fetched
with a checksum and x86_64 is built from the pinned source package. The Expo
config plugin packages both ABIs in the Android APK. The local sync schema is
implemented in `src/db/syncReplica.ts` and mirrored for review in
`spikes/crsqlite-expo/schemas/stash-sync-v1.sql`.

An app for stashing photos, articles and links for later.

Features:

- Quick sharing from share menu
- Share links, images, or text
- Reader mode for article links
- Article text-to-speech with local and network language models
- Runs entirely locally