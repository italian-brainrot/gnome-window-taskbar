#!/usr/bin/env bash
# Install the extension into the user's GNOME Shell extensions directory and
# (re)load it. Runs the gnome-extensions CLI on the host, because the shell
# session bus lives there.
#
# Usage: scripts/install.sh [disable|enable|prefs]   (default: enable)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ACTION=${1:-enable}
UUID=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' src/metadata.json | head -1)

# The container's $HOME is the distrobox home, but the shell session runs with
# the real user home; ask the host which one it uses.
HOST_HOME=${HOST_HOME:-}
if [[ -z $HOST_HOME ]]; then
    HOST_HOME=$(distrobox-host-exec sh -c 'getent passwd "$(id -un)"' | cut -d: -f6)
fi
EXT_DIR="$HOST_HOME/.local/share/gnome-shell/extensions/$UUID"

HOST_EXEC() {
    if command -v distrobox-host-exec >/dev/null 2>&1; then
        distrobox-host-exec "$@"
    else
        "$@"
    fi
}

bash scripts/build.sh
rm -rf "$EXT_DIR"
mkdir -p "$EXT_DIR"
cp -a "dist/$UUID/." "$EXT_DIR/"
chmod -R u+rwX,go+rX "$EXT_DIR"
echo "installed to $EXT_DIR"

case "$ACTION" in
    disable)
        HOST_EXEC gnome-extensions disable "$UUID"
        ;;
    prefs)
        HOST_EXEC gnome-extensions prefs "$UUID"
        ;;
    reload|enable)
        # Enabling a fresh copy is enough for the shell to pick it up; 'enable'
        # is also how we reload after an install (disable + enable).
        HOST_EXEC gnome-extensions disable "$UUID" || true
        HOST_EXEC gnome-extensions enable "$UUID"
        ;;
esac

HOST_EXEC gnome-extensions show "$UUID"  || true
