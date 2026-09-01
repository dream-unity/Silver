# Silver

Silver is an original, private, video-first journal built as a static Progressive Web App. It runs directly from GitHub Pages, requires no account or subscription, and stores entries and original media in the browser's IndexedDB database.

Silver is not affiliated with Day One or Automattic. Its interface and implementation are original. The product direction is informed by mature journal-app capabilities while preserving local ownership and removing artificial recording-duration limits.

## Included in this release

- Direct video recording with camera switching, pause/resume and no fixed five-minute limit
- Direct audio recording and optional browser-supported live transcription
- Photos, existing video/audio, PDFs and files; up to 30 attachments per entry
- Written entries with Markdown formatting and preview
- Device-local draft recovery and save status
- Multiple journals grouped into collections
- Templates, rotating daily prompts, moods, tags, favourites and optional location metadata
- Today dashboard, writing streak and word statistics
- Timeline, global full-text search and journal filtering
- Calendar, On This Day, Media, Places and Favourites views
- Complete `.silver` archive export/import retaining original media
- Readable text export and per-entry archive export
- Local app lock using PBKDF2-SHA-256 passcode verification
- Storage-persistence request and live browser-quota estimate
- Installable, responsive PWA with an offline application shell
- Share-target support for text and links on compatible installed devices
- Daily in-app/browser reminders where platform permissions permit
- Keyboard shortcuts: `Ctrl/Cmd+N`, `Ctrl/Cmd+S`, and `/` for search

## Privacy model

Entries and media remain in the current browser profile unless exported. Silver contains no analytics, advertising, remote database, user account, telemetry or tracking code.

The optional app lock prevents casual access to the interface; it is not full encryption of the browser's IndexedDB files. Device security and regular `.silver` archive exports remain important. Silver derives a verifier with PBKDF2-SHA-256 and never stores the passcode itself.

Camera, microphone, speech-recognition, notification and location permissions are requested only when the corresponding feature is deliberately used.

## Data safety

Browser storage is not a substitute for a backup. Use **Settings → Your data → Export complete .silver archive** regularly, especially before clearing browser data, changing devices or reinstalling the browser.

A complete `.silver` archive is lossless: it carries journals, collections, entries, templates, settings and original attachment blobs. The readable text export is for convenient reading and does not replace the complete archive.

## Run locally

Silver should be served over HTTP rather than opened directly as a file:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a current version of Chrome, Edge, Firefox or Safari. Camera and microphone recording require a secure context (`https://` or localhost).

## Deployment

The repository is designed for GitHub Pages at the `main` branch root. All paths are relative, so the application works at a project URL such as `/Silver/`. The Pages workflow publishes the repository as a static artifact without a build server or third-party dependency.

## Runtime architecture

- `index.html` — small accessible boot shell and failure fallback
- `bootstrap.js` — loads the readable application bundle and retains the packaged release as a fallback
- `src/shell.html` — canonical accessible application markup
- `src/styles.css` — canonical responsive visual system
- `src/app.js` — canonical application engine
- `shell.html.gz`, `styles.css.gz`, `app.source.1.b64` … `app.source.8.b64` — backward-compatible packaged fallback
- `db.js` — IndexedDB schema and atomic persistence operations
- `archive.js` — native TAR-based `.silver` export/import without third-party libraries
- `sw.js` — offline application-shell service worker
- `manifest.webmanifest` — install metadata, shortcuts and share target

The segmented source format is a transport/deployment detail rather than minification or obfuscation. Reconstruct the readable source at any time with:

```bash
mkdir -p unpacked
cat app.source.{1..8}.b64 | base64 --decode | gzip --decompress > unpacked/app.js
gzip --decompress --stdout shell.html.gz > unpacked/shell.html
gzip --decompress --stdout styles.css.gz > unpacked/styles.css
```

On macOS, use `base64 -D` instead of `base64 --decode`. The included `tools/unpack-source.sh` handles GNU and BSD base64 automatically.

## Verification performed

The release was exercised in desktop and mobile Chromium layouts. Verification covered entry creation, video recording with pause/resume, audio and file attachments, IndexedDB persistence, search, calendar and media navigation, passcode locking, complete archive export, fresh-database import with media retained, responsive navigation and browser-console errors. Repository Git blob hashes were then compared against the tested local build before deployment.

## Current platform boundary

This static release intentionally does not claim automatic multi-device cloud synchronization or end-to-end encrypted remote backup. Those capabilities require a trusted synchronization service or a user-owned storage integration. Complete archives provide lossless manual transfer today without surrendering journal data to this site.
