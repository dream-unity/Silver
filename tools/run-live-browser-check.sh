#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-${SITE_URL:-}}"
COMMIT="${2:-${GITHUB_SHA:-unknown}}"
OUTPUT_DIR="${3:-/tmp/silver-live}"

if [[ -z "$BASE" ]]; then
  echo 'A GitHub Pages base URL is required.' >&2
  exit 1
fi
BASE="${BASE%/}/"
mkdir -p "$OUTPUT_DIR"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$CHROME"
"$CHROME" --version
node --version
rm -rf /tmp/silver-map-chrome

"$CHROME" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --hide-scrollbars \
  --use-fake-device-for-media-stream \
  --use-fake-ui-for-media-stream \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/silver-map-chrome \
  --window-size=1440,900 \
  about:blank \
  > "$OUTPUT_DIR/chrome.log" 2>&1 &
CHROME_PID=$!
cleanup() {
  kill "$CHROME_PID" 2>/dev/null || true
  wait "$CHROME_PID" 2>/dev/null || true
}
trap cleanup EXIT

for attempt in {1..80}; do
  if curl --fail --silent http://127.0.0.1:9222/json/version \
    --output "$OUTPUT_DIR/version.json"; then
    break
  fi
  sleep 0.25
done
test -s "$OUTPUT_DIR/version.json"

export TARGET_URL="${BASE}?smoke=${COMMIT}"
ENCODED_URL="$(python3 - <<'PY'
import os
import urllib.parse
print(urllib.parse.quote(os.environ['TARGET_URL'], safe=''))
PY
)"
curl --fail --silent --request PUT \
  "http://127.0.0.1:9222/json/new?${ENCODED_URL}" \
  --output "$OUTPUT_DIR/target.json"

TARGET_JSON="$OUTPUT_DIR/target.json" \
OUTPUT_DIR="$OUTPUT_DIR" \
TARGET_URL="$TARGET_URL" \
node tools/verify-live-map.mjs

test -s "$OUTPUT_DIR/dom.html"
test -s "$OUTPUT_DIR/browser-evidence.json"
test -s "$OUTPUT_DIR/silver-before-map.png"
test -s "$OUTPUT_DIR/map-your-mind-start.png"
test -s "$OUTPUT_DIR/map-your-mind-working.png"
test -s "$OUTPUT_DIR/silver-after-map.png"
grep -Fq 'data-action="open-mind-map"' "$OUTPUT_DIR/dom.html"
grep -Fq 'Live deployment verification' "$OUTPUT_DIR/dom.html"

printf 'Live Silver and Map Your Mind verification completed for commit %s.\n' "$COMMIT"
