#!/usr/bin/env bash
# Take the dev harness out of the session again: disable the loader extension and
# remove its directory, so the shell is never asked to load another taskbar instance
# behind your back. The harness itself (dev/, scripts/dev-setup.sh) stays in the
# repository and can be set up again with scripts/dev-setup.sh + one restart; the
# iteration builds under build/dev/ are dropped, because those instances are gone.
#
# The loader extension reloads taskbar instances into a *live* session, and a broken
# teardown or a bad size request takes the shell down with it - that is worth more
# care than a hot reload ever was, so it is fine to have this script run it away.
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

HOST_HOME=$(HOST_EXEC sh -c 'getent passwd "$(id -un)"' | cut -d: -f6)

EXT_ROOT="$HOST_HOME/.local/share/gnome-shell/extensions"

HOST_EXEC gnome-extensions disable "$DEV_UUID" || true
sleep 1
rm -rf "$EXT_ROOT/$DEV_UUID"

# Directories the harness left lying around in the same place: the shell lists
# extension directories at session start and never stops listing them, so a stray
# 'scan test' directory sits in 'gnome-extensions list' for good (and might be
# loaded one day). The patterns are dev names only - the uuid that ships ends in
# '.github.io', so nothing in here can touch the extension being installed.
for uuid in *-dev@local* *@local.dev; do
    [[ -d $EXT_ROOT/$uuid ]] || continue
    echo "removing leftover dev extension directory: $EXT_ROOT/$uuid"
    HOST_EXEC gnome-extensions disable "$uuid" >/dev/null 2>&1 || true
    rm -rf "$EXT_ROOT/$uuid"
done

# The harness state in the working tree belongs to the iterations that went with
# the old loader: 'current' points at an iteration whose instance left the
# session with it, and 'FAILED' says the last round ended on a crashing build.
# Without this, the next dev-setup.sh starts from an iteration that already broke.
rm -rf build/dev
echo "build/dev (iteration builds, dumps and the current/FAILED pointers) is gone"

echo "removed $EXT_ROOT/$DEV_UUID"
echo "the harness is back in the repo (scripts/dev-setup.sh) if it is needed again"
HOST_EXEC gnome-extensions list --enabled -q | sed 's/^/enabled: /'
