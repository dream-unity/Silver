#!/usr/bin/env python3
"""Install Silver's shared 30-day Deleted Memories system and patch both applications."""

from __future__ import annotations

import argparse
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MARKER = "Silver Deleted Memories — 2026-09-03"
BUILD = "20260903-deleted-memories-1"


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"updated {relative}")


def replace_once(text: str, old: str, new: str, description: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {description}; found {count}.")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, description: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Expected one {description}; found {count}.")
    return updated


def patch_database() -> None:
    path = "db.js"
    text = read(path)
    text = replace_once(text, "const DB_VERSION = 1;", "const DB_VERSION = 2;", "Silver database version")
    text = replace_once(
        text,
        "  templates: 'templates',\n  settings: 'settings'\n});",
        "  templates: 'templates',\n  settings: 'settings',\n  deletedMemories: 'deletedMemories'\n});",
        "Deleted Memories store declaration",
    )
    schema = """
      if (!db.objectStoreNames.contains(STORES.deletedMemories)) {
        const store = db.createObjectStore(STORES.deletedMemories, { keyPath: 'id' });
        store.createIndex('kind', 'kind', { unique: false });
        store.createIndex('deletedAt', 'deletedAt', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
"""
    anchor = """      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
"""
    upgrade = text[text.find("request.onupgradeneeded"):text.find("request.onsuccess")]
    if "STORES.deletedMemories" not in upgrade:
        text = replace_once(text, anchor, anchor + schema, "Deleted Memories schema insertion point")
    write(path, text)


def deleted_root_functions() -> str:
    return r'''async function refreshDeletedMemories({ render = false } = {}) {
  state.deletedMemories = await loadDeletedMemories();
  updateDeletedMemoriesCount();
  if (render) {
    renderSidebar();
    if (state.view === 'deleted') renderView();
  }
  return state.deletedMemories;
}

function updateDeletedMemoriesCount() {
  const count = state.deletedMemories?.length || 0;
  if (!el.deletedMemoriesCount) return;
  el.deletedMemoriesCount.textContent = String(count);
  el.deletedMemoriesCount.hidden = count === 0;
  el.deletedMemoriesCount.setAttribute('aria-label', `${count} deleted ${count === 1 ? 'memory' : 'memories'}`);
}

function deletedMemoryIcon(kind) {
  if (kind === 'mind-map' || kind === 'mind-map-thought') return 'share';
  if (kind === 'journal-attachment') return 'media';
  if (kind === 'journal') return 'list';
  if (kind === 'collection') return 'history';
  if (kind === 'template') return 'template';
  return 'document';
}

function deletedMemoryCard(memory) {
  const retention = deletedMemoryRetention(memory);
  const deletedAt = formatDate(memory.deletedAt, { dateStyle: 'medium', timeStyle: 'short' });
  const expiresAt = formatDate(memory.expiresAt, { dateStyle: 'medium', timeStyle: 'short' });
  const type = deletedMemoryTypeLabel(memory.kind);
  return `<article class="deleted-memory-card" data-deleted-memory-id="${escapeAttribute(memory.id)}">
    <div class="deleted-memory-symbol" aria-hidden="true">${icon(deletedMemoryIcon(memory.kind))}</div>
    <div class="deleted-memory-copy">
      <div class="deleted-memory-meta"><span>${escapeHtml(type)}</span><span>·</span><span>Deleted ${escapeHtml(deletedAt)}</span></div>
      <h2>${escapeHtml(memory.title || 'Untitled memory')}</h2>
      ${memory.summary ? `<p>${escapeHtml(memory.summary)}</p>` : ''}
      <div class="deleted-memory-source">${memory.sourceTitle ? `<span>From ${escapeHtml(memory.sourceTitle)}</span>` : ''}<strong>${escapeHtml(retention.label)}</strong></div>
      <small>Automatically and permanently deleted ${escapeHtml(expiresAt)}</small>
    </div>
    <div class="deleted-memory-actions">
      <button class="primary-button" type="button" data-action="restore-deleted-memory" data-memory-id="${escapeAttribute(memory.id)}">${icon('history')}Restore</button>
      <button class="danger-button" type="button" data-action="permanently-delete-memory" data-memory-id="${escapeAttribute(memory.id)}">${icon('trash')}Permanently delete</button>
    </div>
  </article>`;
}

function renderDeletedMemories() {
  const memories = [...(state.deletedMemories || [])].sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));
  const tools = memories.length
    ? `<button class="danger-button" type="button" data-action="empty-deleted-memories">${icon('trash')}Empty Deleted Memories</button>`
    : '';
  return `${viewHeading('RECOVERY', 'Deleted Memories', `${memories.length} ${memories.length === 1 ? 'item remains' : 'items remain'} recoverable for up to 30 days.`, tools)}
    <section class="deleted-memory-notice">${icon('history')}<div><strong>A 30-day safety window</strong><p>Everything deleted from the journal or Map Your Mind is gathered here. Restore it before its displayed expiry time, or permanently delete it immediately.</p></div></section>
    ${memories.length ? `<div class="deleted-memory-list">${memories.map(deletedMemoryCard).join('')}</div>` : emptyState('Nothing is waiting for recovery', 'Deleted entries, media, maps and thoughts will remain here for 30 days before automatic permanent deletion.', '')}`;
}

async function restoreMemoryById(memoryId) {
  const memory = state.deletedMemories.find(item => item.id === memoryId);
  if (!memory) return showToast('That deleted memory is no longer available.');
  try {
    const result = await restoreDeletedMemory(memoryId);
    await reloadLibrary();
    await refreshDeletedMemories();
    renderAll();
    renderJournalManager();
    renderTemplateManager();
    showToast(`Restored “${result.title || memory.title}”.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'The deleted memory could not be restored.', 6000);
  }
}

async function permanentlyDeleteMemoryById(memoryId) {
  const memory = state.deletedMemories.find(item => item.id === memoryId);
  if (!memory) return;
  if (!confirm(`Permanently delete “${memory.title}”? This cannot be undone.`)) return;
  try {
    await permanentlyDeleteDeletedMemory(memoryId);
    await refreshDeletedMemories();
    renderAll();
    showToast('The memory was permanently deleted.');
  } catch (error) {
    console.error(error);
    showToast('The memory could not be permanently deleted.');
  }
}

async function emptyDeletedMemoriesNow() {
  if (!state.deletedMemories.length) return;
  const confirmation = prompt(`This permanently deletes all ${state.deletedMemories.length} recoverable items now. Type DELETE to continue.`);
  if (confirmation !== 'DELETE') return;
  try {
    const count = await emptyDeletedMemories();
    await refreshDeletedMemories();
    renderAll();
    showToast(`Permanently deleted ${count} ${count === 1 ? 'memory' : 'memories'}.`);
  } catch (error) {
    console.error(error);
    showToast('Deleted Memories could not be emptied.');
  }
}

'''


def patch_root_app() -> None:
    path = "src/app.js"
    text = read(path)
    import_block = r'''import {
  loadDeletedMemories,
  moveJournalEntryToDeletedMemories,
  moveJournalAttachmentToDeletedMemories,
  moveJournalToDeletedMemories,
  moveCollectionToDeletedMemories,
  moveTemplateToDeletedMemories,
  restoreDeletedMemory,
  permanentlyDeleteDeletedMemory,
  emptyDeletedMemories,
  purgeExpiredDeletedMemories,
  subscribeDeletedMemories,
  deletedMemoryTypeLabel,
  deletedMemoryRetention
} from '../deleted-memories.js';
'''
    archive_import = "import { createSilverArchive, parseSilverArchive, createReadableText } from './archive.js';\n"
    if "from '../deleted-memories.js'" not in text:
        text = replace_once(text, archive_import, archive_import + import_block, "Deleted Memories import")
    text = replace_once(
        text,
        "const VIEWS = new Set(['today', 'timeline', 'calendar', 'memories', 'media', 'places', 'favorites']);",
        "const VIEWS = new Set(['today', 'timeline', 'calendar', 'memories', 'media', 'places', 'favorites', 'deleted']);",
        "Deleted Memories view registration",
    )
    if "deletedMemories: []" not in text:
        text = replace_once(
            text,
            "  mindMapReturnFocus: null\n};",
            "  mindMapReturnFocus: null,\n  deletedMemories: [],\n  deletedMemoriesUnsubscribe: null\n};",
            "Deleted Memories state insertion",
        )
    if "'deletedMemoriesCount'" not in text:
        text = replace_once(
            text,
            "    'settingsButton', 'installButton', 'storageStatus', 'globalSearch', 'lockButton', 'newEntryButton',",
            "    'settingsButton', 'installButton', 'storageStatus', 'globalSearch', 'lockButton', 'newEntryButton',\n    'deletedMemoriesCount',",
            "Deleted Memories element cache",
        )
    if "async function refreshDeletedMemories" not in text:
        text = replace_once(text, "function renderSidebar()", deleted_root_functions() + "function renderSidebar()", "Deleted Memories root functions")
    if "updateDeletedMemoriesCount();\n\n  document.querySelectorAll('.primary-nav" not in text:
        text = replace_once(
            text,
            "  el.journalList.innerHTML = html;\n\n  document.querySelectorAll('.primary-nav [data-view]').forEach(button => {",
            "  el.journalList.innerHTML = html;\n  updateDeletedMemoriesCount();\n\n  document.querySelectorAll('.primary-nav [data-view]').forEach(button => {",
            "Deleted Memories sidebar count",
        )
    text = replace_once(
        text,
        "  else if (state.view === 'favorites') html = renderFavorites();\n  el.viewRoot.innerHTML = html;",
        "  else if (state.view === 'favorites') html = renderFavorites();\n  else if (state.view === 'deleted') html = renderDeletedMemories();\n  el.viewRoot.innerHTML = html;",
        "Deleted Memories render switch",
    )
    text = replace_once(
        text,
        "    await Promise.all([...state.removedAttachmentIds].map(deleteAttachment));",
        "    await Promise.all([...state.removedAttachmentIds].map(moveJournalAttachmentToDeletedMemories));",
        "attachment recovery routing",
    )
    text = regex_once(
        text,
        r"async function deleteCurrentEntry\(\) \{.*?\n\}\n\nasync function toggleFavorite",
        r'''async function deleteCurrentEntry() {
  if (!state.editorEntryId) return;
  const entry = entryById(state.editorEntryId);
  if (!entry) return;
  if (!confirm(`Move “${entry.title || 'Untitled entry'}” to Deleted Memories? It can be restored for 30 days.`)) return;
  try {
    await moveJournalEntryToDeletedMemories(state.editorEntryId);
    await reloadLibrary();
    await refreshDeletedMemories();
    closeEditor();
    renderAll();
    showToast('Entry moved to Deleted Memories for 30 days.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'The entry could not be moved to Deleted Memories.');
  }
}

async function toggleFavorite''',
        "journal-entry soft deletion",
        re.S,
    )
    text = regex_once(
        text,
        r"async function removeCurrentJournal\(\) \{.*?\n\}\n\nasync function addNewCollection",
        r'''async function removeCurrentJournal() {
  const journal = state.editingJournalId ? journalById(state.editingJournalId) : null;
  if (!journal) return;
  if (state.library.journals.length <= 1) return showToast('Silver must keep at least one journal.');
  const fallback = state.library.journals.find(item => item.id !== journal.id && item.isDefault) || state.library.journals.find(item => item.id !== journal.id);
  const count = state.library.entries.filter(entry => entry.journalId === journal.id).length;
  if (!confirm(`Move the “${journal.name}” journal to Deleted Memories? ${count ? `${count} existing ${count === 1 ? 'entry' : 'entries'} will remain safely available in “${fallback.name}”.` : 'It contains no entries.'} The journal can be restored for 30 days.`)) return;
  await moveJournalToDeletedMemories(journal.id, fallback.id);
  if (state.selectedJournalId === journal.id) state.selectedJournalId = '';
  await reloadLibrary();
  await refreshDeletedMemories();
  el.journalDialog.close();
  renderAll();
  renderJournalManager();
  showToast('Journal moved to Deleted Memories. Its entries remain available.');
}

async function addNewCollection''',
        "journal soft deletion",
        re.S,
    )
    text = regex_once(
        text,
        r"async function removeCollectionById\(collectionId\) \{.*?\n\}\n\nasync function removeTemplateById",
        r'''async function removeCollectionById(collectionId) {
  const collection = state.library.collections.find(item => item.id === collectionId);
  if (!collection) return;
  if (!confirm(`Move the “${collection.name}” collection to Deleted Memories? Its journals and entries will remain available, and the collection can be restored for 30 days.`)) return;
  await moveCollectionToDeletedMemories(collectionId);
  await reloadLibrary();
  await refreshDeletedMemories();
  renderAll();
  renderJournalManager();
  showToast('Collection moved to Deleted Memories.');
}

async function removeTemplateById''',
        "collection soft deletion",
        re.S,
    )
    text = regex_once(
        text,
        r"async function removeTemplateById\(templateId\) \{.*?\n\}\n\nfunction bytesToBase64",
        r'''async function removeTemplateById(templateId) {
  const template = state.library.templates.find(item => item.id === templateId);
  if (!template || !confirm(`Move the “${template.name}” template to Deleted Memories? Existing entries will not change, and the template can be restored for 30 days.`)) return;
  await moveTemplateToDeletedMemories(templateId);
  await reloadLibrary();
  await refreshDeletedMemories();
  renderTemplateManager();
  populateEditorSelectors();
  renderAll();
  showToast('Template moved to Deleted Memories.');
}

function bytesToBase64''',
        "template soft deletion",
        re.S,
    )
    text = replace_once(
        text,
        "  const confirmation = prompt('This permanently deletes every local entry and media file. Type ERASE to continue.');",
        "  const confirmation = prompt('This permanently deletes every local entry, media file and item in Deleted Memories. Type ERASE to continue.');",
        "permanent erase wording",
    )
    if "restore-deleted-memory" not in text[text.find("document.addEventListener('click'"):]:
        text = replace_once(
            text,
            "    else if (action === 'export-entry' && entryId) await exportEntry(entryId);\n    else if (action === 'edit-journal') openJournalDialog(actionElement.dataset.journalId);",
            "    else if (action === 'export-entry' && entryId) await exportEntry(entryId);\n"
            "    else if (action === 'restore-deleted-memory') await restoreMemoryById(actionElement.dataset.memoryId);\n"
            "    else if (action === 'permanently-delete-memory') await permanentlyDeleteMemoryById(actionElement.dataset.memoryId);\n"
            "    else if (action === 'empty-deleted-memories') await emptyDeletedMemoriesNow();\n"
            "    else if (action === 'edit-journal') openJournalDialog(actionElement.dataset.journalId);",
            "Deleted Memories delegated actions",
        )
    text = regex_once(
        text,
        r"function handleLaunchParameters\(\) \{.*?\n\}\n\nfunction handlePendingLaunchAction",
        r'''function handleLaunchParameters() {
  const params = new URLSearchParams(location.search);
  const requestedView = params.get('view');
  const sharedTitle = params.get('title') || '';
  const sharedText = params.get('text') || '';
  const sharedUrl = params.get('url') || '';
  const newMode = params.get('new');
  if (requestedView && VIEWS.has(requestedView)) state.view = requestedView;
  if (sharedTitle || sharedText || sharedUrl) {
    state.pendingLaunchAction = { type: 'entry', initial: { title: sharedTitle, body: [sharedText, sharedUrl].filter(Boolean).join('\n\n') } };
  } else if (newMode) {
    state.pendingLaunchAction = { type: 'entry', recorder: newMode === 'video' ? 'video' : null };
  }
  history.replaceState({}, '', location.pathname + location.hash);
  if (requestedView && VIEWS.has(requestedView)) renderAll();
  handlePendingLaunchAction();
}

function handlePendingLaunchAction''',
        "Deleted Memories launch parameter support",
        re.S,
    )
    if "sidebar-footer [data-view]" not in text:
        text = replace_once(
            text,
            "  document.querySelectorAll('.primary-nav [data-view]').forEach(button => {\n    button.classList.toggle('active', button.dataset.view === state.view && !state.search);\n  });",
            "  document.querySelectorAll('.primary-nav [data-view]').forEach(button => {\n    button.classList.toggle('active', button.dataset.view === state.view && !state.search);\n  });\n  document.querySelectorAll('.sidebar-footer [data-view]').forEach(button => {\n    button.classList.toggle('active', button.dataset.view === state.view && !state.search);\n  });",
            "Deleted Memories footer active state",
        )
    if "silver-open-deleted-memories" not in text:
        listener = r'''  window.addEventListener('message', async event => {
    if (event.origin !== location.origin) return;
    if (event.source !== el.mindMapFrame.contentWindow) return;
    if (event.data?.type !== 'silver-open-deleted-memories') return;
    closeMindMap();
    await refreshDeletedMemories();
    setView('deleted');
  });

'''
        text = replace_once(
            text,
            "  el.closeMindMapButton.addEventListener('click', closeMindMap);",
            listener + "  el.closeMindMapButton.addEventListener('click', closeMindMap);",
            "shared Deleted Memories message listener",
        )
    startup_old = """    state.library = await ensureSeedData();
    state.mediaFilter = state.library.settings.mediaFilter || 'all';
    applyTheme();
    bindEvents();
    renderAll();
"""
    startup_new = """    state.library = await ensureSeedData();
    await purgeExpiredDeletedMemories();
    state.deletedMemories = await loadDeletedMemories({ purge: false });
    state.mediaFilter = state.library.settings.mediaFilter || 'all';
    applyTheme();
    bindEvents();
    renderAll();
"""
    text = replace_once(text, startup_old, startup_new, "Deleted Memories startup")
    if "state.deletedMemoriesUnsubscribe = subscribeDeletedMemories" not in text:
        subscriptions = r'''    state.deletedMemoriesUnsubscribe = subscribeDeletedMemories(() => {
      refreshDeletedMemories({ render: true }).catch(error => console.warn('Deleted Memories refresh failed:', error));
    });
    window.setInterval(() => {
      refreshDeletedMemories({ render: state.view === 'deleted' }).catch(error => console.warn('Deleted Memories expiry check failed:', error));
    }, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshDeletedMemories({ render: state.view === 'deleted' }).catch(error => console.warn('Deleted Memories visibility refresh failed:', error));
      }
    });
'''
        text = replace_once(
            text,
            "    handleLaunchParameters();\n    window.setInterval(checkReminder, 30_000);",
            "    handleLaunchParameters();\n" + subscriptions + "    window.setInterval(checkReminder, 30_000);",
            "Deleted Memories synchronization startup",
        )
    if "state.deletedMemoriesUnsubscribe?.();" not in text:
        text = replace_once(
            text,
            "  window.addEventListener('pagehide', () => {\n    if (recorder.instance",
            "  window.addEventListener('pagehide', () => {\n    state.deletedMemoriesUnsubscribe?.();\n    state.deletedMemoriesUnsubscribe = null;\n    if (recorder.instance",
            "Deleted Memories subscription cleanup",
        )
    text = text.replace(
        "if (kind === 'mind-map' || kind === 'mind-map-thought') return 'share';",
        "if (kind === 'mind-map' || kind === 'mind-map-thought') return 'share';\n  if (kind === 'mind-map-attachment') return 'media';",
        1,
    )
    write(path, text)


def patch_root_shell() -> None:
    path = "src/shell.html"
    text = read(path)
    if 'id="deletedMemoriesButton"' not in text:
        button = '''        <button class="sidebar-action deleted-memories-button" id="deletedMemoriesButton" type="button" data-view="deleted" title="Deleted Memories" aria-label="Open Deleted Memories">
          <svg><use href="#icon-trash"></use></svg><span>Deleted Memories</span><b class="deleted-memories-count" id="deletedMemoriesCount" hidden>0</b>
        </button>
'''
        text = replace_once(
            text,
            '        <button class="sidebar-action" id="installButton" type="button" hidden>',
            button + '        <button class="sidebar-action" id="installButton" type="button" hidden>',
            "Silver bottom-left Deleted Memories button",
        )
    write(path, text)


def root_deleted_styles() -> str:
    return r'''

/* Silver Deleted Memories — 2026-09-03 */
.deleted-memories-button {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--accent) 16%, transparent);
  background: color-mix(in srgb, var(--accent-soft) 35%, transparent);
}
.deleted-memories-button:hover,
.deleted-memories-button.active {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--line));
  background: var(--accent-soft);
  color: var(--accent-deep);
}
.deleted-memories-count {
  display: grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  margin-left: auto;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent-deep);
  color: var(--surface-2);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}
.deleted-memory-notice {
  display: flex;
  align-items: flex-start;
  gap: 15px;
  margin-bottom: 18px;
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--line));
  border-radius: 17px;
  background: color-mix(in srgb, var(--accent-soft) 42%, var(--surface-2));
  box-shadow: var(--shadow-soft);
}
.deleted-memory-notice > svg {
  width: 25px;
  height: 25px;
  flex: 0 0 auto;
  color: var(--accent-deep);
}
.deleted-memory-notice strong { display: block; margin-bottom: 3px; }
.deleted-memory-notice p { margin: 0; color: var(--muted); font-size: 12px; }
.deleted-memory-list { display: grid; gap: 11px; }
.deleted-memory-card {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) auto;
  align-items: center;
  gap: 17px;
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface-2);
  box-shadow: var(--shadow-soft);
}
.deleted-memory-symbol {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--line));
  border-radius: 16px;
  background: color-mix(in srgb, var(--accent-soft) 62%, var(--surface-2));
  color: var(--accent-deep);
}
.deleted-memory-symbol svg { width: 24px; height: 24px; }
.deleted-memory-copy { min-width: 0; }
.deleted-memory-meta,
.deleted-memory-source {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--faint);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.deleted-memory-copy h2 {
  margin: 5px 0 3px;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: 23px;
  font-weight: 400;
  line-height: 1.12;
}
.deleted-memory-copy > p {
  display: -webkit-box;
  margin: 0 0 8px;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.deleted-memory-source { justify-content: space-between; text-transform: none; letter-spacing: 0; }
.deleted-memory-source strong { color: var(--accent-deep); font-size: 10px; }
.deleted-memory-copy > small { display: block; margin-top: 4px; color: var(--faint); font-size: 9px; }
.deleted-memory-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 7px;
  min-width: 164px;
}
.deleted-memory-actions button { width: 100%; min-height: 38px; padding: 8px 12px; font-size: 10px; }
.deleted-memory-actions svg { width: 15px; height: 15px; }

@media (max-width: 840px) {
  .deleted-memory-card { grid-template-columns: 48px minmax(0, 1fr); }
  .deleted-memory-symbol { width: 48px; height: 48px; }
  .deleted-memory-actions { grid-column: 1 / -1; grid-template-columns: 1fr 1fr; min-width: 0; }
}

@media (max-width: 520px) {
  .deleted-memory-card { grid-template-columns: 1fr; gap: 10px; padding: 15px; }
  .deleted-memory-symbol { width: 43px; height: 43px; }
  .deleted-memory-actions { grid-column: auto; grid-template-columns: 1fr; }
  .deleted-memory-notice { padding: 15px; }
}

/* Keep Silver's return control separate from the mind-map recovery launcher on touch layouts. */
@media (max-width: 760px) {
  .mind-map-return {
    top: 50%;
    bottom: auto;
    transform: translateY(-50%);
  }
}
'''


def patch_root_styles() -> None:
    path = "src/styles.css"
    text = read(path)
    if MARKER not in text:
        text += root_deleted_styles()
    write(path, text)


def patch_deleted_memory_engine() -> None:
    path = "deleted-memories.js"
    text = read(path)
    if "async function restoreMindMapAttachment" not in text:
        restore = r'''async function restoreMindMapAttachment(memory) {
  const payload = memory.payload || {};
  const mapId = payload.mapId;
  const thoughtId = payload.thoughtId;
  const originalAttachment = payload.attachment;
  if (!mapId || !thoughtId || !originalAttachment) throw new Error('This recovery record is missing its map attachment.');
  const key = MAP_DOCUMENT_KEY(mapId);
  const raw = localStorage.getItem(key);
  if (!raw) {
    const error = new Error('Restore the mind map that owned this attachment first.');
    error.code = 'PARENT_MISSING';
    throw error;
  }
  const document = JSON.parse(raw);
  document.thoughts = Array.isArray(document.thoughts) ? document.thoughts : [];
  const thought = document.thoughts.find(item => item.id === thoughtId);
  if (!thought) {
    const error = new Error('Restore the mind-map thought that owned this attachment first.');
    error.code = 'PARENT_MISSING';
    throw error;
  }
  thought.attachments = Array.isArray(thought.attachments) ? thought.attachments : [];
  const attachmentIds = new Set(thought.attachments.map(item => item.id));
  const attachmentId = attachmentIds.has(originalAttachment.id) ? uniqueRecordId(attachmentIds, 'a') : originalAttachment.id;
  thought.attachments.push({ ...originalAttachment, id: attachmentId });
  document.updatedAt = new Date().toISOString();
  localStorage.setItem(key, JSON.stringify(document));
  const library = readMapLibrary();
  writeMapLibrary({
    ...library,
    items: library.items.map(item => item.id === mapId ? mapMetaFromDocument(mapId, document, item.template) : item)
  });
  await deleteRecords([memory.id], 'mind-map-attachment-restored');
  return { kind: memory.kind, title: memory.title, restoredId: attachmentId };
}

'''
        text = replace_once(
            text,
            "export async function restoreDeletedMemory(id) {",
            restore + "export async function restoreDeletedMemory(id) {",
            "mind-map attachment restore function",
        )
    if "memory.kind === 'mind-map-attachment'" not in text:
        text = replace_once(
            text,
            "  else if (memory.kind === 'mind-map-thought') result = await restoreMindMapThought(memory);\n  else throw new Error",
            "  else if (memory.kind === 'mind-map-thought') result = await restoreMindMapThought(memory);\n  else if (memory.kind === 'mind-map-attachment') result = await restoreMindMapAttachment(memory);\n  else throw new Error",
            "mind-map attachment restore routing",
        )
    if "'mind-map-attachment': 'Mind-map attachment'" not in text:
        text = replace_once(
            text,
            "    'mind-map-thought': 'Mind-map thought'\n  })[kind]",
            "    'mind-map-thought': 'Mind-map thought',\n    'mind-map-attachment': 'Mind-map attachment'\n  })[kind]",
            "mind-map attachment type label",
        )
    write(path, text)


def patch_mind_map_deleted_module() -> None:
    path = "mind-map-source/src/lib/deleted-memories.ts"
    text = read(path)
    text = text.replace(
        "kind: 'mind-map' | 'mind-map-thought'",
        "kind: 'mind-map' | 'mind-map-thought' | 'mind-map-attachment'",
        1,
    )
    if "moveMindMapAttachmentToDeletedMemories" not in text:
        function = r'''
export async function moveMindMapAttachmentToDeletedMemories(
  mapId: string,
  mapTitle: string,
  thoughtId: string,
  thoughtTitle: string,
  attachment: { id: string; title: string; url: string },
) {
  if (!mapId || !thoughtId || !attachment) return null
  return put(record({
    kind: 'mind-map-attachment',
    originalId: attachment.id,
    title: attachment.title || 'Mind-map attachment',
    summary: attachment.url || `Removed from ${thoughtTitle || 'a thought'}`,
    sourceTitle: `${mapTitle || 'Map Your Mind'} · ${thoughtTitle || 'Thought'}`,
    payload: { mapId, mapTitle, thoughtId, thoughtTitle, attachment },
  }), 'mind-map-attachment-deleted')
}

'''
        text = replace_once(
            text,
            "export function openSharedDeletedMemories() {",
            function + "export function openSharedDeletedMemories() {",
            "mind-map attachment recovery writer",
        )
    write(path, text)


def deleted_memories_launcher_component() -> str:
    return r'''import { useEffect, useState } from 'react'
import {
  getDeletedMemoryCount,
  openSharedDeletedMemories,
  subscribeDeletedMemories,
} from '../lib/deleted-memories'

export function DeletedMemoriesButton() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let active = true
    const refresh = () => {
      getDeletedMemoryCount()
        .then((value) => {
          if (active) setCount(value)
        })
        .catch(() => {
          if (active) setCount(0)
        })
    }
    refresh()
    const unsubscribe = subscribeDeletedMemories(refresh)
    const expiryCheck = window.setInterval(refresh, 60 * 60 * 1000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      unsubscribe()
      window.clearInterval(expiryCheck)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const label = count
    ? `Deleted Memories, ${count} recoverable ${count === 1 ? 'item' : 'items'}`
    : 'Deleted Memories'

  return (
    <button
      type="button"
      className="deleted-memories-launcher"
      onClick={openSharedDeletedMemories}
      aria-label={label}
      title="Deleted Memories"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />
      </svg>
      <span>Deleted Memories</span>
      {count > 0 ? <b>{count}</b> : null}
    </button>
  )
}
'''


def patch_mind_map_store() -> None:
    path = "mind-map-source/src/lib/store.ts"
    text = read(path)
    if "moveMindMapToDeletedMemories" not in text:
        text = replace_once(
            text,
            "import { uid, nowIso } from './ids'\n",
            "import { uid, nowIso } from './ids'\nimport { moveMindMapToDeletedMemories } from './deleted-memories'\n",
            "mind-map recovery import",
        )
    if "deleteBrainToDeletedMemories" not in text:
        function = r'''
export async function deleteBrainToDeletedMemories(id: string): Promise<BrainLibrary> {
  const library = loadLibrary()
  const meta = library.items.find((item) => item.id === id)
  const document = loadBrain(id)
  if (!meta || !document) return deleteBrain(id)
  await moveMindMapToDeletedMemories(id, meta, document)
  return deleteBrain(id)
}

'''
        text = replace_once(
            text,
            "export function loadDocument(): BrainDocument {",
            function + "export function loadDocument(): BrainDocument {",
            "recoverable mind-map deletion function",
        )
    write(path, text)


def patch_mind_map_start_menu() -> None:
    path = "mind-map-source/src/components/StartMenu.tsx"
    text = read(path)
    if "DeletedMemoriesButton" not in text:
        text = replace_once(
            text,
            "import type { BrainMeta } from '../types'\n",
            "import type { BrainMeta } from '../types'\nimport { DeletedMemoriesButton } from './DeletedMemoriesButton'\n",
            "Deleted Memories launcher import in map menu",
        )
        text = replace_once(
            text,
            "      </section>\n    </div>\n  )",
            "      </section>\n      <DeletedMemoriesButton />\n    </div>\n  )",
            "Deleted Memories launcher in map menu",
        )
    text = text.replace("onDelete: (id: string) => void", "onDelete: (id: string) => void | Promise<void>", 1)
    text = text.replace("onClick={() => onDelete(item.id)}", "onClick={() => void onDelete(item.id)}", 1)
    write(path, text)


def patch_mind_map_app() -> None:
    path = "mind-map-source/src/App.tsx"
    text = read(path)
    if "deleteBrainToDeletedMemories" not in text:
        text = replace_once(
            text,
            "  deleteBrain,\n  exportDocument,",
            "  deleteBrain,\n  deleteBrainToDeletedMemories,\n  exportDocument,",
            "recoverable map deletion import",
        )
    if "from './lib/deleted-memories'" not in text:
        imports = r'''import {
  moveMindMapAttachmentToDeletedMemories,
  moveMindMapThoughtToDeletedMemories,
  subscribeDeletedMemories,
} from './lib/deleted-memories'
import { DeletedMemoriesButton } from './components/DeletedMemoriesButton'
'''
        text = replace_once(
            text,
            "import { StartMenu } from './components/StartMenu'\n",
            "import { StartMenu } from './components/StartMenu'\n" + imports,
            "mind-map Deleted Memories imports",
        )
    if "subscribeDeletedMemories(() =>" not in text:
        subscription = r'''
  useEffect(() => {
    return subscribeDeletedMemories(() => {
      const nextLibrary = loadLibrary()
      setLibrary(nextLibrary)
      if (!brainId) return
      const nextDocument = loadBrain(brainId)
      if (nextDocument) {
        setDoc(nextDocument)
      } else if (!nextLibrary.items.some((item) => item.id === brainId)) {
        setBrainId(null)
        setDoc(null)
        setComposer(null)
      }
    })
  }, [brainId])
'''
        text = replace_once(
            text,
            "  useEffect(() => {\n    setLibrary(loadLibrary())\n  }, [])\n",
            "  useEffect(() => {\n    setLibrary(loadLibrary())\n  }, [])\n" + subscription,
            "mind-map recovery synchronization",
        )
    text = text.replace(
        "        setDoc((current) => (current ? forgetThought(current, current.activeId) : current))",
        "        void forgetThoughtWithRecovery(doc.activeId)",
        1,
    )
    text = text.replace(
        "    window.addEventListener('keydown', onKey)\n    return () => window.removeEventListener('keydown', onKey)\n  }, [doc])",
        "    window.addEventListener('keydown', onKey)\n    return () => window.removeEventListener('keydown', onKey)\n  }, [doc, brainId])",
        1,
    )
    if "async function deleteBrainWithRecovery" not in text:
        handlers = r'''
  async function deleteBrainWithRecovery(id: string) {
    const item = library.items.find((entry) => entry.id === id)
    if (!item) return
    if (!window.confirm(`Move “${item.title}” to Deleted Memories? It can be restored for 30 days.`)) return
    try {
      const next = await deleteBrainToDeletedMemories(id)
      setLibrary(next)
      if (brainId === id) {
        setBrainId(null)
        setDoc(null)
        setComposer(null)
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'The mind map could not be moved to Deleted Memories.')
    }
  }

  async function forgetThoughtWithRecovery(id: string) {
    if (!brainId || !doc || id === doc.homeId) return
    const thought = doc.thoughts.find((item) => item.id === id && !item.forgotten)
    if (!thought) return
    if (!window.confirm(`Move “${thought.name}” to Deleted Memories? It can be restored for 30 days.`)) return
    try {
      await moveMindMapThoughtToDeletedMemories(brainId, doc.title, doc, id)
      setDoc((current) => (current ? forgetThought(current, id) : current))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'The thought could not be moved to Deleted Memories.')
    }
  }

  async function detachWithRecovery(attachmentId: string) {
    if (!brainId || !doc) return
    const thought = doc.thoughts.find((item) => item.id === doc.activeId)
    const attachment = thought?.attachments.find((item) => item.id === attachmentId)
    if (!thought || !attachment) return
    if (!window.confirm(`Move “${attachment.title || 'Attachment'}” to Deleted Memories? It can be restored for 30 days.`)) return
    try {
      await moveMindMapAttachmentToDeletedMemories(brainId, doc.title, thought.id, thought.name, attachment)
      setDoc((current) => (current ? removeAttachment(current, thought.id, attachmentId) : current))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'The attachment could not be moved to Deleted Memories.')
    }
  }
'''
        text = replace_once(
            text,
            "  if (!brainId || !doc) {",
            handlers + "\n  if (!brainId || !doc) {",
            "mind-map recovery handlers",
        )
    text = regex_once(
        text,
        r"        onDelete=\{\(id\) => \{\n          setLibrary\(deleteBrain\(id\)\)\n          if \(brainId === id\) \{\n            setBrainId\(null\)\n            setDoc\(null\)\n          \}\n        \}\}",
        "        onDelete={(id) => void deleteBrainWithRecovery(id)}",
        "first recoverable map delete handler",
    )
    text = text.replace(
        "        onDelete={(id) => setLibrary(deleteBrain(id))}",
        "        onDelete={(id) => void deleteBrainWithRecovery(id)}",
        1,
    )
    text = text.replace(
        "              onForget={(id) => setDoc((current) => (current ? forgetThought(current, id) : current))}",
        "              onForget={(id) => void forgetThoughtWithRecovery(id)}",
        1,
    )
    text = text.replace(
        "          onForget={() => setDoc((current) => (current ? forgetThought(current, safeActive.id) : current))}",
        "          onForget={() => void forgetThoughtWithRecovery(safeActive.id)}",
        1,
    )
    text = text.replace(
        "          onDetach={(id) => setDoc((current) => (current ? removeAttachment(current, safeActive.id, id) : current))}",
        "          onDetach={(id) => void detachWithRecovery(id)}",
        1,
    )
    if "<DeletedMemoriesButton />\n    </div>\n  )\n}" not in text:
        text = replace_once(
            text,
            "      ) : null}\n    </div>\n  )\n}\n\nfunction isTyping",
            "      ) : null}\n      <DeletedMemoriesButton />\n    </div>\n  )\n}\n\nfunction isTyping",
            "Deleted Memories launcher in active mind map",
        )
    write(path, text)


def map_deleted_styles() -> str:
    return r'''

/* Silver Deleted Memories — shared map launcher */
.deleted-memories-launcher {
  position: fixed;
  z-index: 60;
  left: 20px;
  bottom: 20px;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  padding: 9px 13px;
  border: 1px solid rgba(180, 200, 220, .24);
  border-radius: 11px;
  background: rgba(17, 23, 33, .94);
  color: #dce6f2;
  box-shadow: 0 14px 35px rgba(0, 0, 0, .34);
  backdrop-filter: blur(14px);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: .01em;
}
.deleted-memories-launcher:hover,
.deleted-memories-launcher:focus-visible {
  border-color: rgba(186, 207, 235, .55);
  background: #182231;
  outline: 0;
  transform: translateY(-1px);
}
.deleted-memories-launcher:focus-visible { box-shadow: 0 0 0 3px rgba(148, 163, 184, .25), 0 14px 35px rgba(0, 0, 0, .34); }
.deleted-memories-launcher svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.deleted-memories-launcher b {
  display: grid;
  place-items: center;
  min-width: 21px;
  height: 21px;
  padding: 0 6px;
  border-radius: 999px;
  background: #dce6f2;
  color: #111721;
  font-size: 10px;
  line-height: 1;
}
.brain-shell .past-list { padding-left: 190px; }

@media (max-width: 720px) {
  .deleted-memories-launcher {
    left: max(12px, env(safe-area-inset-left));
    bottom: max(12px, env(safe-area-inset-bottom));
    min-height: 40px;
    padding: 8px 11px;
  }
  .brain-shell .past-list { padding-left: 175px; }
}

@media (max-width: 430px) {
  .deleted-memories-launcher span { max-width: 105px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
'''


def patch_mind_map_styles() -> None:
    path = "mind-map-source/src/styles.css"
    text = read(path)
    if "Silver Deleted Memories — shared map launcher" not in text:
        text += map_deleted_styles()
    write(path, text)


def patch_mind_map() -> None:
    patch_mind_map_deleted_module()
    write("mind-map-source/src/components/DeletedMemoriesButton.tsx", deleted_memories_launcher_component())
    patch_mind_map_store()
    patch_mind_map_start_menu()
    patch_mind_map_app()
    patch_mind_map_styles()


def strengthen_deleted_memory_engine() -> None:
    path = "deleted-memories.js"
    text = read(path)
    if "async function scrubThoughtFromTrashedMap" not in text:
        helper = r'''async function scrubThoughtFromTrashedMap(memory, records) {
  if (memory?.kind !== 'mind-map-thought') return;
  const mapId = memory.payload?.mapId;
  const thoughtId = memory.payload?.thought?.id || memory.originalId;
  if (!mapId || !thoughtId) return;
  const mapMemory = records.find(record => record.kind === 'mind-map' && (record.payload?.mapId || record.originalId) === mapId);
  const sourceDocument = mapMemory?.payload?.document;
  if (!mapMemory || !sourceDocument) return;
  const document = structuredClone(sourceDocument);
  document.thoughts = (document.thoughts || []).filter(thought => thought.id !== thoughtId);
  document.links = (document.links || []).filter(link => link.from !== thoughtId && link.to !== thoughtId);
  document.pins = (document.pins || []).filter(id => id !== thoughtId);
  document.history = (document.history || []).filter(id => id !== thoughtId);
  document.historyIndex = Math.max(0, Math.min(document.historyIndex || 0, Math.max(0, document.history.length - 1)));
  if (document.activeId === thoughtId) document.activeId = document.homeId;
  document.updatedAt = new Date().toISOString();
  const db = await openDatabase();
  const transaction = db.transaction(DELETED_MEMORY_STORE, 'readwrite');
  const completion = transactionDone(transaction);
  transaction.objectStore(DELETED_MEMORY_STORE).put({
    ...mapMemory,
    summary: `${document.thoughts.filter(thought => !thought.forgotten).length} active thoughts`,
    payload: { ...mapMemory.payload, document }
  });
  await completion;
}

'''
        text = replace_once(
            text,
            "function relatedThoughtMemoryIds(records, mapId) {",
            helper + "function relatedThoughtMemoryIds(records, mapId) {",
            "trashed-map thought scrubbing helper",
        )
    old_purge = r'''  const ids = new Set(expired.map(record => record.id));
  expired.forEach(record => {
    finalizeForgottenThought(record);
    if (record.kind === 'mind-map') relatedThoughtMemoryIds(records, record.payload?.mapId || record.originalId).forEach(id => ids.add(id));
  });
  await deleteRecords([...ids], 'expired');'''
    new_purge = r'''  const ids = new Set(expired.map(record => record.id));
  for (const record of expired) {
    finalizeForgottenThought(record);
    await scrubThoughtFromTrashedMap(record, records);
    if (record.kind === 'mind-map') relatedThoughtMemoryIds(records, record.payload?.mapId || record.originalId).forEach(id => ids.add(id));
  }
  await deleteRecords([...ids], 'expired');'''
    if old_purge in text:
        text = text.replace(old_purge, new_purge, 1)
    if "await scrubThoughtFromTrashedMap(memory, records);" not in text[text.find("export async function permanentlyDeleteDeletedMemory"):]:
        text = replace_once(
            text,
            "  finalizeForgottenThought(memory);\n  const ids = new Set([id]);",
            "  finalizeForgottenThought(memory);\n  await scrubThoughtFromTrashedMap(memory, records);\n  const ids = new Set([id]);",
            "permanent thought-data scrubbing",
        )
    write(path, text)


def patch_runtime_files() -> None:
    bootstrap_path = "bootstrap.js"
    bootstrap = read(bootstrap_path)
    bootstrap = regex_once(
        bootstrap,
        r"const BUILD = '[^']+';",
        f"const BUILD = '{BUILD}';",
        "Silver runtime build identifier",
    )
    write(bootstrap_path, bootstrap)

    index_path = "index.html"
    index = read(index_path)
    index, count = re.subn(r"bootstrap\.js\?v=[^\"']+", f"bootstrap.js?v={BUILD}", index, count=1)
    if count != 1:
        raise RuntimeError(f"Expected one Silver bootstrap URL; found {count}.")
    write(index_path, index)

    sw_path = "sw.js"
    sw = read(sw_path)
    sw = regex_once(
        sw,
        r"const CACHE_NAME = '[^']+';",
        "const CACHE_NAME = 'silver-shell-v6-deleted-memories';",
        "Silver service-worker cache name",
    )
    if "'./deleted-memories.js'" not in sw:
        sw = replace_once(
            sw,
            "  './db.js', './archive.js', './manifest.webmanifest', './icons/silver-mark.svg'",
            "  './db.js', './archive.js', './deleted-memories.js', './manifest.webmanifest', './icons/silver-mark.svg'",
            "Deleted Memories offline shell entry",
        )
    if "url.pathname.endsWith('/deleted-memories.js')" not in sw:
        sw = replace_once(
            sw,
            "    || url.pathname.endsWith('/bootstrap.js')\n    || url.pathname.includes('/src/')",
            "    || url.pathname.endsWith('/bootstrap.js')\n    || url.pathname.endsWith('/deleted-memories.js')\n    || url.pathname.includes('/src/')",
            "Deleted Memories service-worker runtime policy",
        )
    write(sw_path, sw)


def patch_assembly_script() -> None:
    path = "tools/assemble-silver-pages.sh"
    text = read(path)
    text = text.replace("20260903-map-your-mind-1", BUILD)
    if "node --check deleted-memories.js" not in text:
        text = replace_once(
            text,
            "node --check archive.js\nnode --check sw.js",
            "node --check archive.js\nnode --check deleted-memories.js\nnode --check sw.js",
            "Deleted Memories syntax check",
        )
    if "Silver Deleted Memories" not in text:
        text = replace_once(
            text,
            "grep -Fq 'Silver Map Your Mind integration' src/styles.css",
            "grep -Fq 'Silver Map Your Mind integration' src/styles.css\n"
            "grep -Fq 'Silver Deleted Memories' src/styles.css\n"
            "grep -Fq 'data-view=\"deleted\"' src/shell.html\n"
            "grep -Fq 'restore-deleted-memory' src/app.js\n"
            "grep -Fq \"deletedMemories: 'deletedMemories'\" db.js",
            "Deleted Memories release assertions",
        )
    if "mind-map-source/src/components/DeletedMemoriesButton.tsx" not in text:
        text = replace_once(
            text,
            "test -s mind-map-source/src/components/Plex.tsx\ntest -s mind-map-source/src/lib/store.ts",
            "test -s mind-map-source/src/components/Plex.tsx\n"
            "test -s mind-map-source/src/components/DeletedMemoriesButton.tsx\n"
            "test -s mind-map-source/src/lib/deleted-memories.ts\n"
            "test -s mind-map-source/src/lib/store.ts",
            "mind-map recovery source assertions",
        )
    if "grep -Fq 'Deleted Memories' mind-map/assets/app.js" not in text:
        text = replace_once(
            text,
            "grep -Fq '/Silver/mind-map/assets/app.css' mind-map/index.html",
            "grep -Fq '/Silver/mind-map/assets/app.css' mind-map/index.html\n"
            "grep -Fq 'Deleted Memories' mind-map/assets/app.js\n"
            "grep -Fq 'silver-open-deleted-memories' mind-map/assets/app.js",
            "built mind-map recovery assertions",
        )
    text = text.replace(
        "cp index.html bootstrap.js db.js archive.js sw.js manifest.webmanifest .nojekyll \"$SITE_DIR/\"",
        "cp index.html bootstrap.js db.js archive.js deleted-memories.js sw.js manifest.webmanifest .nojekyll \"$SITE_DIR/\"",
        1,
    )
    if 'test -s "$SITE_DIR/deleted-memories.js"' not in text:
        text = replace_once(
            text,
            'test -s "$SITE_DIR/bootstrap.js"',
            'test -s "$SITE_DIR/bootstrap.js"\ntest -s "$SITE_DIR/deleted-memories.js"',
            "published Deleted Memories engine assertion",
        )
    write(path, text)


def patch_published_verification() -> None:
    path = "tools/verify-published-pages.sh"
    text = read(path)
    text = text.replace("20260903-map-your-mind-1", BUILD)
    if "  deleted-memories.js" not in text:
        text = replace_once(
            text,
            "  archive.js\n  sw.js",
            "  archive.js\n  deleted-memories.js\n  sw.js",
            "published Deleted Memories engine comparison",
        )
    if 'node --check "$OUTPUT_DIR/deleted-memories.js"' not in text:
        text = replace_once(
            text,
            'node --check "$OUTPUT_DIR/bootstrap.js"\nnode --check "$OUTPUT_DIR/sw.js"',
            'node --check "$OUTPUT_DIR/bootstrap.js"\nnode --check "$OUTPUT_DIR/deleted-memories.js"\nnode --check "$OUTPUT_DIR/sw.js"',
            "published Deleted Memories syntax verification",
        )
    if "restore-deleted-memory" not in text:
        text = replace_once(
            text,
            "grep -Fq 'data-action=\"open-mind-map\"' \"$OUTPUT_DIR/src/app.js\"",
            "grep -Fq 'data-action=\"open-mind-map\"' \"$OUTPUT_DIR/src/app.js\"\n"
            "grep -Fq 'restore-deleted-memory' \"$OUTPUT_DIR/src/app.js\"\n"
            "grep -Fq 'data-view=\"deleted\"' \"$OUTPUT_DIR/src/shell.html\"\n"
            "grep -Fq '30 * 24 * 60 * 60 * 1000' \"$OUTPUT_DIR/deleted-memories.js\"",
            "published Deleted Memories behavior assertions",
        )
    if "grep -Fq 'Deleted Memories' \"$OUTPUT_DIR/mind-map/assets/app.js\"" not in text:
        text = replace_once(
            text,
            "grep -Fq '/Silver/mind-map/assets/app.js' \"$OUTPUT_DIR/mind-map/index.html\"",
            "grep -Fq '/Silver/mind-map/assets/app.js' \"$OUTPUT_DIR/mind-map/index.html\"\n"
            "grep -Fq 'Deleted Memories' \"$OUTPUT_DIR/mind-map/assets/app.js\"\n"
            "grep -Fq 'silver-open-deleted-memories' \"$OUTPUT_DIR/mind-map/assets/app.js\"",
            "published mind-map recovery assertions",
        )
    write(path, text)


def patch_readme() -> None:
    path = "README.md"
    text = read(path)
    heading = "## Deleted Memories"
    section = f'''

{heading}

Silver uses one shared, device-local recovery store for the journal and Map Your Mind. Deleting a journal entry, saved media attachment, journal, collection, writing template, mind map, mind-map thought or mind-map attachment moves it into **Deleted Memories** rather than destroying it immediately.

The recovery button is fixed at the lower-left of the Silver sidebar and at the lower-left of both mind-map screens. Both buttons open the same recovery page. Each item shows its exact expiry, can be restored, or can be permanently deleted immediately. Items automatically become permanently unavailable 30 days after deletion; Silver performs expiry cleanup at startup, while visible, during hourly checks and whenever either application observes a recovery-store change.

The original `dream-unity/theory` repository remains untouched. Only Silver's isolated vendored copy contains the recovery bridge.
'''
    if heading not in text:
        text += section
    write(path, text)


def patch_tooling() -> None:
    patch_runtime_files()
    patch_assembly_script()
    patch_published_verification()
    patch_readme()


def correct_mind_map_attachment_type() -> None:
    path = "mind-map-source/src/lib/deleted-memories.ts"
    text = read(path)
    text = text.replace(
        "attachment: { id: string; title: string; url: string },",
        "attachment: { id: string; title: string; url?: string },",
        1,
    )
    write(path, text)


def verify_source() -> None:
    required = [
        "deleted-memories.js",
        "src/app.js",
        "src/shell.html",
        "src/styles.css",
        "mind-map-source/src/App.tsx",
        "mind-map-source/src/components/StartMenu.tsx",
        "mind-map-source/src/components/DeletedMemoriesButton.tsx",
        "mind-map-source/src/lib/deleted-memories.ts",
        "mind-map-source/src/lib/store.ts",
        "mind-map-source/src/styles.css",
    ]
    for relative in required:
        path = ROOT / relative
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Required Deleted Memories file is missing: {relative}")

    db = read("db.js")
    app = read("src/app.js")
    shell = read("src/shell.html")
    styles = read("src/styles.css")
    engine = read("deleted-memories.js")
    map_app = read("mind-map-source/src/App.tsx")
    map_menu = read("mind-map-source/src/components/StartMenu.tsx")
    map_store = read("mind-map-source/src/lib/store.ts")
    map_engine = read("mind-map-source/src/lib/deleted-memories.ts")
    map_styles = read("mind-map-source/src/styles.css")
    bootstrap = read("bootstrap.js")
    index = read("index.html")
    service_worker = read("sw.js")

    checks = {
        "database upgrade": "const DB_VERSION = 2;" in db and "deletedMemories: 'deletedMemories'" in db,
        "database schema": "createObjectStore(STORES.deletedMemories" in db,
        "30-day retention": "30 * 24 * 60 * 60 * 1000" in engine,
        "journal entry soft delete": "moveJournalEntryToDeletedMemories(state.editorEntryId)" in app,
        "attachment soft delete": "map(moveJournalAttachmentToDeletedMemories)" in app,
        "journal soft delete": "moveJournalToDeletedMemories(journal.id, fallback.id)" in app,
        "collection soft delete": "moveCollectionToDeletedMemories(collectionId)" in app,
        "template soft delete": "moveTemplateToDeletedMemories(templateId)" in app,
        "recovery view": "renderDeletedMemories" in app and "restore-deleted-memory" in app,
        "permanent deletion": "permanently-delete-memory" in app and "empty-deleted-memories" in app,
        "Silver launcher": 'id="deletedMemoriesButton"' in shell and 'data-view="deleted"' in shell,
        "Silver recovery styles": MARKER in styles,
        "map launcher": "DeletedMemoriesButton" in map_app and "DeletedMemoriesButton" in map_menu,
        "map deletion": "deleteBrainToDeletedMemories" in map_app and "moveMindMapToDeletedMemories" in map_store,
        "map delete controls": map_app.count("deleteBrainWithRecovery(id)") >= 2,
        "thought deletion": "moveMindMapThoughtToDeletedMemories" in map_app,
        "thought delete controls": "onForget={(id) => void forgetThoughtWithRecovery(id)}" in map_app and "onForget={() => void forgetThoughtWithRecovery(safeActive.id)}" in map_app,
        "map attachment deletion": "moveMindMapAttachmentToDeletedMemories" in map_app,
        "shared map bridge": "silver-open-deleted-memories" in map_engine,
        "map recovery styles": "Silver Deleted Memories — shared map launcher" in map_styles,
        "new runtime build": BUILD in bootstrap and BUILD in index,
        "offline engine": "'./deleted-memories.js'" in service_worker,
        "recorder marker retained": "20260901-recorder-viewport-2" in index,
        "Map Your Mind retained": 'data-action="open-mind-map"' in app,
        "media playback retained": 'data-action="open-media"' in app,
    }
    failures = [name for name, passed in checks.items() if not passed]
    if failures:
        raise RuntimeError("Deleted Memories source verification failed: " + ", ".join(failures))

    if "Permanently delete this entry and every attached media file" in app:
        raise RuntimeError("The old permanent entry-deletion path is still reachable.")
    if "onForget={(id) => setDoc" in map_app or "onForget={() => setDoc" in map_app:
        raise RuntimeError("A user-facing thought deletion still bypasses Deleted Memories.")


def apply_all() -> None:
    patch_database()
    patch_deleted_memory_engine()
    strengthen_deleted_memory_engine()
    patch_root_app()
    patch_root_shell()
    patch_root_styles()
    patch_mind_map()
    correct_mind_map_attachment_type()
    patch_tooling()
    verify_source()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="verify an already-patched checkout")
    args = parser.parse_args()
    if args.verify_only:
        verify_source()
    else:
        apply_all()
    print("Deleted Memories source verification passed.")


if __name__ == "__main__":
    main()
