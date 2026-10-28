#!/usr/bin/env bash
# One-off setup of the development loader extension (windowtaskbar-dev@local).
#
# The loader is a real extension whose extension.js only imports the code from
# the project's build directory, which makes code reloads possible without a
# session restart (GNOME Shell scans extension directories only at session
# start, so the *loader* itself has to be picked up by one restart).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

DEV_UUID=windowtaskbar-dev@local

HOST_EXEC() {
    if command -v distrobox-host-exec >/dev/null 2>&1; then
        distrobox-host-exec "$@"
    else
        "$@"
    fi
}

HOST_HOME=${HOST_HOME:-$(distrobox-host-exec sh -c 'getent passwd "$(id -un)"' | cut -d: -f6)}
SHIM_DIR="$HOST_HOME/.local/share/gnome-shell/extensions/$DEV_UUID"

rm -rf "$SHIM_DIR"
mkdir -p "$SHIM_DIR"
cp dev/loader.js "$SHIM_DIR/extension.js"
cp dev/metadata.json "$SHIM_DIR/metadata.json"

# prefs are loaded by the org.gnome.Shell.Extensions service process, whose
# module cache dies with it (it is D-Bus activated), so a prefs change only
# needs: systemctl --user kill the service, then re-open the prefs
cp src/prefs.js "$SHIM_DIR/"
cp -r src/settings src/stylesheet.css src/schemas "$SHIM_DIR/"
distrobox-host-exec glib-compile-schemas --strict "$SHIM_DIR/schemas"

bash scripts/hotreload.sh || true

echo
echo "The dev loader is installed in $SHIM_DIR."
echo "GNOME Shell has to scan it: log out and back in once, then run"
echo "scripts/hotreload.sh again - every reload after that needs no restart."
