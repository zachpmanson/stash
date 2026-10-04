#!/usr/bin/env bash
set -euo pipefail

VERSION=0.16.3
SHA256=2f95b26cc749ca83640672166405fdcd74d9ef4659071ba53ba3041b68ca8572
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/native/arm64-v8a"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

URL="https://github.com/vlcn-io/cr-sqlite/releases/download/v${VERSION}/crsqlite-aarch64-linux-android.zip"
curl --fail --location --silent --show-error "$URL" --output "$TMP/crsqlite.zip"
printf '%s  %s\n' "$SHA256" "$TMP/crsqlite.zip" | sha256sum --check --status || {
  echo "CR-SQLite Android release checksum mismatch" >&2
  exit 1
}
if command -v unzip >/dev/null 2>&1; then
  unzip -q "$TMP/crsqlite.zip" -d "$TMP/unpacked"
else
  nix shell nixpkgs#unzip --command unzip -q "$TMP/crsqlite.zip" -d "$TMP/unpacked"
fi
install -D "$TMP/unpacked/crsqlite.so" "$DEST/libcrsqlite.so"
echo "Installed CR-SQLite ${VERSION} Android arm64 binary at $DEST/libcrsqlite.so"
