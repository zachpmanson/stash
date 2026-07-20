# stash — Agent Context

## Project Overview
React Native/Expo app for stashing photos, links and articles for later. Offline-first with local SQLite.

## Build & Deploy

### Devshell
```bash
cd /home/beltino/beltino/stash && direnv allow   # first time
direnv exec . <command>                           # run in devshell
```
Provides: `node`, `pnpm`, `java` (JDK 17), `gradle`, `adb`

### Build & Install
```bash
direnv exec . make deploy    # builds + installs + launches on connected device
```
This runs `pnpm prebuild && cd android && ./gradlew assembleRelease` then `adb install -r`.

### Wireless Debugging
```bash
adb connect <ip>:<port>     # connect to phone
make deploy                 # auto-detects device and deploys
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

## SQL Gotchas

- **`WHERE` must come BEFORE `GROUP BY`**, not after. SQLite throws a syntax error on `... GROUP BY f.id WHERE ...` which causes the query to silently fail (store never updates, UI appears empty).
- Subqueries in SELECT are cleaner than LEFT JOIN + GROUP BY for aggregate counts.

## Read Time Estimates

- `estimateReadLabel(text)` in `src/utils/speech.ts` — counts words, estimates at 150 WPM
- Used in `ItemCard` (reads from DB `article_text`) and `ItemDetailScreen` (reads from in-memory `articleState.text`)
- **Must persist `article_text` alongside `article_html`** when saving articles to DB — otherwise the card-level estimate is always `NULL`
- Only shows for `text` type items (uses `uri`) and `url` type items (uses `article_text`)

## Session History (2026-07-20)

### Bug 1: Folders not loading
- `WHERE f.archived_at IS NULL` was after `GROUP BY f.id` in `src/db/folders.ts` → SQL syntax error → `getFolders()` threw → store never updated → "No folders yet"
- **Fix:** Moved WHERE before GROUP BY

### Bug 2: Missing icon column migration
- Initial schema had no `icon` column on `folders`. Schema was updated to include `icon TEXT NOT NULL` but no `ALTER TABLE` migration existed for existing databases.
- **Fix:** Added migration in `database.ts` using `PRAGMA table_info(folders)` pattern

### Bug 3: Read time not showing on item cards
- `updateItemArticleHtml` set `article_text = NULL` when saving HTML. ItemDetailScreen used in-memory text (worked), ItemCard used DB field (always NULL).
- **Fix:** Made `updateItemArticleHtml` accept optional `text` param, pass `htmlToText(html)` at all call sites
