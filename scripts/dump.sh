#!/usr/bin/env bash
# Ask the running dev build (windowtaskbar-dev@local) to write its live actor
# tree into build/dev/dump.json, then print it. Needs a loaded dev build
# (scripts/dev-setup.sh + scripts/hotreload.sh).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f build/dev/dump.json ]] && mv build/dev/dump.json build/dev/dump.json.old
touch build/dev/dump.request
for _ in {1..40}; do
    [[ -f build/dev/dump.json ]] && break
    sleep 0.25
done
if [[ ! -f build/dev/dump.json ]]; then
    echo "no dump written: is the dev build loaded? (scripts/hotreload.sh)" >&2
    exit 1
fi
${EDITOR:-cat} build/dev/dump.json
