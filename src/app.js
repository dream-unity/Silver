import {
  ensureSeedData,
  loadLibrary,
  saveEntry as persistEntry,
  deleteEntry as removeEntry,
  deleteAttachment,
  saveSetting,
  removeSetting,
  saveJournal,
  deleteJournal,
  saveCollection,
  deleteCollection,
  saveTemplate,
  deleteTemplate,
  importLibrary,
  eraseLibrary,
  uid
} from './db.js';
import { createSilverArchive, parseSilverArchive, createReadableText } from './archive.js';

const PROMPTS = [
  'What happened today that deserves to remain visible?',
  'What are you carrying that can be put down now?',
  'Which small moment changed the emotional shape of your day?',
  'What truth became clearer when you stopped forcing an answer?',
  'What did your body know before your thoughts caught up?',
  'Which conversation is still continuing inside you?',
  'What are you becoming through what you repeatedly choose?',
  'What deserves more attention than you gave it today?',
  'What did you misunderstand at first, and what changed?',
  'Which part of today would your future self want preserved?',
  'What decision are you avoiding by calling it uncertainty?',
  'Where did you feel most fully yourself today?',
  'What pattern appeared again, and what might it be teaching you?',
  'What would an honest account of this moment leave out?',
  'What are you grateful for that is easy to overlook?'
];

const MOODS = Object.freeze({
  radiant: { symbol: '☀', label: 'Radiant' },
  good: { symbol: '◕', label: 'Good' },
  steady: { symbol: '●', label: 'Steady' },
  low: { symbol: '◔', label: 'Low' },
  stormy: { symbol: '☂', label: 'Stormy' }
});

const VIEWS = new Set(['today', 'timeline', 'calendar', 'memories', 'media', 'places', 'favorites']);
const MAX_ATTACHMENTS = 30;
const DRAFT_KEY = 'silver-unsaved-entry-draft-v1';

const state = {
  library: null,
  view: 'today',
  selectedJournalId: '',
  search: '',
  dateFilter: '',
  calendarCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  mediaFilter: 'all',
  editorEntryId: null,
  editorAttachments: [],
  removedAttachmentIds: new Set(),
  editorLocation: null,
  editorMood: '',
  editingJournalId: null,
  mediaViewerAttachmentId: null,
  locked: false,
  lastActivity: Date.now(),
  deferredInstallPrompt: null,
  pendingLaunchAction: null,
  toastTimer: 0,
  viewObjectUrls: new Set(),
  editorObjectUrls: new Set(),
  viewerObjectUrl: ''
};

const recorder = {
  mode: 'video',
  stream: null,
  instance: null,
  chunks: [],
  startedAt: 0,
  pausedAt: 0,
  pausedTotal: 0,
  timer: 0,
  facingMode: 'user',
  transcript: '',
  recognition: null,
  discarding: false
};

const el = {};

function cacheElements() {
  [
    'sidebar', 'sidebarClose', 'sidebarScrim', 'menuButton', 'journalList', 'addJournalButton',
    'settingsButton', 'installButton', 'storageStatus', 'globalSearch', 'lockButton', 'newEntryButton',
    'viewRoot', 'entryDialog', 'entryForm', 'editorEyebrow', 'editorHeading', 'draftState', 'entryTitle',
    'entryBody', 'entryPreview', 'previewToggle', 'entryJournal', 'entryDate', 'templateSelect', 'moodPicker',
    'entryTags', 'entryLocationLabel', 'locateButton', 'locationStatus', 'entryFavorite', 'saveTemplateButton',
    'attachmentInput', 'attachmentTray', 'attachmentCount', 'recordVideoButton', 'recordAudioButton',
    'deleteEntryButton', 'cancelEntryButton', 'saveEntryButton', 'recorderDialog', 'recorderEyebrow',
    'recorderHeading', 'closeRecorderButton', 'recorderStage', 'recorderPreview', 'audioOrb', 'recorderIdle',
    'recordingBadge', 'recordingClock', 'recorderMessage', 'prepareRecorderButton', 'startRecorderButton',
    'pauseRecorderButton', 'finishRecorderButton', 'flipCameraButton', 'transcriptPanel', 'liveTranscript',
    'useTranscriptButton', 'settingsDialog', 'settingsForm', 'themeSelect', 'reminderTime',
    'enableNotificationsButton', 'persistStorageButton', 'journalManager', 'settingsAddJournal',
    'newCollectionName', 'addCollectionButton', 'templateManager', 'newPasscode', 'confirmPasscode',
    'setPasscodeButton', 'removePasscodeButton', 'autoLockSelect', 'exportLibraryButton', 'importLibraryInput',
    'exportTextButton', 'storageUsage', 'storageMeter', 'storageDetail', 'wipeLibraryButton', 'journalDialog',
    'journalForm', 'journalDialogTitle', 'journalName', 'journalCollection', 'journalColours',
    'deleteJournalButton', 'saveJournalButton', 'mediaDialog', 'mediaViewerType', 'mediaViewerTitle',
    'mediaViewerBody', 'closeMediaViewer', 'downloadMediaButton', 'openMediaEntryButton', 'lockScreen',
    'unlockForm', 'unlockPasscode', 'lockError', 'toast'
  ].forEach(id => { el[id] = document.getElementById(id); });
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value = '') {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

function stripMarkdown(value = '') {
  return String(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(^|\s)[#>*_`~-]+/gm, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderMarkdown(value = '') {
  let html = escapeHtml(value);
  html = html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/(?:<li>.*?<\/li>\n?)+/gs, match => `<ul>${match}</ul>`);
  return html
    .split(/\n{2,}/)
    .map(block => /^(<h\d|<blockquote|<ul)/.test(block.trim()) ? block : `<p>${block.replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function icon(id) {
  return `<svg aria-hidden="true"><use href="#icon-${id}"></use></svg>`;
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localMonthKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function toDateInputValue(timestamp) {
  const date = new Date(timestamp || Date.now());
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDate(timestamp, options = {}) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp));
}

function formatEntryDate(timestamp) {
  return formatDate(timestamp, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(timestamp) {
  return formatDate(timestamp, { hour: 'numeric', minute: '2-digit' });
}

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDuration(milliseconds = 0) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function fileKind(mimeType = '', name = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  return 'file';
}

function fileExtension(mimeType, kind) {
  const map = {
    'video/webm': 'webm', 'video/mp4': 'mp4', 'audio/webm': 'webm', 'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'image/jpeg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'application/pdf': 'pdf'
  };
  return map[mimeType] || ({ video: 'webm', audio: 'webm', image: 'jpg', pdf: 'pdf' }[kind] || 'bin');
}

function uniqueTags(value) {
  return [...new Set(String(value || '').split(',').map(tag => tag.trim()).filter(Boolean).map(tag => tag.slice(0, 50)))];
}

function makeObjectUrl(blob, bucket = state.viewObjectUrls) {
  if (!(blob instanceof Blob)) return '';
  const url = URL.createObjectURL(blob);
  bucket.add(url);
  return url;
}

function revokeBucket(bucket) {
  bucket.forEach(url => URL.revokeObjectURL(url));
  bucket.clear();
}

function showToast(message, duration = 3200) {
  clearTimeout(state.toastTimer);
  el.toast.textContent = message;
  el.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => { el.toast.hidden = true; }, duration);
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function journalById(id) {
  return state.library.journals.find(journal => journal.id === id) || state.library.journals[0];
}

function entryById(id) {
  return state.library.entries.find(entry => entry.id === id);
}

function attachmentById(id) {
  return state.library.attachments.find(attachment => attachment.id === id);
}

function attachmentsForEntry(entryId) {
  return state.library.attachments
    .filter(attachment => attachment.entryId === entryId)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function reloadLibrary() {
  return loadLibrary().then(library => { state.library = library; return library; });
}

function applyTheme(theme = state.library?.settings?.theme || 'system') {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const themeColour = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#eef0f4';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColour);
}

function promptForToday() {
  const date = new Date();
  const seed = Number(`${date.getFullYear()}${date.getMonth() + 1}${date.getDate()}`);
  return PROMPTS[seed % PROMPTS.length];
}

function computeStreak(entries) {
  const days = new Set(entries.map(entry => localDateKey(entry.createdAt)));
  if (!days.size) return 0;
  const cursor = new Date();
  if (!days.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function countWords(entries) {
  return entries.reduce((sum, entry) => sum + String(entry.body || '').trim().split(/\s+/).filter(Boolean).length, 0);
}

function entryMatchesSearch(entry, query) {
  if (!query) return true;
  const attachmentNames = attachmentsForEntry(entry.id).map(item => item.name).join(' ');
  const journal = journalById(entry.journalId)?.name || '';
  const location = entry.location?.label || '';
  const haystack = [entry.title, entry.body, entry.tags?.join(' '), attachmentNames, journal, location]
    .join(' ')
    .normalize('NFKD')
    .toLowerCase();
  return query.split(/\s+/).filter(Boolean).every(term => haystack.includes(term));
}

function filteredEntries({ view = state.view } = {}) {
  let entries = [...state.library.entries];
  if (state.selectedJournalId) entries = entries.filter(entry => entry.journalId === state.selectedJournalId);
  if (state.search) entries = entries.filter(entry => entryMatchesSearch(entry, state.search));
  if (state.dateFilter) entries = entries.filter(entry => localDateKey(entry.createdAt) === state.dateFilter);
  if (view === 'favorites') entries = entries.filter(entry => entry.favorite);
  if (view === 'memories') {
    const today = new Date();
    entries = entries.filter(entry => {
      const date = new Date(entry.createdAt);
      return date.getMonth() === today.getMonth() && date.getDate() === today.getDate() && date.getFullYear() < today.getFullYear();
    });
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

function renderSidebar() {
  const entries = state.library.entries;
  const collections = [...state.library.collections].sort((a, b) => a.name.localeCompare(b.name));
  const grouped = new Map(collections.map(collection => [collection.id, []]));
  const ungrouped = [];
  [...state.library.journals]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(journal => (grouped.get(journal.collectionId) || ungrouped).push(journal));

  const journalButton = journal => {
    const count = entries.filter(entry => entry.journalId === journal.id).length;
    return `<button class="journal-button ${state.selectedJournalId === journal.id ? 'active' : ''}" type="button" data-journal-id="${escapeAttribute(journal.id)}" style="--journal-colour:${escapeAttribute(journal.colour || '#7c88a5')}">
      <i class="journal-dot"></i><span>${escapeHtml(journal.name)}</span><b class="journal-count">${count}</b>
    </button>`;
  };

  let html = `<button class="journal-button ${!state.selectedJournalId ? 'active' : ''}" type="button" data-journal-id=""><i class="journal-dot" style="--journal-colour:var(--accent)"></i><span>All journals</span><b class="journal-count">${entries.length}</b></button>`;
  collections.forEach(collection => {
    const journals = grouped.get(collection.id) || [];
    if (!journals.length) return;
    html += `<div class="collection-label">${escapeHtml(collection.name)}</div>${journals.map(journalButton).join('')}`;
  });
  if (ungrouped.length) html += `<div class="collection-label">Unfiled</div>${ungrouped.map(journalButton).join('')}`;
  el.journalList.innerHTML = html;

  document.querySelectorAll('.primary-nav [data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === state.view && !state.search);
  });
}

function viewHeading(eyebrow, title, description = '', tools = '') {
  return `<header class="view-heading"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div>${tools ? `<div class="view-tools">${tools}</div>` : ''}</header>`;
}

function activeFilterTools() {
  const parts = [];
  if (state.selectedJournalId) {
    parts.push(`<span class="filter-pill">Journal: <b>${escapeHtml(journalById(state.selectedJournalId)?.name || '')}</b><button type="button" data-clear-filter="journal" aria-label="Clear journal filter">${icon('close')}</button></span>`);
  }
  if (state.dateFilter) {
    const date = new Date(`${state.dateFilter}T12:00:00`);
    parts.push(`<span class="filter-pill"><b>${escapeHtml(formatDate(date, { day: 'numeric', month: 'short', year: 'numeric' }))}</b><button type="button" data-clear-filter="date" aria-label="Clear date filter">${icon('close')}</button></span>`);
  }
  return parts.join('');
}

function entryMediaMarkup(attachment) {
  if (!attachment) return '';
  const url = makeObjectUrl(attachment.blob);
  const badge = `<span class="media-type-badge">${icon(attachment.kind === 'audio' ? 'mic' : attachment.kind === 'video' ? 'video' : attachment.kind === 'image' ? 'media' : 'document')}${escapeHtml(attachment.kind.toUpperCase())}</span>`;
  if (attachment.kind === 'image') return `<div class="entry-media" data-action="open-media" data-attachment-id="${escapeAttribute(attachment.id)}"><img src="${url}" alt="" loading="lazy" />${badge}</div>`;
  if (attachment.kind === 'video') return `<div class="entry-media" data-action="open-media" data-attachment-id="${escapeAttribute(attachment.id)}"><video src="${url}#t=0.1" muted playsinline preload="metadata"></video>${badge}</div>`;
  return `<div class="entry-media" data-action="open-media" data-attachment-id="${escapeAttribute(attachment.id)}"><div class="file-tile">${icon(attachment.kind === 'audio' ? 'mic' : 'document')}<strong>${escapeHtml(attachment.name || 'Attachment')}</strong></div>${badge}</div>`;
}

function entryCard(entry) {
  const journal = journalById(entry.journalId);
  const attachments = attachmentsForEntry(entry.id);
  const lead = attachments.find(item => item.kind === 'image' || item.kind === 'video') || attachments[0];
  const mood = MOODS[entry.mood];
  const excerpt = stripMarkdown(entry.body || '');
  const title = entry.title || (excerpt ? excerpt.slice(0, 70) : attachments.length ? 'Media entry' : 'Untitled entry');
  const media = entryMediaMarkup(lead);
  const tags = (entry.tags || []).slice(0, 5).map(tag => `<span class="entry-tag">#${escapeHtml(tag)}</span>`).join('');
  return `<article class="entry-card ${media ? '' : 'no-media'}" data-entry-id="${escapeAttribute(entry.id)}">
    ${media}
    <div class="entry-content" data-action="open-entry" data-entry-id="${escapeAttribute(entry.id)}">
      <div class="entry-meta-line">
        <time>${escapeHtml(formatEntryDate(entry.createdAt))} · ${escapeHtml(formatTime(entry.createdAt))}</time>
        <span>·</span>
        <span class="journal-chip"><i class="journal-dot" style="--journal-colour:${escapeAttribute(journal?.colour || '#7c88a5')}"></i>${escapeHtml(journal?.name || 'Journal')}</span>
        ${attachments.length ? `<span>· ${attachments.length} ${attachments.length === 1 ? 'attachment' : 'attachments'}</span>` : ''}
      </div>
      <h2>${escapeHtml(title)}</h2>
      <p class="entry-excerpt">${escapeHtml(excerpt || 'No written reflection.')}</p>
      ${tags ? `<div class="entry-tags">${tags}</div>` : ''}
    </div>
    <div class="entry-actions">
      <button class="icon-button favourite ${entry.favorite ? 'active' : ''}" type="button" data-action="favorite" data-entry-id="${escapeAttribute(entry.id)}" aria-label="${entry.favorite ? 'Remove from favourites' : 'Add to favourites'}">${icon('star')}</button>
      <button class="icon-button" type="button" data-action="share" data-entry-id="${escapeAttribute(entry.id)}" aria-label="Share entry">${icon('share')}</button>
      <button class="icon-button" type="button" data-action="export-entry" data-entry-id="${escapeAttribute(entry.id)}" aria-label="Export entry">${icon('download')}</button>
      ${mood ? `<span class="entry-mood" title="${escapeAttribute(mood.label)}">${mood.symbol}</span>` : '<span class="entry-mood" hidden></span>'}
    </div>
  </article>`;
}

function emptyState(title, description, actionLabel = 'Create an entry') {
  return `<div class="empty-state">${icon('document')}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${actionLabel ? `<button class="primary-button" type="button" data-action="new-entry">${icon('plus')}${escapeHtml(actionLabel)}</button>` : ''}</div>`;
}

function renderSearchResults() {
  const entries = filteredEntries({ view: 'timeline' });
  const journalLabel = state.selectedJournalId ? ` in ${journalById(state.selectedJournalId)?.name || 'journal'}` : '';
  return `${viewHeading('SEARCH', `“${state.search}”`, `${entries.length} matching ${entries.length === 1 ? 'entry' : 'entries'}${journalLabel}.`, activeFilterTools())}
    ${entries.length ? `<div class="entry-list">${entries.map(entryCard).join('')}</div>` : emptyState('Nothing matched', 'Try another word, tag, title, place or journal name.', '')}`;
}

function renderToday() {
  const todayKey = localDateKey(new Date());
  const todayEntries = state.library.entries.filter(entry => localDateKey(entry.createdAt) === todayKey).sort((a, b) => b.createdAt - a.createdAt);
  const memories = filteredEntries({ view: 'memories' });
  const memory = memories[0];
  const allEntries = state.library.entries;
  const streak = computeStreak(allEntries);
  const recent = filteredEntries({ view: 'timeline' }).slice(0, 6);
  const wordCount = countWords(allEntries);
  const mediaCount = state.library.attachments.length;
  const dateHeading = formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' });

  const memoryMarkup = memory ? `<button class="memory-card" type="button" data-action="open-entry" data-entry-id="${escapeAttribute(memory.id)}">
      <header><span class="eyebrow">ON THIS DAY</span><span>${new Date().getFullYear() - new Date(memory.createdAt).getFullYear()} years ago</span></header>
      <div class="memory-content"><span class="memory-year">${new Date(memory.createdAt).getFullYear()}</span><h3>${escapeHtml(memory.title || stripMarkdown(memory.body).slice(0, 70) || 'A past entry')}</h3><p>${escapeHtml(stripMarkdown(memory.body).slice(0, 140) || 'Open this memory.')}</p></div>
    </button>` : `<div class="memory-card empty-memory"><div class="memory-content">${icon('history')}<h3>Your memories will return here</h3><p>Entries from this calendar date reappear each year.</p></div></div>`;

  return `${viewHeading('TODAY', dateHeading, todayEntries.length ? `${todayEntries.length} ${todayEntries.length === 1 ? 'entry' : 'entries'} captured today.` : 'A clear place to notice, record and remember.')}
    <section class="today-hero">
      <article class="prompt-card"><p class="eyebrow">TODAY'S PROMPT</p><blockquote>${escapeHtml(promptForToday())}</blockquote><button class="secondary-button" type="button" data-action="prompt-entry">Write from this prompt</button></article>
      ${memoryMarkup}
    </section>
    <section class="stats-row" aria-label="Journal statistics">
      <article class="stat-card"><strong>${allEntries.length}</strong><span>Total entries</span></article>
      <article class="stat-card"><strong>${streak}</strong><span>Day streak</span></article>
      <article class="stat-card"><strong>${wordCount.toLocaleString()}</strong><span>Words preserved</span></article>
      <article class="stat-card"><strong>${mediaCount}</strong><span>Media files</span></article>
    </section>
    <section><header class="section-title-row"><div><p class="eyebrow">RECENTLY</p><h2>Your latest entries</h2></div>${state.library.entries.length > 6 ? '<button class="text-button" type="button" data-view="timeline">View complete timeline</button>' : ''}</header>
      ${recent.length ? `<div class="entry-list">${recent.map(entryCard).join('')}</div>` : emptyState('Your first entry starts here', 'Record video, speak, write or attach the pieces that make a moment worth keeping.')}
    </section>`;
}

function renderTimeline(entries = filteredEntries({ view: 'timeline' })) {
  const tools = activeFilterTools();
  const heading = state.dateFilter
    ? formatDate(new Date(`${state.dateFilter}T12:00:00`), { day: 'numeric', month: 'long', year: 'numeric' })
    : state.selectedJournalId ? journalById(state.selectedJournalId)?.name || 'Journal' : 'Timeline';
  if (!entries.length) return `${viewHeading('YOUR HISTORY', heading, 'Every entry appears here in chronological order.', tools)}${emptyState('No entries here yet', 'Choose another filter or preserve a new moment.')}`;

  const groups = new Map();
  entries.forEach(entry => {
    const key = localMonthKey(entry.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  const body = [...groups.entries()].map(([key, group]) => {
    const [year, month] = key.split('-').map(Number);
    const title = formatDate(new Date(year, month - 1, 1), { month: 'long', year: 'numeric' });
    return `<section class="timeline-group"><header><h2>${escapeHtml(title)}</h2><span></span><b>${group.length} ${group.length === 1 ? 'ENTRY' : 'ENTRIES'}</b></header><div class="entry-list">${group.map(entryCard).join('')}</div></section>`;
  }).join('');
  return `${viewHeading('YOUR HISTORY', heading, `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} in view.`, tools)}${body}`;
}

function calendarEntriesMap() {
  const map = new Map();
  const source = state.selectedJournalId
    ? state.library.entries.filter(entry => entry.journalId === state.selectedJournalId)
    : state.library.entries;
  source.forEach(entry => {
    const key = localDateKey(entry.createdAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  });
  return map;
}

function renderCalendar() {
  const cursor = state.calendarCursor;
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());
  const entriesMap = calendarEntriesMap();
  const days = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = localDateKey(date);
    const dayEntries = entriesMap.get(key) || [];
    const outside = date.getMonth() !== month;
    const isToday = key === localDateKey(new Date());
    const dots = dayEntries.slice(0, 5).map(entry => `<i style="--dot:${escapeAttribute(journalById(entry.journalId)?.colour || '#7c88a5')}"></i>`).join('');
    days.push(`<button type="button" class="calendar-day ${outside ? 'outside' : ''} ${isToday ? 'today' : ''}" data-date="${key}" aria-label="${escapeAttribute(formatDate(date, { dateStyle: 'full' }))}, ${dayEntries.length} entries"><span>${date.getDate()}</span><div class="calendar-dots">${dots}</div>${dayEntries.length ? `<b>${dayEntries.length}</b>` : ''}</button>`);
  }
  const title = formatDate(cursor, { month: 'long', year: 'numeric' });
  return `${viewHeading('CALENDAR', 'Every day in view', 'See the rhythm of your journal and open any date.', activeFilterTools())}
    <section class="calendar-shell">
      <header class="calendar-header"><h2>${escapeHtml(title)}</h2><div class="calendar-nav"><button class="icon-button" type="button" data-calendar-nav="-1" aria-label="Previous month">${icon('history')}</button><button class="secondary-button" type="button" data-calendar-nav="today">Today</button><button class="icon-button" type="button" data-calendar-nav="1" aria-label="Next month">${icon('refresh')}</button></div></header>
      <div class="calendar-weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
      <div class="calendar-grid">${days.join('')}</div>
    </section>`;
}

function renderMemories() {
  const entries = filteredEntries({ view: 'memories' });
  const title = formatDate(new Date(), { day: 'numeric', month: 'long' });
  return `${viewHeading('ON THIS DAY', title, 'Past entries from this calendar date return without changing them.', activeFilterTools())}
    ${entries.length ? `<div class="entry-list">${entries.map(entryCard).join('')}</div>` : emptyState('No earlier entries for today', 'Once your journal spans another year, memories from this date will appear here.', '')}`;
}

function mediaTile(attachment) {
  const entry = entryById(attachment.entryId);
  const url = makeObjectUrl(attachment.blob);
  let content = '';
  if (attachment.kind === 'image') content = `<img src="${url}" alt="" loading="lazy" />`;
  else if (attachment.kind === 'video') content = `<video src="${url}#t=0.1" muted playsinline preload="metadata"></video>`;
  else content = `<div class="file-tile">${icon(attachment.kind === 'audio' ? 'mic' : 'document')}<strong>${escapeHtml(attachment.name || 'Attachment')}</strong><small>${escapeHtml(formatBytes(attachment.size || attachment.blob?.size || 0))}</small></div>`;
  return `<button class="media-tile" type="button" data-action="open-media" data-attachment-id="${escapeAttribute(attachment.id)}">${content}<span class="tile-overlay"><strong>${escapeHtml(entry?.title || attachment.name || 'Journal media')}</strong><small>${entry ? escapeHtml(formatEntryDate(entry.createdAt)) : ''}</small></span></button>`;
}

function renderMedia() {
  const filters = ['all', 'image', 'video', 'audio', 'pdf', 'file'];
  let attachments = [...state.library.attachments];
  if (state.selectedJournalId) {
    const entryIds = new Set(state.library.entries.filter(entry => entry.journalId === state.selectedJournalId).map(entry => entry.id));
    attachments = attachments.filter(item => entryIds.has(item.entryId));
  }
  if (state.mediaFilter !== 'all') attachments = attachments.filter(item => item.kind === state.mediaFilter);
  attachments.sort((a, b) => (entryById(b.entryId)?.createdAt || b.createdAt) - (entryById(a.entryId)?.createdAt || a.createdAt));
  const toolbar = filters.map(filter => `<button type="button" class="${state.mediaFilter === filter ? 'active' : ''}" data-media-filter="${filter}">${filter === 'all' ? 'All media' : filter === 'pdf' ? 'PDFs' : `${filter[0].toUpperCase()}${filter.slice(1)}${filter === 'image' ? 's' : filter === 'file' ? 's' : ''}`}</button>`).join('');
  return `${viewHeading('MEDIA', 'The visual archive', `${attachments.length} ${attachments.length === 1 ? 'attachment' : 'attachments'} in view.`, activeFilterTools())}<div class="media-toolbar">${toolbar}</div>
    ${attachments.length ? `<div class="media-grid">${attachments.map(mediaTile).join('')}</div>` : emptyState('No media in this view', 'Record video or audio, or attach a photo, document or file to an entry.')}`;
}

function renderPlaces() {
  let entries = filteredEntries({ view: 'timeline' }).filter(entry => Number.isFinite(entry.location?.latitude) && Number.isFinite(entry.location?.longitude));
  const points = entries.map(entry => {
    const x = Math.max(1, Math.min(99, ((entry.location.longitude + 180) / 360) * 100));
    const y = Math.max(1, Math.min(99, ((90 - entry.location.latitude) / 180) * 100));
    const journal = journalById(entry.journalId);
    return `<button type="button" class="place-point" data-action="open-entry" data-entry-id="${escapeAttribute(entry.id)}" aria-label="${escapeAttribute(entry.location.label || entry.title || 'Journal place')}" style="left:${x}%;top:${y}%;--point:${escapeAttribute(journal?.colour || '#7c88a5')}"></button>`;
  }).join('');
  const cards = entries.slice(0, 12).map(entry => `<button type="button" class="place-card" data-action="open-entry" data-entry-id="${escapeAttribute(entry.id)}"><strong>${escapeHtml(entry.location.label || 'Unnamed place')}</strong><small>${escapeHtml(entry.title || formatEntryDate(entry.createdAt))}</small></button>`).join('');
  return `${viewHeading('PLACES', 'Where your life happened', 'Locations remain optional and are stored only with the entry.', activeFilterTools())}
    ${entries.length ? `<div class="places-map"><span class="map-label n">North</span><span class="map-label s">South</span><span class="map-label w">West</span><span class="map-label e">East</span>${points}</div><div class="places-list">${cards}</div>` : emptyState('No places recorded', 'Open an entry and use the location button only when a place matters to the memory.', '')}`;
}

function renderFavorites() {
  const entries = filteredEntries({ view: 'favorites' });
  return `${viewHeading('FAVOURITES', 'Moments worth returning to', `${entries.length} ${entries.length === 1 ? 'favourite' : 'favourites'} in view.`, activeFilterTools())}
    ${entries.length ? `<div class="entry-list">${entries.map(entryCard).join('')}</div>` : emptyState('No favourites yet', 'Use the star on an entry to keep important moments close.', '')}`;
}

function renderView() {
  revokeBucket(state.viewObjectUrls);
  let html;
  if (state.search) html = renderSearchResults();
  else if (state.view === 'today') html = renderToday();
  else if (state.view === 'timeline') html = renderTimeline();
  else if (state.view === 'calendar') html = renderCalendar();
  else if (state.view === 'memories') html = renderMemories();
  else if (state.view === 'media') html = renderMedia();
  else if (state.view === 'places') html = renderPlaces();
  else if (state.view === 'favorites') html = renderFavorites();
  el.viewRoot.innerHTML = html;
}

function renderAll() {
  renderSidebar();
  renderView();
  el.lockButton.hidden = !state.library.settings.lock;
}

function setView(view) {
  if (!VIEWS.has(view)) return;
  state.view = view;
  state.search = '';
  el.globalSearch.value = '';
  if (view !== 'timeline') state.dateFilter = '';
  renderAll();
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openSidebar() {
  document.body.classList.add('sidebar-open');
  el.sidebarScrim.hidden = false;
}

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
  el.sidebarScrim.hidden = true;
}

function populateEditorSelectors() {
  el.entryJournal.innerHTML = state.library.journals
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(journal => `<option value="${escapeAttribute(journal.id)}">${escapeHtml(journal.name)}</option>`).join('');
  el.templateSelect.innerHTML = `<option value="">None</option>${state.library.templates
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(template => `<option value="${escapeAttribute(template.id)}">${escapeHtml(template.name)}</option>`).join('')}`;
}

function getDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}

function writeDraft() {
  if (state.editorEntryId) return;
  const draft = {
    title: el.entryTitle.value,
    body: el.entryBody.value,
    journalId: el.entryJournal.value,
    date: el.entryDate.value,
    tags: el.entryTags.value,
    locationLabel: el.entryLocationLabel.value,
    favorite: el.entryFavorite.checked,
    mood: state.editorMood,
    savedAt: Date.now()
  };
  if (draft.title || draft.body || draft.tags || draft.locationLabel) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    el.draftState.textContent = 'Unsaved draft preserved locally';
  }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  el.draftState.textContent = 'Draft stays on this device';
}

function setEditorMood(mood = '') {
  state.editorMood = mood;
  el.moodPicker.querySelectorAll('[data-mood]').forEach(button => {
    button.classList.toggle('active', button.dataset.mood === mood);
    button.setAttribute('aria-checked', String(button.dataset.mood === mood));
  });
}

function renderAttachmentTray() {
  revokeBucket(state.editorObjectUrls);
  el.attachmentCount.textContent = `${state.editorAttachments.length} / ${MAX_ATTACHMENTS}`;
  el.attachmentTray.innerHTML = state.editorAttachments.map(attachment => {
    const url = makeObjectUrl(attachment.blob, state.editorObjectUrls);
    let preview;
    if (attachment.kind === 'image') preview = `<img src="${url}" alt="" />`;
    else if (attachment.kind === 'video') preview = `<video src="${url}#t=0.1" muted playsinline preload="metadata"></video>`;
    else preview = `<div class="attachment-file">${icon(attachment.kind === 'audio' ? 'mic' : 'document')}<span>${escapeHtml(attachment.name)}</span></div>`;
    const detail = attachment.durationMs ? `${formatDuration(attachment.durationMs)} · ` : '';
    const verb = attachment.kind === 'video' || attachment.kind === 'audio' ? 'Play' : 'Open';
    const label = `${verb} ${attachment.name || 'attachment'}`;
    return `<article class="attachment-item">
      <button class="attachment-open" type="button" data-action="open-media" data-attachment-id="${escapeAttribute(attachment.id)}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}">
        ${preview}
        <span class="attachment-label">${escapeHtml(detail + formatBytes(attachment.blob?.size || attachment.size || 0))}</span>
      </button>
      <button class="remove-attachment" type="button" data-remove-attachment="${escapeAttribute(attachment.id)}" aria-label="Remove ${escapeAttribute(attachment.name)}">${icon('close')}</button>
    </article>`;
  }).join('');
}

function restoreDraftIntoEditor() {
  const draft = getDraft();
  if (!draft) return false;
  el.entryTitle.value = draft.title || '';
  el.entryBody.value = draft.body || '';
  if (state.library.journals.some(journal => journal.id === draft.journalId)) el.entryJournal.value = draft.journalId;
  el.entryDate.value = draft.date || toDateInputValue(Date.now());
  el.entryTags.value = draft.tags || '';
  el.entryLocationLabel.value = draft.locationLabel || '';
  el.entryFavorite.checked = Boolean(draft.favorite);
  setEditorMood(draft.mood || '');
  el.draftState.textContent = 'Restored your unsaved local draft';
  return true;
}

function openEditor(entryId = null, initial = {}) {
  populateEditorSelectors();
  state.editorEntryId = entryId;
  state.editorAttachments = [];
  state.removedAttachmentIds = new Set();
  state.editorLocation = null;
  setEditorMood('');
  el.entryPreview.hidden = true;
  el.entryBody.hidden = false;
  el.previewToggle.classList.remove('active');
  el.previewToggle.querySelector('b').textContent = 'Preview';
  el.templateSelect.value = '';

  const entry = entryId ? entryById(entryId) : null;
  if (entry) {
    state.editorAttachments = attachmentsForEntry(entry.id).map(attachment => ({ ...attachment, existing: true }));
    state.editorLocation = entry.location ? { ...entry.location } : null;
    el.editorEyebrow.textContent = 'EDIT ENTRY';
    el.editorHeading.textContent = 'Return to this moment';
    el.entryTitle.value = entry.title || '';
    el.entryBody.value = entry.body || '';
    el.entryJournal.value = entry.journalId || state.library.journals[0]?.id || '';
    el.entryDate.value = toDateInputValue(entry.createdAt);
    el.entryTags.value = (entry.tags || []).join(', ');
    el.entryLocationLabel.value = entry.location?.label || '';
    el.locationStatus.textContent = entry.location?.latitude != null
      ? `${Number(entry.location.latitude).toFixed(5)}, ${Number(entry.location.longitude).toFixed(5)}`
      : 'No coordinates stored with this entry.';
    el.entryFavorite.checked = Boolean(entry.favorite);
    setEditorMood(entry.mood || '');
    el.deleteEntryButton.hidden = false;
    el.draftState.textContent = `Last updated ${formatTime(entry.updatedAt || entry.createdAt)}`;
  } else {
    el.editorEyebrow.textContent = 'NEW ENTRY';
    el.editorHeading.textContent = 'Capture this moment';
    el.entryTitle.value = initial.title || '';
    el.entryBody.value = initial.body || '';
    el.entryJournal.value = initial.journalId || state.selectedJournalId || state.library.journals.find(journal => journal.isDefault)?.id || state.library.journals[0]?.id || '';
    el.entryDate.value = toDateInputValue(initial.createdAt || Date.now());
    el.entryTags.value = initial.tags || '';
    el.entryLocationLabel.value = '';
    el.locationStatus.textContent = 'Location is added only when requested.';
    el.entryFavorite.checked = false;
    el.deleteEntryButton.hidden = true;
    el.draftState.textContent = 'Draft stays on this device';
    if (!initial.title && !initial.body) restoreDraftIntoEditor();
  }

  renderAttachmentTray();
  el.entryDialog.showModal();
  window.setTimeout(() => el.entryTitle.focus(), 50);
}

function closeEditor() {
  if (el.recorderDialog.open) closeRecorder(true);
  revokeBucket(state.editorObjectUrls);
  state.editorAttachments = [];
  state.removedAttachmentIds.clear();
  state.editorEntryId = null;
  if (el.entryDialog.open) el.entryDialog.close();
}

function insertFormatting(kind) {
  const textarea = el.entryBody;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  const formats = {
    bold: [`**`, `**`, 'bold text'],
    italic: [`*`, `*`, 'italic text'],
    heading: [`## `, ``, 'Heading'],
    list: [`- `, ``, 'List item'],
    quote: [`> `, ``, 'Quote']
  };
  const [before, after, fallback] = formats[kind] || ['', '', ''];
  const insertion = `${before}${selected || fallback}${after}`;
  textarea.setRangeText(insertion, start, end, 'end');
  textarea.focus();
  writeDraft();
}

function togglePreview() {
  const showing = !el.entryPreview.hidden;
  if (showing) {
    el.entryPreview.hidden = true;
    el.entryBody.hidden = false;
    el.previewToggle.classList.remove('active');
    el.previewToggle.querySelector('b').textContent = 'Preview';
    el.entryBody.focus();
  } else {
    el.entryPreview.innerHTML = renderMarkdown(el.entryBody.value || '*Nothing written yet.*');
    el.entryBody.hidden = true;
    el.entryPreview.hidden = false;
    el.previewToggle.classList.add('active');
    el.previewToggle.querySelector('b').textContent = 'Edit';
  }
}

async function mediaDuration(blob) {
  const kind = fileKind(blob.type);
  if (kind !== 'video' && kind !== 'audio') return 0;
  return new Promise(resolve => {
    const media = document.createElement(kind);
    const url = URL.createObjectURL(blob);
    const finish = value => { URL.revokeObjectURL(url); resolve(Number.isFinite(value) ? value * 1000 : 0); };
    media.preload = 'metadata';
    media.onloadedmetadata = () => finish(media.duration);
    media.onerror = () => finish(0);
    media.src = url;
  });
}

async function addFiles(fileList) {
  const files = [...fileList];
  const room = MAX_ATTACHMENTS - state.editorAttachments.length;
  if (room <= 0) return showToast(`Each entry can contain up to ${MAX_ATTACHMENTS} attachments.`);
  const accepted = files.slice(0, room);
  if (files.length > room) showToast(`Added ${room}; the entry limit is ${MAX_ATTACHMENTS} attachments.`);
  for (const file of accepted) {
    const kind = fileKind(file.type, file.name);
    const durationMs = await mediaDuration(file);
    state.editorAttachments.push({
      id: uid('media'),
      entryId: state.editorEntryId || '',
      name: file.name || `${kind}-${new Date().toISOString()}`,
      mimeType: file.type || 'application/octet-stream',
      kind,
      size: file.size,
      durationMs,
      createdAt: Date.now(),
      blob: file,
      pending: true
    });
  }
  renderAttachmentTray();
}

async function saveCurrentEntry() {
  const title = el.entryTitle.value.trim();
  const body = el.entryBody.value.trim();
  if (!title && !body && !state.editorAttachments.length) {
    showToast('Add text, a title or media before saving.');
    return false;
  }

  const existing = state.editorEntryId ? entryById(state.editorEntryId) : null;
  const id = existing?.id || uid('entry');
  const parsedDate = new Date(el.entryDate.value || Date.now());
  const createdAt = Number.isNaN(parsedDate.getTime()) ? (existing?.createdAt || Date.now()) : parsedDate.getTime();
  const locationLabel = el.entryLocationLabel.value.trim();
  const location = state.editorLocation
    ? { ...state.editorLocation, label: locationLabel || state.editorLocation.label || '' }
    : locationLabel ? { label: locationLabel } : null;
  const entry = {
    id,
    journalId: el.entryJournal.value || state.library.journals[0]?.id,
    title,
    body,
    tags: uniqueTags(el.entryTags.value),
    mood: state.editorMood,
    favorite: el.entryFavorite.checked,
    location,
    createdAt,
    updatedAt: Date.now()
  };
  const pendingAttachments = state.editorAttachments
    .filter(attachment => attachment.pending)
    .map(({ pending, existing: wasExisting, ...attachment }) => ({ ...attachment, entryId: id, size: attachment.blob?.size || attachment.size || 0 }));

  el.saveEntryButton.disabled = true;
  el.draftState.textContent = 'Saving privately…';
  try {
    await persistEntry(entry, pendingAttachments);
    await Promise.all([...state.removedAttachmentIds].map(deleteAttachment));
    clearDraft();
    await reloadLibrary();
    closeEditor();
    renderAll();
    showToast(existing ? 'Entry updated.' : 'Entry saved privately on this device.');
    return true;
  } catch (error) {
    console.error(error);
    const message = error?.name === 'QuotaExceededError'
      ? 'This browser has run out of local storage. Export your journal or remove older media.'
      : `Silver could not save the entry. ${error.message || ''}`.trim();
    showToast(message, 5200);
    el.draftState.textContent = 'Save failed — your text draft remains locally';
    return false;
  } finally {
    el.saveEntryButton.disabled = false;
  }
}

async function deleteCurrentEntry() {
  if (!state.editorEntryId) return;
  if (!confirm('Permanently delete this entry and every attached media file from this device?')) return;
  try {
    await removeEntry(state.editorEntryId);
    await reloadLibrary();
    closeEditor();
    renderAll();
    showToast('Entry deleted.');
  } catch (error) {
    console.error(error);
    showToast('The entry could not be deleted.');
  }
}

async function toggleFavorite(entryId) {
  const entry = entryById(entryId);
  if (!entry) return;
  await persistEntry({ ...entry, favorite: !entry.favorite, updatedAt: Date.now() });
  await reloadLibrary();
  renderAll();
}

async function shareEntry(entryId) {
  const entry = entryById(entryId);
  if (!entry) return;
  const text = [entry.title, stripMarkdown(entry.body), entry.tags?.length ? `#${entry.tags.join(' #')}` : ''].filter(Boolean).join('\n\n');
  try {
    if (navigator.share) await navigator.share({ title: entry.title || 'Silver journal entry', text });
    else {
      await navigator.clipboard.writeText(text);
      showToast('Entry text copied to the clipboard.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') showToast('This browser could not share the entry.');
  }
}

async function exportEntry(entryId) {
  const entry = entryById(entryId);
  if (!entry) return;
  const journal = journalById(entry.journalId);
  const collection = state.library.collections.find(item => item.id === journal?.collectionId);
  const subset = {
    collections: collection ? [collection] : [],
    journals: journal ? [journal] : [],
    entries: [entry],
    attachments: attachmentsForEntry(entryId),
    templates: [],
    settings: {}
  };
  const safeTitle = (entry.title || 'entry').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'entry';
  const { blob, fileName } = await createSilverArchive(subset, `silver-${safeTitle}.silver`);
  downloadBlob(blob, fileName);
  showToast('Entry exported with its original media.');
}

function printEntry(entryId) {
  const entry = entryById(entryId);
  if (!entry) return;
  const journal = journalById(entry.journalId);
  const attachments = attachmentsForEntry(entryId);
  const printWindow = window.open('', '_blank');
  if (!printWindow) return showToast('Allow pop-ups to print this entry.');
  printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(entry.title || 'Silver entry')}</title><style>body{max-width:760px;margin:60px auto;padding:0 24px;font:17px/1.65 Georgia,serif;color:#202226}small{font:12px system-ui;color:#666}h1{font-size:42px;line-height:1.1}article h2,article h3{margin-top:28px}blockquote{border-left:3px solid #999;padding-left:18px;color:#555}.media{margin-top:35px;padding-top:20px;border-top:1px solid #ddd;font:12px system-ui}</style></head><body><small>${escapeHtml(formatEntryDate(entry.createdAt))} · ${escapeHtml(formatTime(entry.createdAt))} · ${escapeHtml(journal?.name || 'Journal')}</small><h1>${escapeHtml(entry.title || 'Untitled entry')}</h1><article>${renderMarkdown(entry.body || '<em>No written text.</em>')}</article><div class="media">${attachments.length} attached media file${attachments.length === 1 ? '' : 's'}: ${attachments.map(item => escapeHtml(item.name)).join(', ')}</div></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
}

function openMediaViewer(attachmentId) {
  const attachment = attachmentById(attachmentId) || state.editorAttachments.find(item => item.id === attachmentId);
  if (!attachment) return;
  if (state.viewerObjectUrl) URL.revokeObjectURL(state.viewerObjectUrl);
  state.viewerObjectUrl = URL.createObjectURL(attachment.blob);
  state.mediaViewerAttachmentId = attachment.id;
  el.mediaViewerType.textContent = attachment.kind.toUpperCase();
  el.mediaViewerTitle.textContent = attachment.name || 'Attachment';
  if (attachment.kind === 'image') el.mediaViewerBody.innerHTML = `<img src="${state.viewerObjectUrl}" alt="${escapeAttribute(attachment.name || '')}" />`;
  else if (attachment.kind === 'video') el.mediaViewerBody.innerHTML = `<video src="${state.viewerObjectUrl}" controls autoplay playsinline></video>`;
  else if (attachment.kind === 'audio') el.mediaViewerBody.innerHTML = `<audio src="${state.viewerObjectUrl}" controls autoplay></audio>`;
  else if (attachment.kind === 'pdf') el.mediaViewerBody.innerHTML = `<iframe src="${state.viewerObjectUrl}" title="${escapeAttribute(attachment.name || 'PDF')}"></iframe>`;
  else el.mediaViewerBody.innerHTML = `<div class="generic-file">${icon('document')}<strong>${escapeHtml(attachment.name || 'File')}</strong><span>${escapeHtml(formatBytes(attachment.blob?.size || attachment.size || 0))}</span></div>`;
  el.openMediaEntryButton.hidden = !entryById(attachment.entryId);
  el.mediaDialog.showModal();
  const playable = el.mediaViewerBody.querySelector('video, audio');
  if (playable) {
    playable.addEventListener('error', () => {
      showToast('This browser could not play this recording format. The original file is still available to download.', 5200);
    }, { once: true });
    playable.play().catch(() => { /* Native controls remain available when autoplay is restricted. */ });
  }
}

function closeMediaViewer() {
  if (state.viewerObjectUrl) URL.revokeObjectURL(state.viewerObjectUrl);
  state.viewerObjectUrl = '';
  state.mediaViewerAttachmentId = null;
  el.mediaViewerBody.replaceChildren();
  if (el.mediaDialog.open) el.mediaDialog.close();
}

function downloadViewedMedia() {
  const attachment = attachmentById(state.mediaViewerAttachmentId) || state.editorAttachments.find(item => item.id === state.mediaViewerAttachmentId);
  if (!attachment) return;
  downloadBlob(attachment.blob, attachment.name || `silver-media.${fileExtension(attachment.mimeType, attachment.kind)}`);
}

function chooseMimeType(mode) {
  if (!window.MediaRecorder?.isTypeSupported) return '';
  const candidates = mode === 'video'
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function setRecorderMessage(message, kind = '') {
  el.recorderMessage.textContent = message;
  el.recorderMessage.className = `recorder-message${kind ? ` ${kind}` : ''}`;
}

function stopRecorderTracks() {
  recorder.stream?.getTracks().forEach(track => track.stop());
  recorder.stream = null;
  el.recorderPreview.srcObject = null;
}

function stopRecognition() {
  try { recorder.recognition?.stop(); } catch { /* already stopped */ }
  recorder.recognition = null;
}

function resetRecorderUi() {
  clearInterval(recorder.timer);
  recorder.timer = 0;
  recorder.instance = null;
  recorder.chunks = [];
  recorder.startedAt = 0;
  recorder.pausedAt = 0;
  recorder.pausedTotal = 0;
  el.recordingBadge.hidden = true;
  el.recordingClock.textContent = '00:00';
  el.startRecorderButton.hidden = true;
  el.pauseRecorderButton.hidden = true;
  el.finishRecorderButton.hidden = true;
  el.flipCameraButton.hidden = true;
  el.prepareRecorderButton.hidden = false;
  el.recorderIdle.hidden = false;
  el.audioOrb.hidden = true;
  el.transcriptPanel.hidden = true;
  el.liveTranscript.textContent = '';
  recorder.transcript = '';
}

function openRecorder(mode) {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    showToast('This browser does not support direct recording. You can still attach an existing media file.');
    return;
  }
  recorder.mode = mode;
  recorder.discarding = false;
  recorder.facingMode = 'user';
  resetRecorderUi();
  el.recorderEyebrow.textContent = mode === 'video' ? 'VIDEO REFLECTION' : 'AUDIO REFLECTION';
  el.recorderHeading.textContent = mode === 'video' ? 'Record without interruption' : 'Speak while the thought is alive';
  el.prepareRecorderButton.innerHTML = `${icon(mode === 'video' ? 'video' : 'mic')}${mode === 'video' ? 'Turn on camera' : 'Turn on microphone'}`;
  setRecorderMessage('Permission will be requested from your browser.');
  el.recorderDialog.showModal();
}

async function prepareRecorder() {
  stopRecorderTracks();
  el.prepareRecorderButton.disabled = true;
  setRecorderMessage(recorder.mode === 'video' ? 'Waiting for camera and microphone permission…' : 'Waiting for microphone permission…');
  try {
    const constraints = recorder.mode === 'video'
      ? {
          video: { facingMode: { ideal: recorder.facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        }
      : { video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    recorder.stream = await navigator.mediaDevices.getUserMedia(constraints);
    el.recorderIdle.hidden = true;
    if (recorder.mode === 'video') {
      el.recorderPreview.srcObject = recorder.stream;
      await el.recorderPreview.play().catch(() => {});
      el.audioOrb.hidden = true;
      el.flipCameraButton.hidden = false;
    } else {
      el.audioOrb.hidden = false;
    }
    el.prepareRecorderButton.hidden = true;
    el.startRecorderButton.hidden = false;
    setRecorderMessage('Ready. Nothing is stored until you finish the recording.', 'success');
  } catch (error) {
    console.error(error);
    const message = error.name === 'NotAllowedError'
      ? 'Camera or microphone access was declined. Change this site’s browser permissions and try again.'
      : error.name === 'NotFoundError'
        ? `No available ${recorder.mode === 'video' ? 'camera or microphone' : 'microphone'} was found.`
        : error.name === 'NotReadableError'
          ? 'The recording device is already being used by another application.'
          : `The ${recorder.mode === 'video' ? 'camera' : 'microphone'} could not be opened.`;
    setRecorderMessage(message, 'error');
    resetRecorderUi();
  } finally {
    el.prepareRecorderButton.disabled = false;
  }
}

function startLiveTranscript() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;
  try {
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || navigator.language || 'en-AU';
    let finalText = '';
    recognition.onresult = event => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalText += `${text.trim()} `;
        else interim += text;
      }
      recorder.transcript = `${finalText}${interim}`.trim();
      el.liveTranscript.textContent = recorder.transcript || 'Listening…';
      el.transcriptPanel.hidden = false;
    };
    recognition.onerror = () => { /* Recording remains usable without transcription. */ };
    recognition.onend = () => {
      if (recorder.instance?.state === 'recording') {
        try { recognition.start(); } catch { /* browser refused restart */ }
      }
    };
    recognition.start();
    recorder.recognition = recognition;
  } catch { /* Optional browser capability. */ }
}

function updateRecorderClock() {
  if (!recorder.startedAt) return;
  const paused = recorder.pausedAt ? Date.now() - recorder.pausedAt : 0;
  const elapsed = Date.now() - recorder.startedAt - recorder.pausedTotal - paused;
  el.recordingClock.textContent = formatDuration(elapsed);
}

function startRecording() {
  if (!recorder.stream) return;
  try {
    const mimeType = chooseMimeType(recorder.mode);
    recorder.instance = new MediaRecorder(recorder.stream, mimeType ? { mimeType } : undefined);
    recorder.chunks = [];
    recorder.instance.ondataavailable = event => { if (event.data?.size) recorder.chunks.push(event.data); };
    recorder.instance.onerror = event => setRecorderMessage(event.error?.message || 'The recording device reported an error.', 'error');
    recorder.instance.onstop = finalizeRecording;
    recorder.instance.start(1000);
    recorder.startedAt = Date.now();
    recorder.pausedTotal = 0;
    recorder.pausedAt = 0;
    updateRecorderClock();
    recorder.timer = window.setInterval(updateRecorderClock, 250);
    el.recordingBadge.hidden = false;
    el.startRecorderButton.hidden = true;
    el.prepareRecorderButton.hidden = true;
    el.flipCameraButton.hidden = true;
    el.pauseRecorderButton.hidden = false;
    el.finishRecorderButton.hidden = false;
    setRecorderMessage('Recording now. There is no fixed duration limit; available device storage is the practical limit.');
    startLiveTranscript();
  } catch (error) {
    console.error(error);
    setRecorderMessage('This browser could not begin recording with the selected format.', 'error');
  }
}

function togglePauseRecording() {
  if (!recorder.instance) return;
  if (recorder.instance.state === 'recording') {
    recorder.instance.pause();
    recorder.pausedAt = Date.now();
    el.pauseRecorderButton.textContent = 'Resume';
    setRecorderMessage('Recording paused.');
    stopRecognition();
  } else if (recorder.instance.state === 'paused') {
    recorder.instance.resume();
    recorder.pausedTotal += Date.now() - recorder.pausedAt;
    recorder.pausedAt = 0;
    el.pauseRecorderButton.textContent = 'Pause';
    setRecorderMessage('Recording resumed.');
    startLiveTranscript();
  }
}

function finishRecording() {
  if (!recorder.instance || !['recording', 'paused'].includes(recorder.instance.state)) return;
  el.finishRecorderButton.disabled = true;
  setRecorderMessage('Finalising the recording…');
  recorder.instance.stop();
}

async function finalizeRecording() {
  clearInterval(recorder.timer);
  stopRecognition();
  const paused = recorder.pausedAt ? Date.now() - recorder.pausedAt : 0;
  const durationMs = Math.max(1, Date.now() - recorder.startedAt - recorder.pausedTotal - paused);
  const mimeType = recorder.instance?.mimeType || recorder.chunks[0]?.type || (recorder.mode === 'video' ? 'video/webm' : 'audio/webm');
  const blob = new Blob(recorder.chunks, { type: mimeType });
  const transcript = recorder.transcript;
  stopRecorderTracks();
  el.finishRecorderButton.disabled = false;

  if (!recorder.discarding && blob.size) {
    const extension = fileExtension(mimeType, recorder.mode);
    state.editorAttachments.push({
      id: uid('media'),
      entryId: state.editorEntryId || '',
      name: `${recorder.mode}-reflection-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.${extension}`,
      mimeType,
      kind: recorder.mode,
      size: blob.size,
      durationMs,
      createdAt: Date.now(),
      blob,
      pending: true
    });
    renderAttachmentTray();
    if (transcript) {
      const spacer = el.entryBody.value.trim() ? '\n\n' : '';
      el.entryBody.value += `${spacer}## Transcript\n\n${transcript}`;
      writeDraft();
    }
    showToast(`${recorder.mode === 'video' ? 'Video' : 'Audio'} added to this entry. Save the entry to keep it.`);
  }
  resetRecorderUi();
  if (el.recorderDialog.open) el.recorderDialog.close();
}

function closeRecorder(forceDiscard = false) {
  const active = recorder.instance && ['recording', 'paused'].includes(recorder.instance.state);
  if (active && !forceDiscard && !confirm('Discard the recording currently in progress?')) return;
  recorder.discarding = true;
  if (active) recorder.instance.stop();
  else {
    stopRecognition();
    stopRecorderTracks();
    resetRecorderUi();
    if (el.recorderDialog.open) el.recorderDialog.close();
  }
}

async function flipCamera() {
  if (recorder.instance) return;
  recorder.facingMode = recorder.facingMode === 'user' ? 'environment' : 'user';
  await prepareRecorder();
}

function appendTranscript() {
  if (!recorder.transcript) return;
  const spacer = el.entryBody.value.trim() ? '\n\n' : '';
  el.entryBody.value += `${spacer}## Live transcript\n\n${recorder.transcript}`;
  writeDraft();
  showToast('Transcript added to the written entry.');
}

async function locateEntry() {
  if (!navigator.geolocation) return showToast('Location is not supported by this browser.');
  el.locateButton.disabled = true;
  el.locationStatus.textContent = 'Requesting your current location…';
  navigator.geolocation.getCurrentPosition(
    position => {
      state.editorLocation = {
        latitude: Number(position.coords.latitude.toFixed(6)),
        longitude: Number(position.coords.longitude.toFixed(6)),
        accuracy: Math.round(position.coords.accuracy),
        capturedAt: Date.now(),
        label: el.entryLocationLabel.value.trim()
      };
      el.locationStatus.textContent = `${state.editorLocation.latitude.toFixed(5)}, ${state.editorLocation.longitude.toFixed(5)} · accuracy ±${state.editorLocation.accuracy}m`;
      el.locateButton.disabled = false;
      writeDraft();
    },
    error => {
      el.locationStatus.textContent = error.code === 1 ? 'Location permission was declined.' : 'Current location could not be determined.';
      el.locateButton.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }
  );
}

async function saveCurrentTextAsTemplate() {
  const body = el.entryBody.value.trim();
  if (!body) return showToast('Write the reusable structure before saving a template.');
  const name = prompt('Template name');
  if (!name?.trim()) return;
  await saveTemplate({ id: uid('template'), name: name.trim().slice(0, 80), body, createdAt: Date.now(), builtIn: false });
  await reloadLibrary();
  populateEditorSelectors();
  renderTemplateManager();
  showToast('Template saved.');
}

function openSettings(tab = 'general') {
  el.themeSelect.value = state.library.settings.theme || 'system';
  el.reminderTime.value = state.library.settings.reminderTime || '';
  el.autoLockSelect.value = String(state.library.settings.autoLockMinutes || 0);
  el.removePasscodeButton.hidden = !state.library.settings.lock;
  el.newPasscode.value = '';
  el.confirmPasscode.value = '';
  switchSettingsTab(tab);
  renderJournalManager();
  renderTemplateManager();
  updateStorageEstimate();
  el.settingsDialog.showModal();
}

function switchSettingsTab(tab) {
  document.querySelectorAll('[data-settings-tab]').forEach(button => button.classList.toggle('active', button.dataset.settingsTab === tab));
  document.querySelectorAll('[data-settings-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.settingsPanel === tab));
}

function renderJournalManager() {
  const entries = state.library.entries;
  const collections = [...state.library.collections].sort((a, b) => a.name.localeCompare(b.name));
  const collectionRows = collections.map(collection => {
    const count = state.library.journals.filter(journal => journal.collectionId === collection.id).length;
    return `<article class="manager-item"><span class="journal-dot" style="--journal-colour:var(--faint)"></span><div class="manager-copy"><strong>${escapeHtml(collection.name)}</strong><small>Collection · ${count} ${count === 1 ? 'journal' : 'journals'}</small></div><button class="icon-button" type="button" data-action="rename-collection" data-collection-id="${escapeAttribute(collection.id)}" aria-label="Rename collection">${icon('edit')}</button><button class="icon-button" type="button" data-action="delete-collection" data-collection-id="${escapeAttribute(collection.id)}" aria-label="Delete collection">${icon('trash')}</button></article>`;
  }).join('');
  const journalRows = [...state.library.journals].sort((a, b) => a.name.localeCompare(b.name)).map(journal => {
    const collection = state.library.collections.find(item => item.id === journal.collectionId);
    const count = entries.filter(entry => entry.journalId === journal.id).length;
    return `<article class="manager-item"><span class="journal-dot" style="--journal-colour:${escapeAttribute(journal.colour || '#7c88a5')}"></span><div class="manager-copy"><strong>${escapeHtml(journal.name)}</strong><small>${collection ? escapeHtml(collection.name) : 'No collection'} · ${count} ${count === 1 ? 'entry' : 'entries'}</small></div><button class="icon-button" type="button" data-action="edit-journal" data-journal-id="${escapeAttribute(journal.id)}" aria-label="Edit journal">${icon('edit')}</button></article>`;
  }).join('');
  el.journalManager.innerHTML = `${collectionRows ? `<p class="eyebrow">COLLECTIONS</p>${collectionRows}` : ''}<p class="eyebrow" style="margin-top:12px">JOURNALS</p>${journalRows}`;
}

function renderTemplateManager() {
  el.templateManager.innerHTML = [...state.library.templates].sort((a, b) => a.name.localeCompare(b.name)).map(template => `<article class="manager-item"><span class="journal-dot" style="--journal-colour:var(--accent)"></span><div class="manager-copy"><strong>${escapeHtml(template.name)}</strong><small>${template.builtIn ? 'Built-in' : 'Personal'} · ${stripMarkdown(template.body).split(/\s+/).filter(Boolean).length} words</small></div><button class="icon-button" type="button" data-action="delete-template" data-template-id="${escapeAttribute(template.id)}" aria-label="Delete template">${icon('trash')}</button></article>`).join('') || '<p>No templates yet.</p>';
}

function openJournalDialog(journalId = null) {
  state.editingJournalId = journalId;
  const journal = journalId ? journalById(journalId) : null;
  el.journalDialogTitle.textContent = journal ? 'Edit journal' : 'Create journal';
  el.journalName.value = journal?.name || '';
  el.journalCollection.innerHTML = `<option value="">No collection</option>${state.library.collections.map(collection => `<option value="${escapeAttribute(collection.id)}">${escapeHtml(collection.name)}</option>`).join('')}`;
  el.journalCollection.value = journal?.collectionId || '';
  const colour = journal?.colour || '#7c88a5';
  const radio = el.journalColours.querySelector(`input[value="${CSS.escape(colour)}"]`) || el.journalColours.querySelector('input');
  if (radio) radio.checked = true;
  el.deleteJournalButton.hidden = !journal;
  el.journalDialog.showModal();
  window.setTimeout(() => el.journalName.focus(), 50);
}

async function persistJournalFromDialog() {
  const name = el.journalName.value.trim();
  if (!name) return false;
  const existing = state.editingJournalId ? journalById(state.editingJournalId) : null;
  const colour = el.journalColours.querySelector('input:checked')?.value || '#7c88a5';
  await saveJournal({
    id: existing?.id || uid('journal'),
    name: name.slice(0, 80),
    colour,
    collectionId: el.journalCollection.value || '',
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    isDefault: existing?.isDefault || state.library.journals.length === 0
  });
  await reloadLibrary();
  renderAll();
  renderJournalManager();
  el.journalDialog.close();
  showToast(existing ? 'Journal updated.' : 'Journal created.');
  return true;
}

async function removeCurrentJournal() {
  const journal = state.editingJournalId ? journalById(state.editingJournalId) : null;
  if (!journal) return;
  if (state.library.journals.length <= 1) return showToast('Silver must keep at least one journal.');
  const fallback = state.library.journals.find(item => item.id !== journal.id && item.isDefault) || state.library.journals.find(item => item.id !== journal.id);
  const count = state.library.entries.filter(entry => entry.journalId === journal.id).length;
  if (!confirm(`Delete “${journal.name}”? ${count ? `${count} existing ${count === 1 ? 'entry' : 'entries'} will move to “${fallback.name}”.` : 'It contains no entries.'}`)) return;
  await deleteJournal(journal.id, fallback.id);
  if (state.selectedJournalId === journal.id) state.selectedJournalId = '';
  await reloadLibrary();
  el.journalDialog.close();
  renderAll();
  renderJournalManager();
  showToast('Journal deleted. Existing entries were preserved.');
}

async function addNewCollection() {
  const name = el.newCollectionName.value.trim();
  if (!name) return;
  await saveCollection({ id: uid('collection'), name: name.slice(0, 80), createdAt: Date.now(), updatedAt: Date.now() });
  el.newCollectionName.value = '';
  await reloadLibrary();
  renderAll();
  renderJournalManager();
  showToast('Collection added.');
}

async function renameCollectionById(collectionId) {
  const collection = state.library.collections.find(item => item.id === collectionId);
  if (!collection) return;
  const name = prompt('Collection name', collection.name);
  if (!name?.trim()) return;
  await saveCollection({ ...collection, name: name.trim().slice(0, 80), updatedAt: Date.now() });
  await reloadLibrary();
  renderAll();
  renderJournalManager();
}

async function removeCollectionById(collectionId) {
  const collection = state.library.collections.find(item => item.id === collectionId);
  if (!collection) return;
  if (!confirm(`Delete the “${collection.name}” collection? Its journals and entries will remain.`)) return;
  await deleteCollection(collectionId);
  await reloadLibrary();
  renderAll();
  renderJournalManager();
}

async function removeTemplateById(templateId) {
  const template = state.library.templates.find(item => item.id === templateId);
  if (!template || !confirm(`Delete the “${template.name}” template? Existing entries will not change.`)) return;
  await deleteTemplate(templateId);
  await reloadLibrary();
  renderTemplateManager();
  populateEditorSelectors();
  showToast('Template deleted.');
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function derivePasscodeHash(passcode, salt, iterations = 250_000) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256);
  return new Uint8Array(bits);
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function setPasscode() {
  if (!crypto.subtle) return showToast('Secure passcode hashing is unavailable in this browser.');
  const passcode = el.newPasscode.value;
  const confirmation = el.confirmPasscode.value;
  if (passcode.length < 4) return showToast('Use at least four characters for the local passcode.');
  if (passcode !== confirmation) return showToast('The two passcodes do not match.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 250_000;
  el.setPasscodeButton.disabled = true;
  try {
    const hash = await derivePasscodeHash(passcode, salt, iterations);
    const lock = { salt: bytesToBase64(salt), hash: bytesToBase64(hash), iterations };
    await saveSetting('lock', lock);
    state.library.settings.lock = lock;
    el.newPasscode.value = '';
    el.confirmPasscode.value = '';
    el.removePasscodeButton.hidden = false;
    el.lockButton.hidden = false;
    showToast('Local app lock enabled. Browser storage itself remains unencrypted.');
  } finally {
    el.setPasscodeButton.disabled = false;
  }
}

async function verifyPasscode(passcode) {
  const lock = state.library.settings.lock;
  if (!lock) return true;
  const hash = await derivePasscodeHash(passcode, base64ToBytes(lock.salt), lock.iterations || 250_000);
  return equalBytes(hash, base64ToBytes(lock.hash));
}

async function removePasscodeSetting() {
  const current = prompt('Enter the current Silver passcode to remove the lock.');
  if (current == null) return;
  if (!(await verifyPasscode(current))) return showToast('That passcode was incorrect.');
  await removeSetting('lock');
  delete state.library.settings.lock;
  el.removePasscodeButton.hidden = true;
  el.lockButton.hidden = true;
  showToast('App lock removed from this browser.');
}

function lockNow(showMessage = true) {
  if (!state.library.settings.lock) return;
  closeSidebar();
  if (el.entryDialog.open) closeEditor();
  if (el.settingsDialog.open) el.settingsDialog.close();
  state.locked = true;
  el.lockScreen.hidden = false;
  el.unlockPasscode.value = '';
  el.lockError.textContent = showMessage ? 'Silver locked.' : '';
  window.setTimeout(() => el.unlockPasscode.focus(), 50);
}

async function unlock(event) {
  event.preventDefault();
  el.lockError.textContent = 'Checking…';
  try {
    if (await verifyPasscode(el.unlockPasscode.value)) {
      state.locked = false;
      state.lastActivity = Date.now();
      el.lockScreen.hidden = true;
      el.lockError.textContent = '';
      el.unlockPasscode.value = '';
      handlePendingLaunchAction();
    } else {
      el.lockError.textContent = 'Incorrect passcode.';
      el.unlockPasscode.select();
    }
  } catch {
    el.lockError.textContent = 'Silver could not verify the passcode in this browser.';
  }
}

async function exportCompleteLibrary() {
  el.exportLibraryButton.disabled = true;
  el.exportLibraryButton.textContent = 'Preparing archive…';
  try {
    const { blob, fileName } = await createSilverArchive(state.library);
    downloadBlob(blob, fileName);
    showToast(`Complete archive ready · ${formatBytes(blob.size)}`);
  } catch (error) {
    console.error(error);
    showToast(`Archive could not be created. ${error.message || ''}`.trim(), 5200);
  } finally {
    el.exportLibraryButton.disabled = false;
    el.exportLibraryButton.innerHTML = `${icon('download')}Export complete .silver archive`;
  }
}

async function importArchive(file) {
  if (!file) return;
  el.importLibraryInput.disabled = true;
  showToast('Reading the Silver archive…', 6000);
  try {
    const imported = await parseSilverArchive(file);
    const count = imported.entries.length;
    if (!confirm(`Import ${count} ${count === 1 ? 'entry' : 'entries'} and ${imported.attachments.length} media files? Matching IDs will be updated; existing unrelated entries remain.`)) return;
    await importLibrary(imported, { replace: false });
    await reloadLibrary();
    applyTheme();
    renderAll();
    renderJournalManager();
    renderTemplateManager();
    updateStorageEstimate();
    showToast(`Imported ${count} ${count === 1 ? 'entry' : 'entries'} successfully.`);
  } catch (error) {
    console.error(error);
    showToast(`Import failed. ${error.message || 'The archive could not be read.'}`, 6000);
  } finally {
    el.importLibraryInput.disabled = false;
    el.importLibraryInput.value = '';
  }
}

function exportReadableText() {
  const text = createReadableText(state.library);
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `silver-readable-${new Date().toISOString().slice(0, 10)}.txt`);
  showToast('Readable text export created. Original media remains in the .silver archive.');
}

async function wipeAllData() {
  const confirmation = prompt('This permanently deletes every local entry and media file. Type ERASE to continue.');
  if (confirmation !== 'ERASE') return;
  await eraseLibrary();
  clearDraft();
  state.library = await ensureSeedData();
  state.selectedJournalId = '';
  state.search = '';
  state.dateFilter = '';
  applyTheme();
  renderAll();
  renderJournalManager();
  renderTemplateManager();
  updateStorageEstimate();
  if (el.settingsDialog.open) el.settingsDialog.close();
  showToast('All local journal data was erased.');
}

async function updateStorageEstimate() {
  if (!navigator.storage?.estimate) {
    el.storageUsage.textContent = 'Unavailable';
    el.storageDetail.textContent = 'This browser does not expose a storage estimate.';
    el.storageStatus.textContent = 'Private browser database';
    return;
  }
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const percent = quota ? Math.min(100, (usage / quota) * 100) : 0;
    el.storageUsage.textContent = `${formatBytes(usage)} of ${formatBytes(quota)}`;
    el.storageMeter.style.width = `${percent}%`;
    el.storageDetail.textContent = `${percent.toFixed(1)}% of the storage currently granted to this browser origin is in use.`;
    const persisted = await navigator.storage.persisted?.();
    el.storageStatus.textContent = `${formatBytes(usage)} used${persisted ? ' · persistent' : ''}`;
  } catch {
    el.storageUsage.textContent = 'Unavailable';
    el.storageDetail.textContent = 'The browser declined a storage estimate.';
  }
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return showToast('Persistent storage cannot be requested in this browser.');
  const granted = await navigator.storage.persist();
  showToast(granted ? 'The browser granted persistent local storage.' : 'The browser did not grant persistence. Export regular backups to protect your journal.');
  updateStorageEstimate();
}

async function enableNotifications() {
  if (!('Notification' in window)) return showToast('Notifications are unavailable in this browser.');
  const permission = await Notification.requestPermission();
  showToast(permission === 'granted' ? 'Journal reminders enabled for this browser.' : 'Notification permission was not granted.');
}

async function showReminder() {
  const title = 'A moment for Silver';
  const options = { body: promptForToday(), icon: './icons/silver-mark.svg', tag: `silver-${localDateKey(new Date())}` };
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.showNotification && Notification.permission === 'granted') await registration.showNotification(title, options);
    else if (Notification.permission === 'granted') new Notification(title, options);
    else showToast(`${title}: ${options.body}`, 7000);
  } catch { showToast(`${title}: ${options.body}`, 7000); }
}

function checkReminder() {
  if (state.locked) return;
  const reminderTime = state.library?.settings?.reminderTime;
  if (!reminderTime) return;
  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const key = `silver-reminded-${localDateKey(now)}`;
  if (current === reminderTime && !localStorage.getItem(key)) {
    localStorage.setItem(key, '1');
    showReminder();
  }
}

function checkAutoLock() {
  if (state.locked || !state.library?.settings?.lock) return;
  const minutes = Number(state.library.settings.autoLockMinutes || 0);
  if (minutes > 0 && Date.now() - state.lastActivity >= minutes * 60_000) lockNow(false);
}

function noteActivity() {
  if (!state.locked) state.lastActivity = Date.now();
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try { await navigator.serviceWorker.register('./sw.js', { scope: './' }); } catch (error) { console.warn('Service worker registration failed:', error); }
}

function handleLaunchParameters() {
  const params = new URLSearchParams(location.search);
  const sharedTitle = params.get('title') || '';
  const sharedText = params.get('text') || '';
  const sharedUrl = params.get('url') || '';
  const newMode = params.get('new');
  if (sharedTitle || sharedText || sharedUrl) {
    state.pendingLaunchAction = { type: 'entry', initial: { title: sharedTitle, body: [sharedText, sharedUrl].filter(Boolean).join('\n\n') } };
  } else if (newMode) {
    state.pendingLaunchAction = { type: 'entry', recorder: newMode === 'video' ? 'video' : null };
  }
  history.replaceState({}, '', location.pathname + location.hash);
  handlePendingLaunchAction();
}

function handlePendingLaunchAction() {
  if (state.locked || !state.pendingLaunchAction) return;
  const action = state.pendingLaunchAction;
  state.pendingLaunchAction = null;
  if (action.type === 'entry') {
    openEditor(null, action.initial || {});
    if (action.recorder) window.setTimeout(() => openRecorder(action.recorder), 150);
  }
}

function bindEvents() {
  el.menuButton.addEventListener('click', openSidebar);
  el.sidebarClose.addEventListener('click', closeSidebar);
  el.sidebarScrim.addEventListener('click', closeSidebar);
  el.newEntryButton.addEventListener('click', () => openEditor());
  el.addJournalButton.addEventListener('click', () => openJournalDialog());
  el.settingsButton.addEventListener('click', () => openSettings());
  el.settingsAddJournal.addEventListener('click', () => openJournalDialog());
  el.lockButton.addEventListener('click', () => lockNow());
  el.globalSearch.addEventListener('input', event => {
    state.search = event.target.value.trim().normalize('NFKD').toLowerCase();
    state.dateFilter = '';
    renderSidebar();
    renderView();
  });

  document.addEventListener('click', async event => {
    const viewButton = (event.target instanceof Element ? event.target : null)?.closest('[data-view]');
    if (viewButton) return setView(viewButton.dataset.view);

    const journalButton = (event.target instanceof Element ? event.target : null)?.closest('[data-journal-id]');
    if (journalButton && !journalButton.closest('#journalManager')) {
      state.selectedJournalId = journalButton.dataset.journalId || '';
      state.dateFilter = '';
      if (state.view === 'today') state.view = 'timeline';
      renderAll();
      closeSidebar();
      return;
    }

    const clearFilter = (event.target instanceof Element ? event.target : null)?.closest('[data-clear-filter]');
    if (clearFilter) {
      if (clearFilter.dataset.clearFilter === 'journal') state.selectedJournalId = '';
      if (clearFilter.dataset.clearFilter === 'date') state.dateFilter = '';
      renderAll();
      return;
    }

    const dateButton = (event.target instanceof Element ? event.target : null)?.closest('[data-date]');
    if (dateButton) {
      state.dateFilter = dateButton.dataset.date;
      state.view = 'timeline';
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const calendarNav = (event.target instanceof Element ? event.target : null)?.closest('[data-calendar-nav]');
    if (calendarNav) {
      if (calendarNav.dataset.calendarNav === 'today') state.calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      else state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() + Number(calendarNav.dataset.calendarNav), 1);
      renderView();
      return;
    }

    const mediaFilter = (event.target instanceof Element ? event.target : null)?.closest('[data-media-filter]');
    if (mediaFilter) {
      state.mediaFilter = mediaFilter.dataset.mediaFilter;
      state.library.settings.mediaFilter = state.mediaFilter;
      saveSetting('mediaFilter', state.mediaFilter);
      renderView();
      return;
    }

    const removeAttachmentButton = (event.target instanceof Element ? event.target : null)?.closest('[data-remove-attachment]');
    if (removeAttachmentButton) {
      const id = removeAttachmentButton.dataset.removeAttachment;
      const attachment = state.editorAttachments.find(item => item.id === id);
      if (attachment?.existing) state.removedAttachmentIds.add(id);
      state.editorAttachments = state.editorAttachments.filter(item => item.id !== id);
      renderAttachmentTray();
      return;
    }

    const actionElement = (event.target instanceof Element ? event.target : null)?.closest('[data-action]');
    if (!actionElement) return;
    const action = actionElement.dataset.action;
    const entryId = actionElement.dataset.entryId || actionElement.closest('[data-entry-id]')?.dataset.entryId;
    if (action === 'new-entry') openEditor();
    else if (action === 'prompt-entry') openEditor(null, { title: 'Daily reflection', body: `> ${promptForToday()}\n\n` });
    else if (action === 'open-entry' && entryId) openEditor(entryId);
    else if (action === 'open-media') openMediaViewer(actionElement.dataset.attachmentId);
    else if (action === 'favorite' && entryId) await toggleFavorite(entryId);
    else if (action === 'share' && entryId) await shareEntry(entryId);
    else if (action === 'export-entry' && entryId) await exportEntry(entryId);
    else if (action === 'edit-journal') openJournalDialog(actionElement.dataset.journalId);
    else if (action === 'rename-collection') await renameCollectionById(actionElement.dataset.collectionId);
    else if (action === 'delete-collection') await removeCollectionById(actionElement.dataset.collectionId);
    else if (action === 'delete-template') await removeTemplateById(actionElement.dataset.templateId);
  });

  el.entryForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') closeEditor();
    else await saveCurrentEntry();
  });
  el.cancelEntryButton.addEventListener('click', closeEditor);
  el.deleteEntryButton.addEventListener('click', deleteCurrentEntry);
  el.entryTitle.addEventListener('input', writeDraft);
  el.entryBody.addEventListener('input', writeDraft);
  el.entryTags.addEventListener('input', writeDraft);
  el.entryLocationLabel.addEventListener('input', writeDraft);
  el.entryJournal.addEventListener('change', writeDraft);
  el.entryDate.addEventListener('change', writeDraft);
  el.entryFavorite.addEventListener('change', writeDraft);
  el.moodPicker.addEventListener('click', event => {
    const button = (event.target instanceof Element ? event.target : null)?.closest('[data-mood]');
    if (!button) return;
    setEditorMood(state.editorMood === button.dataset.mood ? '' : button.dataset.mood);
    writeDraft();
  });
  document.querySelector('.format-toolbar').addEventListener('click', event => {
    const button = (event.target instanceof Element ? event.target : null)?.closest('[data-format]');
    if (button) insertFormatting(button.dataset.format);
  });
  el.previewToggle.addEventListener('click', togglePreview);
  el.templateSelect.addEventListener('change', () => {
    const template = state.library.templates.find(item => item.id === el.templateSelect.value);
    if (!template) return;
    if (el.entryBody.value.trim() && !confirm('Replace the current written text with this template?')) {
      el.templateSelect.value = '';
      return;
    }
    el.entryBody.value = template.body;
    if (!el.entryTitle.value) el.entryTitle.value = template.name;
    writeDraft();
  });
  el.attachmentInput.addEventListener('change', async event => {
    await addFiles(event.target.files);
    event.target.value = '';
  });
  el.recordVideoButton.addEventListener('click', () => openRecorder('video'));
  el.recordAudioButton.addEventListener('click', () => openRecorder('audio'));
  el.locateButton.addEventListener('click', locateEntry);
  el.saveTemplateButton.addEventListener('click', saveCurrentTextAsTemplate);

  el.prepareRecorderButton.addEventListener('click', prepareRecorder);
  el.startRecorderButton.addEventListener('click', startRecording);
  el.pauseRecorderButton.addEventListener('click', togglePauseRecording);
  el.finishRecorderButton.addEventListener('click', finishRecording);
  el.flipCameraButton.addEventListener('click', flipCamera);
  el.closeRecorderButton.addEventListener('click', () => closeRecorder());
  el.useTranscriptButton.addEventListener('click', appendTranscript);
  el.recorderDialog.addEventListener('cancel', event => { event.preventDefault(); closeRecorder(); });

  document.querySelector('.settings-tabs').addEventListener('click', event => {
    const button = (event.target instanceof Element ? event.target : null)?.closest('[data-settings-tab]');
    if (button) switchSettingsTab(button.dataset.settingsTab);
  });
  el.themeSelect.addEventListener('change', async () => {
    state.library.settings.theme = el.themeSelect.value;
    await saveSetting('theme', el.themeSelect.value);
    applyTheme(el.themeSelect.value);
  });
  el.reminderTime.addEventListener('change', async () => {
    state.library.settings.reminderTime = el.reminderTime.value;
    await saveSetting('reminderTime', el.reminderTime.value);
    showToast(el.reminderTime.value ? `Daily reminder set for ${el.reminderTime.value}.` : 'Daily reminder removed.');
  });
  el.autoLockSelect.addEventListener('change', async () => {
    const value = Number(el.autoLockSelect.value);
    state.library.settings.autoLockMinutes = value;
    await saveSetting('autoLockMinutes', value);
  });
  el.enableNotificationsButton.addEventListener('click', enableNotifications);
  el.persistStorageButton.addEventListener('click', requestPersistentStorage);
  el.setPasscodeButton.addEventListener('click', setPasscode);
  el.removePasscodeButton.addEventListener('click', removePasscodeSetting);
  el.exportLibraryButton.addEventListener('click', exportCompleteLibrary);
  el.importLibraryInput.addEventListener('change', event => importArchive(event.target.files[0]));
  el.exportTextButton.addEventListener('click', exportReadableText);
  el.wipeLibraryButton.addEventListener('click', wipeAllData);
  el.addCollectionButton.addEventListener('click', addNewCollection);
  el.newCollectionName.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addNewCollection(); } });

  el.journalForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') el.journalDialog.close();
    else await persistJournalFromDialog();
  });
  el.deleteJournalButton.addEventListener('click', removeCurrentJournal);

  el.closeMediaViewer.addEventListener('click', closeMediaViewer);
  el.downloadMediaButton.addEventListener('click', downloadViewedMedia);
  el.openMediaEntryButton.addEventListener('click', () => {
    const attachment = attachmentById(state.mediaViewerAttachmentId);
    const entryId = attachment?.entryId;
    closeMediaViewer();
    if (entryId) openEditor(entryId);
  });
  el.mediaDialog.addEventListener('cancel', event => { event.preventDefault(); closeMediaViewer(); });

  el.unlockForm.addEventListener('submit', unlock);

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    el.installButton.hidden = false;
  });
  el.installButton.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    await state.deferredInstallPrompt.prompt();
    state.deferredInstallPrompt = null;
    el.installButton.hidden = true;
  });
  window.addEventListener('appinstalled', () => { el.installButton.hidden = true; state.deferredInstallPrompt = null; showToast('Silver installed.'); });

  document.addEventListener('keydown', event => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'n') { event.preventDefault(); if (!state.locked) openEditor(); }
    if (modifier && event.key.toLowerCase() === 's' && el.entryDialog.open) { event.preventDefault(); saveCurrentEntry(); }
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { event.preventDefault(); el.globalSearch.focus(); }
    if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) closeSidebar();
  });

  ['pointerdown', 'keydown', 'touchstart'].forEach(type => document.addEventListener(type, noteActivity, { passive: true }));
  window.addEventListener('pagehide', () => {
    if (recorder.instance && ['recording', 'paused'].includes(recorder.instance.state)) {
      recorder.discarding = true;
      recorder.instance.stop();
    }
    stopRecorderTracks();
    revokeBucket(state.viewObjectUrls);
    revokeBucket(state.editorObjectUrls);
    if (state.viewerObjectUrl) URL.revokeObjectURL(state.viewerObjectUrl);
  });
}

async function init() {
  cacheElements();
  try {
    state.library = await ensureSeedData();
    state.mediaFilter = state.library.settings.mediaFilter || 'all';
    applyTheme();
    bindEvents();
    renderAll();
    await updateStorageEstimate();
    registerServiceWorker();
    if (state.library.settings.lock) lockNow(false);
    handleLaunchParameters();
    window.setInterval(checkReminder, 30_000);
    window.setInterval(checkAutoLock, 30_000);
    checkReminder();
  } catch (error) {
    console.error(error);
    el.viewRoot.innerHTML = `<div class="no-results">${icon('shield')}<h3>Silver could not open its private journal</h3><p>${escapeHtml(error.message || 'The browser database is unavailable.')}</p><button class="primary-button" type="button" onclick="location.reload()">Try again</button></div>`;
  }
}

init();
