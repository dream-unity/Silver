# Silver

[Open the live Silver journal](https://dream-unity.github.io/Silver/)

Silver is an original, private, video-first journal built as a static Progressive Web App. It runs directly from GitHub Pages, requires no account or subscription, and stores entries and original media in the current browser's IndexedDB database.

Silver is not affiliated with Day One or Automattic. Its implementation and visual identity are original. The product direction borrows the strongest general patterns from mature journal applications while prioritising local ownership, serious video reflection and unrestricted customisation.

## Included in this release

- Direct video recording with camera switching, pause/resume and no artificial five-minute limit
- Direct audio recording and optional browser-supported live transcription
- Photos, existing video/audio, PDFs and files; up to 30 attachments per entry
- Clickable editor attachments and a focused image/document/audio/video viewer
- A viewport-fitted desktop editor usable at normal 100% browser zoom
- Written entries with Markdown formatting and preview
- Device-local draft recovery and save status
- Multiple journals grouped into collections
- Templates, rotating daily prompts, moods, tags, favourites and optional location metadata
- Today dashboard, writing streak and word statistics
- Timeline, global full-text search and journal filtering
- Calendar, On This Day, Media, Places and Favourites views
- Lossless `.silver` archive export/import retaining original media
- Readable text export and per-entry archive export
- Local app lock using PBKDF2-SHA-256 passcode verification
- Storage-persistence request and live browser-quota estimate
- Installable, responsive PWA with an offline application shell
- Share-target support for text and links on compatible installed devices
- Daily in-app/browser reminders where platform permissions permit
- Keyboard shortcuts: `Ctrl/Cmd+N`, `Ctrl/Cmd+S`, and `/` for search

## Privacy model

Entries and media remain in the current browser profile unless exported. Silver contains no analytics, advertising, remote database, user account, telemetry or tracking code.

Camera, microphone, speech-recognition, notification and location permissions are requested only when the corresponding feature is deliberately used.

The optional app lock prevents casual access to the interface. It does **not** encrypt the browser's IndexedDB files or replace device security. Silver derives a verifier with PBKDF2-SHA-256 and never stores the passcode itself.

## Data ownership and backups

Browser storage is not a substitute for a backup. Use **Settings → Your data → Export complete .silver archive** regularly, especially before clearing browser data, changing devices or reinstalling the browser.

A complete `.silver` archive is lossless: it carries journals, collections, entries, templates, settings and original attachment blobs. The readable text export is convenient for reading but does not replace the complete archive.

## Current platform boundary

This static release does not pretend to provide automatic multi-device cloud synchronisation or end-to-end encrypted remote backup. Those capabilities require a trusted synchronisation service or user-owned storage integration. Complete archives provide lossless manual transfer today without surrendering journal data to this site.

## Run locally

Silver should be served over HTTP rather than opened directly as a file:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a current version of Chrome, Edge, Firefox or Safari. Camera and microphone recording require a secure context: HTTPS or localhost.

## Runtime architecture

- `index.html` — accessible startup shell and visible failure fallback
- `bootstrap.js` — loads the canonical markup, visual system and application module
- `src/shell.html` — complete accessible application interface
- `src/styles.css` — responsive desktop/mobile visual system
- `src/app.js` — application state, rendering, editor, capture and interaction engine
- `src/db.js`, `src/archive.js` — small module routes used by the application engine
- `db.js` — IndexedDB schema and atomic persistence operations
- `archive.js` — native TAR-based `.silver` export/import without third-party libraries
- `sw.js` — offline application-shell cache with network-first runtime updates
- `manifest.webmanifest` — install metadata, shortcuts and share target
- `.github/workflows/pages.yml` — syntax checks, deterministic Pages deployment, published-file comparison and live-browser verification

All runtime source is readable in `main`; no build server, package manager or third-party JavaScript dependency is required.

## Verification performed

The release was exercised in desktop and mobile Chromium layouts. Local verification covered entry creation, fake-camera video recording with pause/resume, audio and file attachments, IndexedDB persistence, search, calendar and media navigation, passcode locking, complete archive export, fresh-database import with media retained, responsive navigation and browser-console errors.

Every Pages deployment then performs a second independent live check. The workflow compares published runtime files with `main`, opens the public GitHub Pages application through Chrome DevTools, waits for IndexedDB initialisation, opens and saves a test entry, confirms that it reappears in the interface, captures a screenshot and fails on page exceptions or console errors.

## Deployment

The repository is deployed from `main` to:

https://dream-unity.github.io/Silver/

All application paths are relative, so the PWA works correctly under the `/Silver/` project path.


## Map Your Mind integration

The Today dashboard's upper-right card opens a full-screen, isolated copy of the Theory mind-mapping application. The exact pinned functional source is retained under `mind-map-source/`; its tested static build is under `mind-map/`. Silver loads that build only after **Map Your Mind** is selected, so the journal, recorder, IndexedDB data and existing navigation remain independent.

The integrated copy is pinned to `dream-unity/theory` commit `78c88c42d2c45f46db480b6499bda90556ba944c`. The upstream repository is read only: Silver's integration never writes to or modifies `dream-unity/theory`.


## Deleted Memories

Silver uses one shared, device-local recovery store for the journal and Map Your Mind. Deleting a journal entry, saved media attachment, journal, collection, writing template, mind map, mind-map thought or mind-map attachment moves it into **Deleted Memories** rather than destroying it immediately.

The recovery button is fixed at the lower-left of the Silver sidebar and at the lower-left of both mind-map screens. Both buttons open the same recovery page. Each item shows its exact expiry, can be restored, or can be permanently deleted immediately. Items automatically become permanently unavailable 30 days after deletion; Silver performs expiry cleanup at startup, while visible, during hourly checks and whenever either application observes a recovery-store change.

The original `dream-unity/theory` repository remains untouched. Only Silver's isolated vendored copy contains the recovery bridge.
