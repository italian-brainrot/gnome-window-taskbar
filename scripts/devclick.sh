#!/usr/bin/env bash
# Drive a window button from the dev probe (no mouse events in a Wayland session).
#   scripts/devclick.sh <title substring> [action] [menu item]
#     action: click | activate | menu   (menu reports what opened, and presses
#     the item named third, e.g. 'New Window' - a real click cannot be injected,
#     so this is how the menu and its items are checked)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p build/dev
title=${1:?title substring}
action=${2:-click}
item=${3:-}
before=$(stat -c %Y build/dev/click.json 2>/dev/null || echo 0)
json() { python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1"; }
[[ -n $item ]] && item=$(json "$item") || item=null
printf '{"title": %s, "action": %s, "item": %s}' "$(json "$title")" "$(json "$action")" \
    "$item" > build/dev/click.request
for _ in {1..40}; do
    now=$(stat -c %Y build/dev/click.json 2>/dev/null || echo 0)
    ((now > before)) && { cat build/dev/click.json; exit 0; }
    sleep 0.25
done
echo "no answer (is the dev loader enabled?); check journal for 'click failed'" >&2
exit 1
