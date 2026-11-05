#!/usr/bin/env bash
# Parse-check every source file with the host's GJS: the same JavaScript engine the
# shell runs, so what it says is what the shell will say. node is not enough here - it
# waved through a malformed line inside a comment block ("// ... placed in" followed
# by "the panel) ...") while GJS refused the file and the extension sat in ERROR.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

HOST_EXEC() {
    if command -v distrobox-host-exec >/dev/null 2>&1; then
        distrobox-host-exec "$@"
    else
        "$@"
    fi
}

# The Clutter/Meta/St typelibs of a Fedora-family host live in a versioned
# directory (/usr/lib64/mutter-<n>); ask for it instead of hardcoding a number,
# so the check keeps working across a GNOME update.
MUTTER_DIR=$(HOST_EXEC sh -c 'ls -d /usr/lib64/mutter-* 2>/dev/null | sort -V | tail -1' 2>/dev/null || true)

status=0
for f in src/*.js src/settings/*.js dev/*.js; do
    [[ -f $f ]] || continue
    out=$(HOST_EXEC env GI_TYPELIB_PATH="${MUTTER_DIR:-/usr/lib64/mutter}" gjs -m "$PWD/$f" 2>&1 || true)
    if grep -q "SyntaxError" <<<"$out"; then
        echo "$f: $(grep -m1 'SyntaxError' <<<"$out")"
        status=1
    fi
done

if [[ $status -eq 0 ]]; then
    echo "syntax ok (gjs)"
fi
exit $status
