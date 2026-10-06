# Stash

## CR-SQLite integration work in progress

The production app currently remains local-only. A development-only Settings action
can seed an isolated CR-SQLite mirror of the existing local SQLite data; it does
not connect to a server or change the app's ordinary read/write path. Do not enable
production sync or run the seed against an irreplaceable database. CR-SQLite is
currently packaged on Android only; iOS hides the sync developer actions and
continues local-only even when opening a database that contains replica tables.
Migration and local writes share an in-process write gate. Applying replica data back to app
tables is additionally refused unless a sync driver invalidates the projection
gate before receiving changes and marks a complete exchange only after all batches
land; that marker is consumed after projection to prevent partial snapshots
deleting local-only rows.

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