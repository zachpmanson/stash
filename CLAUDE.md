# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm start              # Start dev server (requires dev client installed on device)
pnpm android            # Build and run on Android emulator/device
pnpm prebuild           # Regenerate native android/ and ios/ dirs from app.json config
pnpm lint               # Type-check with tsc --noEmit
pnpm build:android      # Release build (expo prebuild + react-native run-android --mode=release)
```

Always use `pnpm`, not `npm` or `yarn`.

There are no automated tests.

## Architecture

Stash is a React Native/Expo app for saving shared content (URLs, images, text, files) into folders. The core user flow is: receive a share intent from another app → pick folders → save to local SQLite DB.

### Navigation (Expo Router)

File-based routing under [app/](app/). [app/_layout.tsx](app/_layout.tsx) is the root with `ThemeProvider`, `ShareIntentProvider`, and `SafeAreaProvider`. [app/+native-intent.ts](app/+native-intent.ts) intercepts OS-level share intents (iOS `stash://dataUrl=...`, Android `content://` URIs) and redirects them to the `/share` route.

Routes: `/` (folder grid), `/share` (share sheet), `/archive`, `/folder/[id]`, `/item/[id]`, `/move-item/[id]`, `/edit-folder/[id]`.

### Data Layer (`src/db/`)

SQLite via `expo-sqlite`. Three tables: `folders`, `items`, `item_folders` (junction). Item types: `image`, `url`, `text`, `file`. Soft deletes via `archived_at` timestamp (NULL = active). A default "Inbox" folder is created on first run. WAL mode and foreign keys are enabled.

- [src/db/database.ts](src/db/database.ts) — connection, schema init
- [src/db/folders.ts](src/db/folders.ts) — folder CRUD + archive
- [src/db/items.ts](src/db/items.ts) — item CRUD + archive + folder associations

### Share Intent Flow

When a user shares content from another app:
1. `+native-intent.ts` maps the OS intent to the `/share` route
2. `ShareScreen` receives the intent via `useShareIntentContext()` (expo-share-intent)
3. `src/utils/shareHandler.ts` processes the payload — copies files to `Documents/stash/`, fetches Open Graph previews for URLs
4. User selects folders in `FolderSelector`, then saves via `items.ts`

### State Management

It uses zustand for state management.

### Path Alias

`@/*` maps to `./src/*` (configured in [tsconfig.json](tsconfig.json)).

### Native Config

`expo-share-intent` plugin in [app.json](app.json) registers intent filters for `text/*`, `image/*`, `video/*`, and `*/*`. Changing share intent config or adding plugins requires running `pnpm prebuild` to regenerate native code.
