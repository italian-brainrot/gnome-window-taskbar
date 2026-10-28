#!/usr/bin/env bash
# Take the dev harness out of the session again: disable the loader extension and
# remove its directory, so the shell is never asked to load another taskbar instance
# behind your back. The harness itself (dev/, scripts/dev-setup.sh, build/dev/) stays
# in the repository and can be set up again with scripts/dev-setup.sh + one restart.
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

HOST_EXEC gnome-extensions disable "$DEV_UUID" || true
sleep 1
rm -rf "$HOST_HOME/.local/share/gnome-shell/extensions/$DEV_UUID"

echo "removed $HOST_HOME/.local/share/gnome-shell/extensions/$DEV_UUID"
echo "the harness is back in the repo (scripts/dev-setup.sh) if it is needed again"
HOST_EXEC gnome-extensions list --enabled -q | sed 's/^/enabled: /'
