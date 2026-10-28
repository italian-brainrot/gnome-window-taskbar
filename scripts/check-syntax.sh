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

status=0
for f in src/*.js src/settings/*.js dev/*.js; do
    [[ -f $f ]] || continue
    out=$(HOST_EXEC env GI_TYPELIB_PATH=/usr/lib64/mutter-18 gjs -m "$PWD/$f" 2>&1 || true)
    if grep -q "SyntaxError" <<<"$out"; then
        echo "$f: $(grep -m1 'SyntaxError' <<<"$out")"
        status=1
    fi
done

if [[ $status -eq 0 ]]; then
    echo "syntax ok (gjs)"
fi
exit $status
