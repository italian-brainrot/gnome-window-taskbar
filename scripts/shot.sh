#!/usr/bin/env bash
# Take a screenshot of the running shell session, autonomously.
#
# The D-Bus screenshot service refuses a container client (its sender check
# allowlists gsd-media-keys and the portal implementation), and xdotool over
# XWayland only reaches X clients, not mutter's keybindings. So the dev harness
# does it from inside the shell itself: dev/probe.js watches build/dev/shot.request
# and calls Shell.Screenshot.composite_to_stream, which is the same capture path
# the shell's own screenshot UI uses. Nothing lands in ~/Pictures and no
# permission prompt is involved.
#
#   scripts/shot.sh          # -> build/shot.png
#
# Needs the dev loader extension enabled (scripts/hotreload.sh does that).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DEV=build/dev
request=$DEV/shot.request
result=$DEV/shot.png

mkdir -p "$DEV"
before=$(stat -c %Y "$result" 2>/dev/null || echo 0)

touch "$request"
for _ in {1..60}; do
    now=$(stat -c %Y "$result" 2>/dev/null || echo 0)
    if ((now > before)); then
        cp "$result" build/shot.png
        echo "shot: $(date -d @"$now" '+%H:%M:%S') -> build/shot.png"
        exit 0
    fi
    sleep 0.25
done

echo "no screenshot; is the dev loader enabled? try: scripts/hotreload.sh" >&2
exit 1
