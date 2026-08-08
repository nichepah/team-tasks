#!/bin/sh
# Checks the UI never scrolls sideways on a phone, and that nothing tappable is
# smaller than a fingertip. Uses headless Chrome against the local preview.
#
# Optional: exits 0 with a note when no Chrome is installed, so `run.sh` stays a
# Node-only suite. Run it after changing anything in Index.html's stylesheet.
#
#   sh test/layout-check.sh
set -e
cd "$(dirname "$0")/.."

BROWSER=""
for b in chromium chromium-browser google-chrome google-chrome-stable; do
  if command -v "$b" >/dev/null 2>&1; then BROWSER="$b"; break; fi
done
if [ -z "$BROWSER" ]; then
  echo "-- layout: no Chrome on PATH, skipped"
  exit 0
fi

sh test/preview.sh >/dev/null
PROBE=test/.layout-probe.html
trap 'rm -f "$PROBE"' EXIT

# Headless Chrome refuses to open a window narrower than 500px, so the app is
# measured inside an iframe of the width we actually care about.
cat > "$PROBE" <<'HTML'
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0}iframe{border:0;display:block}</style>
<iframe id="f" src=".preview.html" height="844"></iframe>
<script>
  var m = /[?&]w=(\d+)/.exec(location.search);
  document.getElementById('f').width = m ? m[1] : 390;
  setTimeout(function () {
    var frame = document.getElementById('f').contentWindow;
    var doc = frame.document;
    var wide = [];
    doc.querySelectorAll('*').forEach(function (n) {
      var r = n.getBoundingClientRect();
      if (r.width && r.right > frame.innerWidth + 1) {
        wide.push((n.id || n.className || n.tagName) + '@' + Math.round(r.right));
      }
    });
    var small = [];
    doc.querySelectorAll('button').forEach(function (b) {
      var r = b.getBoundingClientRect();
      if (r.height && r.height < 32) small.push((b.id || b.className) + ':' + Math.round(r.height));
    });
    document.title = 'vw=' + frame.innerWidth +
      ' doc=' + doc.documentElement.scrollWidth +
      ' cards=' + doc.querySelectorAll('.task').length +
      ' over=' + (wide.slice(0, 6).join(',') || 'none') +
      ' small=' + (small.slice(0, 6).join(',') || 'none');
  }, 1600);
</script>
HTML

fail=0
echo ''
echo '-- layout: no sideways scroll on a phone --'
for W in 320 360 390 430 768; do
  TITLE=$("$BROWSER" --headless=new --disable-gpu --no-sandbox \
            --allow-file-access-from-files --window-size=560,900 \
            --virtual-time-budget=4000 --dump-dom "file://$PWD/$PROBE?w=$W" 2>/dev/null \
          | sed -n 's/.*<title>\(.*\)<\/title>.*/\1/p')

  if [ -z "$TITLE" ]; then
    echo "  FAIL ${W}px -- the preview did not render"
    fail=1
    continue
  fi

  DOC=$(echo "$TITLE" | sed -n 's/.*doc=\([0-9]*\).*/\1/p')
  CARDS=$(echo "$TITLE" | sed -n 's/.*cards=\([0-9]*\).*/\1/p')

  if ! echo "$TITLE" | grep -q 'over=none'; then
    echo "  FAIL ${W}px overflows to ${DOC}px -- $(echo "$TITLE" | sed -n 's/.*over=\([^ ]*\).*/\1/p')"
    fail=1
  elif [ "$CARDS" = "0" ]; then
    echo "  FAIL ${W}px -- no task cards rendered, so nothing was really measured"
    fail=1
  elif ! echo "$TITLE" | grep -q 'small=none'; then
    echo "  FAIL ${W}px has tap targets under 32px -- $(echo "$TITLE" | sed -n 's/.*small=\([^ ]*\).*/\1/p')"
    fail=1
  else
    echo "  ok   ${W}px fits exactly (${CARDS} cards, no undersized taps)"
  fi
done

echo ''
if [ "$fail" = "1" ]; then
  echo 'layout check failed'
  exit 1
fi
echo 'layout check passed'
