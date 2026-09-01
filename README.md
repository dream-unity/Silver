# Silver

Silver is an original, private, video-first journal built as a static Progressive Web App. It runs directly from GitHub Pages, requires no account or subscription, and stores entries and original media in the browser's IndexedDB database.

Silver is not affiliated with Day One or Automattic. Its interface and implementation are original. The product direction is informed by mature journal-app capabilities while preserving local ownership and removing artificial recording-duration limits.

## Included in this build

- Direct video recording with camera switching, pause/resume and no fixed five-minute limit
- Direct audio recording and optional browser-supported live transcription
- Photos, existing video/audio, PDFs and files; up to 30 attachments per entry
- Written entries with Markdown formatting and preview
- Device-local draft recovery and save status
- Multiple journals grouped into collections
- Templates, daily prompts, moods, tags, favourites and optional location metadata
- Today dashboard, streak and word statistics
- Timeline, global full-text search and journal filtering
- Calendar, On This Day, Media, Places and Favourites views
- Complete `.silver` archive export/import retaining original media
- Readable text export and per-entry archive export
- Local app lock using PBKDF2 passcode verification
- Storage persistence request and live quota estimate
- Installable, responsive PWA with offline application shell
- Share-target support for text and links on compatible installed devices
- Daily in-app/browser reminders where platform permissions permit
- Keyboard shortcuts: `Ctrl/Cmd+N`, `Ctrl/Cmd+S`, and `/` for search

## Privacy model

Entries and media remain in the current browser profile unless exported. Silver has no analytics, advertising, remote database, user account or tracking code.

The optional app lock prevents casual access to the interface; it is not full encryption of the browser's IndexedDB files. Device security and regular `.silver` archive exports remain important. A passcode hash is derived with PBKDF2-SHA-256 and the passcode itself is never stored.

## Data safety

Browser storage is not a substitute for a backup. Use **Settings → Your data → Export complete .silver archive** regularly, especially before clearing browser data, changing devices or reinstalling the browser.

## Run locally

Silver uses JavaScript modules and should be served over HTTP rather than opened directly as a file:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a current version of Chrome, Edge, Firefox or Safari. Camera and microphone recording require a secure context (`https://` or localhost).

## Deployment

The repository is designed for GitHub Pages from the `main` branch root. All assets are relative, so the app works correctly at a project path such as `/Silver/`.

## Architecture

- `index.html` — accessible application shell and dialogs
- `styles.css` — responsive visual system
- `app.js` — state, rendering, capture, editor and interaction logic
- `db.js` — IndexedDB schema and atomic persistence operations
- `archive.js` — native TAR-based `.silver` export/import without third-party libraries
- `sw.js` — offline application-shell service worker
- `manifest.webmanifest` — install metadata, shortcuts and share target

## Current platform boundary

This static release intentionally does not claim automatic multi-device cloud sync or end-to-end encrypted remote backup. Those features require a trusted synchronization backend or user-owned storage integration. Complete archives provide lossless manual transfer today without surrendering journal data to this site.
