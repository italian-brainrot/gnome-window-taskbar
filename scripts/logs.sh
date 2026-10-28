#!/usr/bin/env bash
# Follow the GNOME Shell / GJS log stream of the host session.
# Extensions are loaded in-process, so uncaught errors end up here.
set -euo pipefail
distrobox-host-exec journalctl --user -n "${1:-200}" -o short-utc --no-pager \
    | grep -iE "gjs|gnome-shell" | tail -40
