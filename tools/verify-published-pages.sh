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

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/src" "$OUTPUT_DIR/icons" "$OUTPUT_DIR/mind-map"

for attempt in {1..30}; do
  if curl --fail --silent --show-error --location \
    "${BASE}index.html?commit=${COMMIT}&attempt=${attempt}" \
    --output "$OUTPUT_DIR/index.html"; then
    if grep -Fq '20260903-map-your-mind-1' "$OUTPUT_DIR/index.html"; then
      break
    fi
  fi
  sleep 3
done

grep -Fq 'Silver · Private video journal' "$OUTPUT_DIR/index.html"
grep -Fq '20260903-map-your-mind-1' "$OUTPUT_DIR/index.html"

files=(
  bootstrap.js
  db.js
  archive.js
  sw.js
  manifest.webmanifest
  src/app.js
  src/db.js
  src/archive.js
  src/shell.html
  src/styles.css
  icons/silver-mark.svg
)
for file in "${files[@]}"; do
  mkdir -p "$OUTPUT_DIR/$(dirname "$file")"
  curl --fail --silent --show-error --location --retry 5 --retry-all-errors \
    "${BASE}${file}?commit=${COMMIT}" --output "$OUTPUT_DIR/${file}"
  cmp --silent "$file" "$OUTPUT_DIR/${file}"
done

while IFS= read -r -d '' file; do
  relative="${file#mind-map/}"
  mkdir -p "$OUTPUT_DIR/mind-map/$(dirname "$relative")"
  curl --fail --silent --show-error --location --retry 5 --retry-all-errors \
    "${BASE}mind-map/${relative}?commit=${COMMIT}" \
    --output "$OUTPUT_DIR/mind-map/${relative}"
  cmp --silent "$file" "$OUTPUT_DIR/mind-map/${relative}"
done < <(find mind-map -type f -print0)

if curl --fail --silent --show-error --location \
  "${BASE}mind-map-source/package.json?commit=${COMMIT}" \
  --output "$OUTPUT_DIR/unexpected-source.json"; then
  echo 'The editable Theory source must remain in the repository and outside the public Pages artifact.' >&2
  exit 1
fi

node --check "$OUTPUT_DIR/bootstrap.js"
node --check "$OUTPUT_DIR/sw.js"
node --check "$OUTPUT_DIR/src/app.js"
cp "$OUTPUT_DIR/mind-map/assets/app.js" "$OUTPUT_DIR/mind-map-app.mjs"
node --check "$OUTPUT_DIR/mind-map-app.mjs"
python3 -m json.tool "$OUTPUT_DIR/manifest.webmanifest" >/dev/null
python3 -m json.tool "$OUTPUT_DIR/mind-map/UPSTREAM.json" >/dev/null

grep -Fq 'data-action="open-mind-map"' "$OUTPUT_DIR/src/app.js"
grep -Fq 'id="mindMapDialog"' "$OUTPUT_DIR/src/shell.html"
grep -Fq '/Silver/mind-map/assets/app.js' "$OUTPUT_DIR/mind-map/index.html"
grep -Fq '78c88c42d2c45f46db480b6499bda90556ba944c' "$OUTPUT_DIR/mind-map/UPSTREAM.json"

printf 'Published Silver and all namespaced Theory build files match commit %s.\n' "$COMMIT"
