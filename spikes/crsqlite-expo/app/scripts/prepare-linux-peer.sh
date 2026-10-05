#!/usr/bin/env bash
set -euo pipefail

VERSION=0.16.3
SHA256=8f6fd31a2be2ba8c3101aad067a504a2e63c8e9b51cc4ace786009c02e7ecbae
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/native/x86_64-linux"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

URL="https://github.com/vlcn-io/cr-sqlite/releases/download/v${VERSION}/crsqlite-linux-x86_64.zip"
curl --fail --location --silent --show-error "$URL" --output "$TMP/crsqlite.zip"
printf '%s  %s\n' "$SHA256" "$TMP/crsqlite.zip" | sha256sum --check --status || {
  echo "CR-SQLite Linux peer release checksum mismatch" >&2
  exit 1
}
if command -v unzip >/dev/null 2>&1; then
  unzip -q "$TMP/crsqlite.zip" -d "$TMP/unpacked"
else
  nix shell nixpkgs#unzip --command unzip -q "$TMP/crsqlite.zip" -d "$TMP/unpacked"
fi
install -D "$TMP/unpacked/crsqlite.so" "$DEST/crsqlite.so"
echo "Installed CR-SQLite ${VERSION} Linux x86_64 binary at $DEST/crsqlite.so"
