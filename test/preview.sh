#!/bin/sh
# Builds a browser-runnable copy of the UI at test/.preview.html: the real Code.gs
# driven by the in-memory fakes, so the interface can be developed without
# deploying. Nothing here reaches Google.
#
#   sh test/preview.sh          # build, print the path
#   sh test/preview.sh --open   # build and open it in the default browser
set -e
cd "$(dirname "$0")/.."
OUT=test/.preview.html

{
  echo '<!doctype html>'
  echo '<html lang="en"><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  echo '<title>Team Tasks — local preview</title></head><body>'
  echo '<script>'
  cat test/stubs.js
  cat Code.gs
  cat test/preview-shim.js
  echo '</script>'
  cat Index.html
  echo '</body></html>'
} > "$OUT"

echo "Built $OUT"
[ "$1" = "--open" ] && { xdg-open "$OUT" 2>/dev/null || open "$OUT" 2>/dev/null; }
exit 0
