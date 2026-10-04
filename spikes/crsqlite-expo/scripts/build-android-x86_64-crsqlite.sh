#!/usr/bin/env bash
set -euo pipefail

VERSION=0.16.3
SHA256=e16e462763ebe38c30a466e53b979dc2464de1e2ebc0e2255c04266ca232a012
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

URL="https://registry.npmjs.org/@vlcn.io/crsqlite/-/crsqlite-${VERSION}.tgz"
curl --fail --location --silent --show-error "$URL" --output "$TMP/crsqlite.tgz"
printf '%s  %s\n' "$SHA256" "$TMP/crsqlite.tgz" | sha256sum --check --status || {
  echo "CR-SQLite npm source checksum mismatch" >&2
  exit 1
}
mkdir -p "$TMP/source"
tar -xzf "$TMP/crsqlite.tgz" --strip-components=1 -C "$TMP/source"

export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$HOME/android-sdk/ndk/27.1.12297006}"
if [[ ! -x "$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/x86_64-linux-android21-clang" ]]; then
  echo "Android NDK not found at $ANDROID_NDK_HOME (set ANDROID_NDK_HOME)" >&2
  exit 1
fi
export CRSQLITE_NATIVE_DEST="$ROOT/native/x86_64/libcrsqlite.so"
cd "$TMP/source"
nix shell nixpkgs#rustup nixpkgs#cargo-ndk nixpkgs#gnumake nixpkgs#gcc nixpkgs#llvmPackages.libclang.lib --command bash -c '
  set -euo pipefail
  export RUSTUP_TOOLCHAIN=nightly-2023-10-05
  rustup toolchain install nightly-2023-10-05 --component rust-src
  rustup target add x86_64-linux-android --toolchain nightly-2023-10-05
  export LIBCLANG_PATH="$(nix eval --raw nixpkgs#llvmPackages.libclang.lib.outPath)/lib"
  export ANDROID_TARGET=x86_64-linux-android
  make SHARED_CFLAGS="-Wl,-z,max-page-size=16384" loadable
  install -D -m 0644 dist/crsqlite.so "$CRSQLITE_NATIVE_DEST"
'
echo "Built CR-SQLite ${VERSION} Android x86_64 binary at $CRSQLITE_NATIVE_DEST"
