# Mobile saved sync login

Eligible Android development or explicitly opted-in builds remember a login **only after** the existing authenticated health/schema check and client setup succeed. Root startup tries that saved account once; opening Settings is not required. Preparation is still explicit. Startup does not seed a replica, change DB ownership/schema identity, bypass recovery, or enable sync in ordinary release/iOS builds.

## Trust boundaries

- `expo-secure-store` (SDK 55 compatible `~55.0.18`) encrypts Android preferences with Android Keystore keys; there is no AsyncStorage, SQLite, plaintext file, export or logging fallback. Secrets necessarily exist briefly in JS/native memory and the authenticated network session. Hardware backing depends on the device. Compromised/unlocked devices are outside this guarantee.
- One versioned secure record binds normalized server URL, trimmed username and password. HTTPS is required outside the existing localhost exception. Embedded URL credentials are rejected; query/fragment are discarded. Passwords never enter observable saved-login/client status.
- Network/feed authentication and teardown remain owned by `syncClient`. Saved-login operations are serialized; signout/account replacement invalidates pending results immediately and cancels/drains the client. A queued secure write must finish before forgetting, so late reads/writes/setup cannot restore an old account.
- Authentication rejection (HTTP 401/403) stops transport/status polling and forgets the rejected login. No timer retries a saved account after startup failure. During an established session, existing transient network recovery remains available; initial offline failures keep the saved identity and offer **Retry saved login** / **Forget saved login**.
- Failed explicit login is never saved. Replacing an account first removes its old saved copy; an erase failure blocks replacement. If a verified session cannot be saved, it remains usable for this session but the UI says persistence is unconfirmed. Read/erase errors never claim the login was forgotten; retry Forget before closing the app, since an unerased record could reconnect on restart. Successful signout requires both secure removal and drained client teardown. A teardown failure still requires restart.

## Native storage and restore limitations

The `expo-secure-store` config plugin must run on prebuild, and the native app must be rebuilt; an old APK has no SecureStore native module. Its Android backup and data-extraction resources exclude `SecureStore` preferences from cloud backup and device transfer. Keep these exclusions if adding custom Android backup rules. App ZIP/database backups contain no saved login, so restoring/moving a backup requires separate sign-in. Android uninstall removes its Keystore keys; an app-data reset/reinstall or lost key can require signing in again. Debug `.debug` and release apps have separate app sandboxes/keys. No credential migration from another app ID is attempted.

The adapter uses `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, no biometric authentication requirement (startup must not prompt), and a dedicated keychain service. iOS sync remains gated off; if later enabled, Keychain can survive reinstall, unlike Android, and this accessibility class disallows device migration. Secure deletion cannot be promised when the OS storage call fails or the process is killed before signout finishes.

## Validation and builds

Use pnpm inside Nix (`bash -c`, not a login shell that resets PATH):

```sh
nix develop --command pnpm install --frozen-lockfile
(cd spikes/crsqlite-expo/server && nix develop --command pnpm install --frozen-lockfile)
nix develop --command node --test scripts/test-*.cjs scripts/test-*.mjs
nix develop --command pnpm lint
(cd spikes/crsqlite-expo/server && nix develop --command bash -c 'pnpm build && pnpm typecheck && pnpm test')
(cd spikes/crsqlite-expo/app && nix develop ../../.. --command bash -c 'pnpm install --frozen-lockfile && pnpm typecheck && pnpm test')
```

Focused login coverage: `scripts/test-saved-sync-login.cjs`, plus the actual Settings/saved-owner tests in `test-recovery-ui.cjs` and actual native-client/saved-owner tests in `test-db-lifecycle.cjs`. Tests use synthetic accounts and controlled native/network boundaries, not real accounts or a phone.

For the final **self-contained ARM64 debug** artifact (parent owns build/delivery):

```sh
# Prepare pinned libraries if not already present in this checkout:
nix develop --command ./scripts/prepare-crsqlite-android.sh
nix develop --command bash -c 'NODE_ENV=production EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS=1 pnpm exec expo prebuild --platform android --no-install'
NODE_ENV=production EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS=1 \
  /home/beltino/beltino/scripts/build-capped.sh "$PWD" -- assembleDebug -PreactNativeArchitectures=arm64-v8a
```

The existing debug plugin retains `applicationIdSuffix ".debug"`, **Stash (debug)**, and `debuggableVariants = []` (JS embedded, no Metro). `ANDROID_HOME` must point to the existing SDK; use existing `.env` build throttles with the capped runner. Artifact: `android/app/build/outputs/apk/debug/app-debug.apk`. No install/deploy/ADB command is part of this task. Release build commands and the release sync opt-in gate are unchanged; do not enable sync for an ordinary release build accidentally.
