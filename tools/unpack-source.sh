#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=${1:-"$ROOT/unpacked"}
mkdir -p "$OUT"

if printf 'U2lsdmVy\n' | base64 --decode >/dev/null 2>&1; then
  DECODE='base64 --decode'
elif printf 'U2lsdmVy\n' | base64 -D >/dev/null 2>&1; then
  DECODE='base64 -D'
else
  echo 'No compatible base64 decoder was found.' >&2
  exit 1
fi

cat "$ROOT"/app.source.1.b64 \
    "$ROOT"/app.source.2.b64 \
    "$ROOT"/app.source.3.b64 \
    "$ROOT"/app.source.4.b64 \
    "$ROOT"/app.source.5.b64 \
    "$ROOT"/app.source.6.b64 \
    "$ROOT"/app.source.7.b64 \
    "$ROOT"/app.source.8.b64 \
  | sh -c "$DECODE" \
  | gzip -dc > "$OUT/app.js"

gzip -dc "$ROOT/shell.html.gz" > "$OUT/shell.html"
gzip -dc "$ROOT/styles.css.gz" > "$OUT/styles.css"

printf 'Reconstructed:\n  %s\n  %s\n  %s\n' \
  "$OUT/app.js" "$OUT/shell.html" "$OUT/styles.css"
