#!/usr/bin/env bash
# Build a loadable extension directory into dist/<uuid>.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

UUID=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' src/metadata.json | head -1)
OUT="dist/$UUID"

# The settings schema must be compiled, otherwise neither the shell nor the
# Extensions app can read the extension's keys. Prefer the host's compiler:
# it is the same glib the shell runs on.
if command -v distrobox-host-exec >/dev/null 2>&1 \
        && distrobox-host-exec command -v glib-compile-schemas >/dev/null 2>&1; then
    distrobox-host-exec glib-compile-schemas --strict "$PWD/src/schemas"
else
    glib-compile-schemas --strict src/schemas
fi

rm -rf "$OUT"
mkdir -p "$OUT"
cp -a src/. "$OUT/"

echo "built $OUT (uuid: $UUID)"
