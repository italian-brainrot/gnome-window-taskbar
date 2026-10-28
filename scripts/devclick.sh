#!/usr/bin/env bash
# Drive a window button from the dev probe (no mouse events in a Wayland session).
#   scripts/devclick.sh <title substring> [action]            # action: click|activate|menu
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p build/dev
title=${1:?title substring}
action=${2:-click}
before=$(stat -c %Y build/dev/click.json 2>/dev/null || echo 0)
printf '{"title": %s, "action": %s}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$title")" \
    "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$action")" > build/dev/click.request
for _ in {1..40}; do
    now=$(stat -c %Y build/dev/click.json 2>/dev/null || echo 0)
    ((now > before)) && { cat build/dev/click.json; exit 0; }
    sleep 0.25
done
echo "no answer (is the dev loader enabled?); check journal for 'click failed'" >&2
exit 1
