#!/usr/bin/env bash
set -euo pipefail

SITE_DIR="${1:-_site}"

node --check bootstrap.js
node --check db.js
node --check archive.js
node --check deleted-memories.js
node --check sw.js
node --check src/app.js
node --check src/db.js
node --check src/archive.js
python3 -m json.tool manifest.webmanifest >/dev/null
python3 -m json.tool mind-map/UPSTREAM.json >/dev/null

grep -Fq "app: versioned('./src/app.js')" bootstrap.js
grep -Fq 'data-action="open-media"' src/app.js
grep -Fq 'data-action="open-mind-map"' src/app.js
grep -Fq 'id="mindMapDialog"' src/shell.html
grep -Fq 'data-src="./mind-map/"' src/shell.html
grep -Fq 'Silver editor viewport and attachment playback fix' src/styles.css
grep -Fq 'Silver Map Your Mind integration' src/styles.css
grep -Fq 'Silver Deleted Memories' src/styles.css
grep -Fq 'data-view="deleted"' src/shell.html
grep -Fq 'restore-deleted-memory' src/app.js
grep -Fq "deletedMemories: 'deletedMemories'" db.js
grep -Fq '20260903-deleted-memories-1' bootstrap.js
grep -Fq '20260903-deleted-memories-1' index.html
grep -Fq '20260901-recorder-viewport-2' index.html
grep -Fq "url.pathname.includes('/mind-map/')" sw.js

test -s mind-map/index.html
test -s mind-map/assets/app.js
test -s mind-map/assets/app.css
test -s mind-map/data/theory.json
test -s mind-map/runtime-config.json
test -s mind-map/UPSTREAM.json
test -s mind-map-source/src/App.tsx
test -s mind-map-source/src/components/Plex.tsx
test -s mind-map-source/src/components/DeletedMemoriesButton.tsx
test -s mind-map-source/src/lib/deleted-memories.ts
test -s mind-map-source/src/lib/store.ts
test ! -e mind-map-source/.git
test ! -d mind-map-source/node_modules
grep -Fq '/Silver/mind-map/assets/app.js' mind-map/index.html
grep -Fq '/Silver/mind-map/assets/app.css' mind-map/index.html
grep -Fq 'Deleted Memories' mind-map/assets/app.js
grep -Fq 'silver-open-deleted-memories' mind-map/assets/app.js
grep -Fq '78c88c42d2c45f46db480b6499bda90556ba944c' mind-map/UPSTREAM.json
grep -Fq "base: command === 'serve' ? '/' : '/theory/'" mind-map-source/vite.config.ts

for file in mind-map/assets/*.js; do
  cp "$file" /tmp/silver-mind-map-check.mjs
  node --check /tmp/silver-mind-map-check.mjs
done

rm -rf "$SITE_DIR"
mkdir -p "$SITE_DIR/icons" "$SITE_DIR/src"
cp index.html bootstrap.js db.js archive.js deleted-memories.js sw.js manifest.webmanifest .nojekyll "$SITE_DIR/"
cp icons/silver-mark.svg "$SITE_DIR/icons/"
cp src/app.js src/db.js src/archive.js src/shell.html src/styles.css "$SITE_DIR/src/"
cp -a mind-map "$SITE_DIR/mind-map"

test -s "$SITE_DIR/index.html"
test -s "$SITE_DIR/bootstrap.js"
test -s "$SITE_DIR/deleted-memories.js"
test -s "$SITE_DIR/src/app.js"
test -s "$SITE_DIR/src/shell.html"
test -s "$SITE_DIR/src/styles.css"
test -s "$SITE_DIR/mind-map/index.html"
test -s "$SITE_DIR/mind-map/assets/app.js"
test -s "$SITE_DIR/mind-map/assets/app.css"
test ! -e "$SITE_DIR/mind-map-source"

printf 'Assembled Silver and the isolated Theory build in %s\n' "$SITE_DIR"
