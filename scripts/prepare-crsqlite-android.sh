#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPIKE="$ROOT/spikes/crsqlite-expo/app"
DEST="$ROOT/native-libs/crsqlite"

# Reuse the feasibility spike's checksummed upstream arm64 download and pinned
# source build for x86_64; the Expo config plugin packages both under jniLibs.
"$SPIKE/scripts/prepare-android-crsqlite.sh"
"$SPIKE/scripts/build-android-x86_64-crsqlite.sh"
install -D -m 0644 "$SPIKE/native/arm64-v8a/libcrsqlite.so" "$DEST/arm64-v8a/libcrsqlite.so"
install -D -m 0644 "$SPIKE/native/x86_64/libcrsqlite.so" "$DEST/x86_64/libcrsqlite.so"
echo "Prepared CR-SQLite Android libraries in $DEST"
