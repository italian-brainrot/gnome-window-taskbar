#!/usr/bin/env bash
# Reload the fork's code into the running GNOME Shell (needs scripts/dev-setup.sh
# once, plus one session restart to make the shell scan the dev loader).
#
#   scripts/hotreload.sh          # code + stylesheet reload
#   scripts/hotreload.sh --prefs  # also restart the prefs service process
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

DEV_UUID=windowtaskbar-dev@local
BUILD=build/dev
CURRENT=$BUILD/current

HOST_EXEC() {
    if command -v distrobox-host-exec >/dev/null 2>&1; then
        distrobox-host-exec "$@"
    else
        "$@"
    fi
}

HOST_HOME=${HOST_HOME:-$(distrobox-host-exec sh -c 'getent passwd "$(id -un)"' | cut -d: -f6)}
SHIM_DIR="$HOST_HOME/.local/share/gnome-shell/extensions/$DEV_UUID"

if [[ ! -f $SHIM_DIR/extension.js ]]; then
    echo "no dev loader installed in $SHIM_DIR - run scripts/dev-setup.sh first" >&2
    exit 1
fi

previous=$(cat "$CURRENT" 2>/dev/null || echo 0)
iter=$((previous + 1))

mkdir -p "$BUILD"
rm -rf "$BUILD/iter$iter"
cp -a src "$BUILD/iter$iter"
python3 dev/rename_classes.py "$BUILD/iter$iter" "$iter" >/dev/null
HOST_EXEC glib-compile-schemas --strict "$PWD/$BUILD/iter$iter/schemas"
echo "$iter" >"$CURRENT"

# The loader's own directory keeps what the shell/daemon reads directly: the
# stylesheet (loaded per extension dir) and the prefs (loaded by the service).
cp src/stylesheet.css "$SHIM_DIR/"
cp src/prefs.js "$SHIM_DIR/"
rm -rf "$SHIM_DIR/settings" "$SHIM_DIR/schemas"
cp -r src/settings src/schemas "$SHIM_DIR/"
HOST_EXEC glib-compile-schemas --strict "$SHIM_DIR/schemas"

HOST_EXEC gnome-extensions disable "$DEV_UUID" >/dev/null 2>&1 || true
if ! HOST_EXEC gnome-extensions enable "$DEV_UUID"; then
    echo "could not enable $DEV_UUID: the shell only scans extension directories" >&2
    echo "at session start - log out and back in once (after dev-setup.sh)." >&2
    exit 1
fi

if [[ ${1:-} == --prefs ]]; then
    # The prefs service is D-Bus activated: killing it drops its module cache,
    # the next 'Preferences' request starts it again with the new prefs code.
    HOST_EXEC pkill -TERM -f 'gjs -m /usr/share/gnome-shell/org.gnome.Shell.Extensions' || true
fi

# prune by iteration number, not mtime: 'cp -a' preserves the source directory's
# timestamps, so a freshly copied iteration does not sort as the newest one
ls -1 "$BUILD" | grep -E '^iter[0-9]+$' | sort -V | head -n -3 | sed "s#^#$BUILD/#" | xargs -r rm -rf

echo "reloaded iter$iter"
