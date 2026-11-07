# Stash

## CR-SQLite integration work in progress

All Android builds, including releases, expose **Settings → Sync** without a build flag.
The app remains local-first: preparation and sign-in are explicit, and the sync client
checks the server schema before sending data and waits for an authenticated two-way
sync-version barrier before projecting remote
state into app tables. Verified logins are saved in platform secure storage and reconnect
once at startup on Android; offline failures retain the login for explicit retry.
Established sessions show their account/status and Sign out instead of login inputs.
Sign out forgets saved credentials and waits for session teardown. See
[mobile saved-login security, recovery and build notes](docs/mobile-sync-login.md). Do not point this at an incompatible notes-only pilot
or run replica seeding against an irreplaceable database. CR-SQLite is packaged on Android only; iOS and web hide the sync
actions and remain local-only even when opening a database with replica
tables. Migration, local writes, and incoming replication share an in-process write
gate. Projection is refused unless the sync driver marks a complete exchange, and the
marker is consumed after projection to prevent partial snapshots deleting local rows.
Two-install native backup/merge acceptance passed. With Zach's approval, Naboo now
serves the matching authenticated backend; the owner reported successful debug-app
connection and initial sync. See `progress.md` for historical evidence and limitations.
Android release sync is now available by default; see [private images](docs/private-images.md)
for supported-image transport.

Private folder Atom feeds are a **review candidate, not deployed**: Every active folder automatically has a private authenticated feed after sync; Edit Folder → Feed provides read-only status, clean URL copy and XML preview. The existing authenticated backend hosts feeds after sync; Caddy still owns Basic authentication. See [folder feed configuration, recovery and validation](docs/folder-feeds.md). All Android builds expose sync; preparation, authentication and recovery barriers remain unchanged.

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
- Local-first, with experimental opt-in sync