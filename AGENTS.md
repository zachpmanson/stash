# stash — Agent Context

## Project Overview
React Native/Expo app for stashing photos, links and articles for later. Offline-first with local SQLite.

## Build & Deploy

### Devshell
```bash
cd ~/projects/stash && direnv allow   # first time
cd ~/projects/stash && direnv exec . <command>  # run in devshell
```
Provides: `node`, `pnpm`, `java` (JDK 17), `gradle`, `adb`

### Build & Install
```bash
cd ~/projects/stash && direnv exec . make deploy
```
This runs `pnpm prebuild && cd android && ./gradlew assembleRelease` then `adb install -r`.

### Debug builds are SELF-CONTAINED
Debug APKs must embed the JS bundle — no Metro dependency. Set in `android/app/build.gradle`:
```gradle
react {
  debuggableVariants = []
}
```
This forces bundling for the debug variant; without it the debug app tries to fetch its JS from Metro at runtime and fails with `Unable to load script` over wireless ADB (reverse tunnel + Metro entry-path issues). `android/` is gitignored, so this setting must be re-applied by the `debug-variant` config plugin after every `expo prebuild` (see `plugins/debug-variant/index.js`).

### Wireless Debugging
```bash
adb connect <ip>:<port>     # connect to phone
cd ~/projects/stash && direnv exec . make deploy
```

## Database Schema Migrations

**`CREATE TABLE IF NOT EXISTS` does NOT alter existing tables.** When adding columns to the schema, you must add a matching `ALTER TABLE` migration. This was the root cause of folders disappearing (the `icon` column was added to `CREATE TABLE` but missing from existing DBs).

Pattern to follow (see `src/db/database.ts`):
```typescript
const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(<table>)");
if (!cols.some((c) => c.name === "<column>")) {
  await db.execAsync("ALTER TABLE <table> ADD COLUMN <column> <type>");
}
```

## Session History (2026-07-20)

### Bug 1: Folders not loading
- `WHERE f.archived_at IS NULL` was after `GROUP BY f.id` in `src/db/folders.ts` → SQL syntax error → `getFolders()` threw → store never updated → "No folders yet"
- **Fix:** Moved WHERE before GROUP BY

### Bug 2: Missing icon column migration
- Initial schema had no `icon` column on `folders`. Schema was updated to include `icon TEXT NOT NULL` but no `ALTER TABLE` migration existed for existing databases.
- **Fix:** Added migration in `database.ts` using `PRAGMA table_info(folders)` pattern

### Bug 3: `article_text` nulled on article save
- `updateItemArticleHtml` set `article_text = NULL` when saving HTML. ItemCard and ListenScreen read from DB field which was always NULL.
- **Fix:** Made `updateItemArticleHtml` accept optional `text` param, pass `htmlToText(html)` at all call sites