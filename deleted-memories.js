import { openDatabase, STORES, uid } from './db.js';

export const DELETED_MEMORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DELETED_MEMORY_STORE = STORES.deletedMemories || 'deletedMemories';
export const DELETED_MEMORY_EVENT = 'silver-deleted-memories-changed';
export const DELETED_MEMORY_CHANNEL = 'silver-deleted-memories-v1';
const SIGNAL_KEY = 'silver-deleted-memories-signal-v1';
const MAP_LIBRARY_KEY = 'dream-unity-library-v1';
const MAP_DOCUMENT_KEY = id => `dream-unity-brain-v4:${id}`;
let sharedChannel = null;

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('The Deleted Memories operation failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('The Deleted Memories transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('The Deleted Memories transaction was cancelled.'));
  });
}

function channel() {
  if (!sharedChannel && 'BroadcastChannel' in globalThis) {
    try { sharedChannel = new BroadcastChannel(DELETED_MEMORY_CHANNEL); } catch { /* unavailable */ }
  }
  return sharedChannel;
}

export function notifyDeletedMemoriesChanged(reason = 'changed') {
  const detail = { reason, at: Date.now() };
  try { globalThis.dispatchEvent?.(new CustomEvent(DELETED_MEMORY_EVENT, { detail })); } catch { /* non-window context */ }
  try { channel()?.postMessage(detail); } catch { /* unavailable */ }
  try { localStorage.setItem(SIGNAL_KEY, JSON.stringify(detail)); } catch { /* private mode */ }
}

export function subscribeDeletedMemories(listener) {
  const localHandler = event => listener(event.detail || { reason: 'changed', at: Date.now() });
  const storageHandler = event => {
    if (event.key === SIGNAL_KEY) listener({ reason: 'storage', at: Date.now() });
  };
  const broadcastHandler = event => listener(event.data || { reason: 'broadcast', at: Date.now() });
  globalThis.addEventListener?.(DELETED_MEMORY_EVENT, localHandler);
  globalThis.addEventListener?.('storage', storageHandler);
  const bus = channel();
  bus?.addEventListener('message', broadcastHandler);
  return () => {
    globalThis.removeEventListener?.(DELETED_MEMORY_EVENT, localHandler);
    globalThis.removeEventListener?.('storage', storageHandler);
    bus?.removeEventListener('message', broadcastHandler);
  };
}

function cleanText(value = '', limit = 220) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function deletedMemoryRecord({ kind, originalId = '', title = '', summary = '', sourceTitle = '', payload, deletedAt = Date.now() }) {
  const timestamp = Number(deletedAt) || Date.now();
  return {
    id: uid('deleted'),
    schemaVersion: 1,
    kind,
    originalId: String(originalId || ''),
    title: cleanText(title || 'Untitled memory', 240),
    summary: cleanText(summary, 320),
    sourceTitle: cleanText(sourceTitle, 180),
    deletedAt: timestamp,
    expiresAt: timestamp + DELETED_MEMORY_RETENTION_MS,
    payload
  };
}

async function getDeletedMemoryRaw(id) {
  const db = await openDatabase();
  const transaction = db.transaction(DELETED_MEMORY_STORE, 'readonly');
  const completion = transactionDone(transaction);
  const value = await requestValue(transaction.objectStore(DELETED_MEMORY_STORE).get(id));
  await completion;
  return value || null;
}

async function getAllDeletedMemoriesRaw() {
  const db = await openDatabase();
  const transaction = db.transaction(DELETED_MEMORY_STORE, 'readonly');
  const completion = transactionDone(transaction);
  const values = await requestValue(transaction.objectStore(DELETED_MEMORY_STORE).getAll());
  await completion;
  return values || [];
}

async function putDeletedMemory(record, reason = 'deleted') {
  const db = await openDatabase();
  const transaction = db.transaction(DELETED_MEMORY_STORE, 'readwrite');
  const completion = transactionDone(transaction);
  transaction.objectStore(DELETED_MEMORY_STORE).put(record);
  await completion;
  notifyDeletedMemoriesChanged(reason);
  return record;
}

function readMapLibrary() {
  try {
    const raw = localStorage.getItem(MAP_LIBRARY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.schemaVersion === 1 && Array.isArray(parsed.items)
      ? parsed
      : { schemaVersion: 1, activeId: null, items: [] };
  } catch {
    return { schemaVersion: 1, activeId: null, items: [] };
  }
}

function writeMapLibrary(library) {
  localStorage.setItem(MAP_LIBRARY_KEY, JSON.stringify(library));
}

function mapMetaFromDocument(id, document, template) {
  const home = document?.thoughts?.find(thought => thought.id === document.homeId) || document?.thoughts?.[0];
  return {
    id,
    title: document?.title || home?.name || 'Untitled',
    updatedAt: document?.updatedAt || new Date().toISOString(),
    thoughtCount: (document?.thoughts || []).filter(thought => !thought.forgotten).length,
    homeName: home?.name || document?.title || 'Untitled',
    color: home?.color || '#94a3b8',
    template
  };
}

function mapIdAvailable(id, library) {
  return !localStorage.getItem(MAP_DOCUMENT_KEY(id)) && !library.items.some(item => item.id === id);
}

function uniqueMapId(library) {
  let id = uid('b');
  while (!mapIdAvailable(id, library)) id = uid('b');
  return id;
}

function uniqueRecordId(existingIds, prefix) {
  let id = uid(prefix);
  while (existingIds.has(id)) id = uid(prefix);
  existingIds.add(id);
  return id;
}

function finalizeForgottenThought(memory) {
  if (memory?.kind !== 'mind-map-thought') return;
  const mapId = memory.payload?.mapId;
  const thoughtId = memory.payload?.thought?.id || memory.originalId;
  if (!mapId || !thoughtId) return;
  try {
    const key = MAP_DOCUMENT_KEY(mapId);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const document = JSON.parse(raw);
    const thought = document?.thoughts?.find(item => item.id === thoughtId);
    if (!thought?.forgotten) return;
    document.thoughts = document.thoughts.filter(item => item.id !== thoughtId);
    document.links = (document.links || []).filter(link => link.from !== thoughtId && link.to !== thoughtId);
    document.pins = (document.pins || []).filter(id => id !== thoughtId);
    document.history = (document.history || []).filter(id => id !== thoughtId);
    document.historyIndex = Math.max(0, Math.min(document.historyIndex || 0, Math.max(0, document.history.length - 1)));
    if (document.activeId === thoughtId) document.activeId = document.homeId;
    document.updatedAt = new Date().toISOString();
    localStorage.setItem(key, JSON.stringify(document));
    const library = readMapLibrary();
    const next = {
      ...library,
      items: library.items.map(item => item.id === mapId ? mapMetaFromDocument(mapId, document, item.template) : item)
    };
    writeMapLibrary(next);
  } catch {
    /* The recovery record can still expire if local map storage is unavailable. */
  }
}

function relatedThoughtMemoryIds(records, mapId) {
  return records
    .filter(record => record.kind === 'mind-map-thought' && record.payload?.mapId === mapId)
    .map(record => record.id);
}

async function deleteRecords(ids, reason) {
  if (!ids.length) return 0;
  const db = await openDatabase();
  const transaction = db.transaction(DELETED_MEMORY_STORE, 'readwrite');
  const completion = transactionDone(transaction);
  const store = transaction.objectStore(DELETED_MEMORY_STORE);
  ids.forEach(id => store.delete(id));
  await completion;
  notifyDeletedMemoriesChanged(reason);
  return ids.length;
}

export async function purgeExpiredDeletedMemories(now = Date.now()) {
  const records = await getAllDeletedMemoriesRaw();
  const expired = records.filter(record => Number(record.expiresAt || 0) <= now);
  if (!expired.length) return 0;
  const ids = new Set(expired.map(record => record.id));
  expired.forEach(record => {
    finalizeForgottenThought(record);
    if (record.kind === 'mind-map') relatedThoughtMemoryIds(records, record.payload?.mapId || record.originalId).forEach(id => ids.add(id));
  });
  await deleteRecords([...ids], 'expired');
  return ids.size;
}

export async function loadDeletedMemories({ purge = true } = {}) {
  if (purge) await purgeExpiredDeletedMemories();
  const records = await getAllDeletedMemoriesRaw();
  return records.sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));
}

export async function getDeletedMemoryCount() {
  return (await loadDeletedMemories()).length;
}

export async function moveJournalEntryToDeletedMemories(entryId) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.entries, STORES.attachments, DELETED_MEMORY_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const entryStore = transaction.objectStore(STORES.entries);
  const attachmentStore = transaction.objectStore(STORES.attachments);
  const [entry, attachments] = await Promise.all([
    requestValue(entryStore.get(entryId)),
    requestValue(attachmentStore.index('entryId').getAll(entryId))
  ]);
  if (!entry) {
    try { transaction.abort(); } catch { /* already complete */ }
    throw new Error('This journal entry no longer exists.');
  }
  const record = deletedMemoryRecord({
    kind: 'journal-entry',
    originalId: entry.id,
    title: entry.title || cleanText(entry.body, 80) || 'Untitled journal entry',
    summary: cleanText(entry.body, 240) || `${attachments.length} attached media ${attachments.length === 1 ? 'file' : 'files'}`,
    sourceTitle: 'Silver journal',
    payload: { entry, attachments }
  });
  transaction.objectStore(DELETED_MEMORY_STORE).put(record);
  entryStore.delete(entryId);
  attachments.forEach(attachment => attachmentStore.delete(attachment.id));
  await completion;
  notifyDeletedMemoriesChanged('journal-entry-deleted');
  return record;
}

export async function moveJournalAttachmentToDeletedMemories(attachmentId) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.entries, STORES.attachments, DELETED_MEMORY_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const attachmentStore = transaction.objectStore(STORES.attachments);
  const attachment = await requestValue(attachmentStore.get(attachmentId));
  if (!attachment) {
    try { transaction.abort(); } catch { /* already complete */ }
    return null;
  }
  const entry = await requestValue(transaction.objectStore(STORES.entries).get(attachment.entryId));
  const record = deletedMemoryRecord({
    kind: 'journal-attachment',
    originalId: attachment.id,
    title: attachment.name || `${attachment.kind || 'Media'} attachment`,
    summary: entry?.title ? `Removed from “${entry.title}”.` : 'Removed from a journal entry.',
    sourceTitle: entry?.title || 'Silver journal',
    payload: { attachment, entryId: attachment.entryId }
  });
  transaction.objectStore(DELETED_MEMORY_STORE).put(record);
  attachmentStore.delete(attachmentId);
  await completion;
  notifyDeletedMemoriesChanged('journal-attachment-deleted');
  return record;
}

export async function moveJournalToDeletedMemories(journalId, fallbackJournalId) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.journals, STORES.entries, DELETED_MEMORY_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const journalStore = transaction.objectStore(STORES.journals);
  const entryStore = transaction.objectStore(STORES.entries);
  const [journal, entries, fallback] = await Promise.all([
    requestValue(journalStore.get(journalId)),
    requestValue(entryStore.index('journalId').getAll(journalId)),
    requestValue(journalStore.get(fallbackJournalId))
  ]);
  if (!journal || !fallback) {
    try { transaction.abort(); } catch { /* already complete */ }
    throw new Error('Silver could not find the journal or its safe destination.');
  }
  const record = deletedMemoryRecord({
    kind: 'journal',
    originalId: journal.id,
    title: journal.name || 'Journal',
    summary: `${entries.length} ${entries.length === 1 ? 'entry was' : 'entries were'} preserved in “${fallback.name}”.`,
    sourceTitle: 'Silver journals',
    payload: { journal, fallbackJournalId, entryIds: entries.map(entry => entry.id) }
  });
  transaction.objectStore(DELETED_MEMORY_STORE).put(record);
  entries.forEach(entry => entryStore.put({ ...entry, journalId: fallbackJournalId, updatedAt: Date.now() }));
  if (journal.isDefault && !fallback.isDefault) journalStore.put({ ...fallback, isDefault: true, updatedAt: Date.now() });
  journalStore.delete(journalId);
  await completion;
  notifyDeletedMemoriesChanged('journal-deleted');
  return record;
}

export async function moveCollectionToDeletedMemories(collectionId) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.collections, STORES.journals, DELETED_MEMORY_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const collectionStore = transaction.objectStore(STORES.collections);
  const journalStore = transaction.objectStore(STORES.journals);
  const [collection, journals] = await Promise.all([
    requestValue(collectionStore.get(collectionId)),
    requestValue(journalStore.index('collectionId').getAll(collectionId))
  ]);
  if (!collection) {
    try { transaction.abort(); } catch { /* already complete */ }
    throw new Error('This collection no longer exists.');
  }
  const record = deletedMemoryRecord({
    kind: 'collection',
    originalId: collection.id,
    title: collection.name || 'Collection',
    summary: `${journals.length} ${journals.length === 1 ? 'journal remains' : 'journals remain'} safely available.`,
    sourceTitle: 'Silver collections',
    payload: { collection, journalIds: journals.map(journal => journal.id) }
  });
  transaction.objectStore(DELETED_MEMORY_STORE).put(record);
  journals.forEach(journal => journalStore.put({ ...journal, collectionId: '', updatedAt: Date.now() }));
  collectionStore.delete(collectionId);
  await completion;
  notifyDeletedMemoriesChanged('collection-deleted');
  return record;
}

export async function moveTemplateToDeletedMemories(templateId) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.templates, DELETED_MEMORY_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const templateStore = transaction.objectStore(STORES.templates);
  const template = await requestValue(templateStore.get(templateId));
  if (!template) {
    try { transaction.abort(); } catch { /* already complete */ }
    throw new Error('This template no longer exists.');
  }
  const record = deletedMemoryRecord({
    kind: 'template',
    originalId: template.id,
    title: template.name || 'Writing template',
    summary: cleanText(template.body, 240),
    sourceTitle: 'Silver templates',
    payload: { template }
  });
  transaction.objectStore(DELETED_MEMORY_STORE).put(record);
  templateStore.delete(templateId);
  await completion;
  notifyDeletedMemoriesChanged('template-deleted');
  return record;
}

export async function saveMindMapDeletedMemory({ mapId, meta, document }) {
  if (!mapId || !document) throw new Error('The mind map could not be prepared for recovery.');
  return putDeletedMemory(deletedMemoryRecord({
    kind: 'mind-map',
    originalId: mapId,
    title: meta?.title || document.title || 'Untitled map',
    summary: `${(document.thoughts || []).filter(thought => !thought.forgotten).length} active thoughts`,
    sourceTitle: 'Map Your Mind',
    payload: { mapId, meta, document }
  }), 'mind-map-deleted');
}

export async function saveMindMapThoughtDeletedMemory({ mapId, mapTitle, thought, links = [], wasPinned = false, wasActive = false }) {
  if (!mapId || !thought) throw new Error('The thought could not be prepared for recovery.');
  return putDeletedMemory(deletedMemoryRecord({
    kind: 'mind-map-thought',
    originalId: thought.id,
    title: thought.name || 'Untitled thought',
    summary: cleanText(thought.notes, 240) || `${links.length} connected ${links.length === 1 ? 'relationship' : 'relationships'}`,
    sourceTitle: mapTitle || 'Map Your Mind',
    payload: { mapId, mapTitle, thought, links, wasPinned, wasActive }
  }), 'mind-map-thought-deleted');
}

async function restoreJournalEntry(memory) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.entries, STORES.attachments, STORES.journals, DELETED_MEMORY_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const entryStore = transaction.objectStore(STORES.entries);
  const attachmentStore = transaction.objectStore(STORES.attachments);
  const journalStore = transaction.objectStore(STORES.journals);
  const payload = memory.payload || {};
  const original = payload.entry;
  if (!original) throw new Error('This recovery record is missing its journal entry.');
  const [collision, journals, existingAttachments] = await Promise.all([
    requestValue(entryStore.get(original.id)),
    requestValue(journalStore.getAll()),
    requestValue(attachmentStore.getAll())
  ]);
  const entryId = collision ? uid('entry') : original.id;
  const journal = journals.find(item => item.id === original.journalId) || journals.find(item => item.isDefault) || journals[0];
  if (!journal) throw new Error('Create a journal before restoring this entry.');
  const attachmentIds = new Set(existingAttachments.map(item => item.id));
  entryStore.put({ ...original, id: entryId, journalId: journal.id, updatedAt: Date.now(), restoredAt: Date.now() });
  (payload.attachments || []).forEach(attachment => {
    const id = attachmentIds.has(attachment.id) ? uniqueRecordId(attachmentIds, 'media') : (attachmentIds.add(attachment.id), attachment.id);
    attachmentStore.put({ ...attachment, id, entryId });
  });
  transaction.objectStore(DELETED_MEMORY_STORE).delete(memory.id);
  await completion;
  return { kind: memory.kind, title: memory.title, restoredId: entryId };
}

async function restoreJournalAttachment(memory) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.entries, STORES.attachments, DELETED_MEMORY_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const attachment = memory.payload?.attachment;
  if (!attachment) throw new Error('This recovery record is missing its media file.');
  const entryId = memory.payload?.entryId || attachment.entryId;
  const entry = await requestValue(transaction.objectStore(STORES.entries).get(entryId));
  if (!entry) {
    try { transaction.abort(); } catch { /* already complete */ }
    const error = new Error('Restore the journal entry that owned this media file first.');
    error.code = 'PARENT_MISSING';
    throw error;
  }
  const attachmentStore = transaction.objectStore(STORES.attachments);
  const collision = await requestValue(attachmentStore.get(attachment.id));
  const id = collision ? uid('media') : attachment.id;
  attachmentStore.put({ ...attachment, id, entryId });
  transaction.objectStore(DELETED_MEMORY_STORE).delete(memory.id);
  await completion;
  return { kind: memory.kind, title: memory.title, restoredId: id };
}

async function restoreJournal(memory) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.journals, STORES.entries, STORES.collections, DELETED_MEMORY_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const original = memory.payload?.journal;
  if (!original) throw new Error('This recovery record is missing its journal.');
  const journalStore = transaction.objectStore(STORES.journals);
  const [collision, journals, collection] = await Promise.all([
    requestValue(journalStore.get(original.id)),
    requestValue(journalStore.getAll()),
    original.collectionId ? requestValue(transaction.objectStore(STORES.collections).get(original.collectionId)) : Promise.resolve(null)
  ]);
  const journalId = collision ? uid('journal') : original.id;
  const hasDefault = journals.some(item => item.isDefault);
  journalStore.put({
    ...original,
    id: journalId,
    collectionId: collection ? original.collectionId : '',
    isDefault: Boolean(original.isDefault && !hasDefault),
    updatedAt: Date.now(),
    restoredAt: Date.now()
  });
  const fallbackId = memory.payload?.fallbackJournalId;
  const entryStore = transaction.objectStore(STORES.entries);
  for (const entryId of memory.payload?.entryIds || []) {
    const entry = await requestValue(entryStore.get(entryId));
    if (entry && entry.journalId === fallbackId) entryStore.put({ ...entry, journalId, updatedAt: Date.now() });
  }
  transaction.objectStore(DELETED_MEMORY_STORE).delete(memory.id);
  await completion;
  return { kind: memory.kind, title: memory.title, restoredId: journalId };
}

async function restoreCollection(memory) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.collections, STORES.journals, DELETED_MEMORY_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const original = memory.payload?.collection;
  if (!original) throw new Error('This recovery record is missing its collection.');
  const collectionStore = transaction.objectStore(STORES.collections);
  const collision = await requestValue(collectionStore.get(original.id));
  const collectionId = collision ? uid('collection') : original.id;
  collectionStore.put({ ...original, id: collectionId, updatedAt: Date.now(), restoredAt: Date.now() });
  const journalStore = transaction.objectStore(STORES.journals);
  for (const journalId of memory.payload?.journalIds || []) {
    const journal = await requestValue(journalStore.get(journalId));
    if (journal && !journal.collectionId) journalStore.put({ ...journal, collectionId, updatedAt: Date.now() });
  }
  transaction.objectStore(DELETED_MEMORY_STORE).delete(memory.id);
  await completion;
  return { kind: memory.kind, title: memory.title, restoredId: collectionId };
}

async function restoreTemplate(memory) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.templates, DELETED_MEMORY_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const original = memory.payload?.template;
  if (!original) throw new Error('This recovery record is missing its template.');
  const templateStore = transaction.objectStore(STORES.templates);
  const collision = await requestValue(templateStore.get(original.id));
  const templateId = collision ? uid('template') : original.id;
  templateStore.put({ ...original, id: templateId, builtIn: false, restoredAt: Date.now() });
  transaction.objectStore(DELETED_MEMORY_STORE).delete(memory.id);
  await completion;
  return { kind: memory.kind, title: memory.title, restoredId: templateId };
}

async function retargetThoughtMemories(oldMapId, newMapId) {
  if (oldMapId === newMapId) return;
  const db = await openDatabase();
  const transaction = db.transaction(DELETED_MEMORY_STORE, 'readwrite');
  const completion = transactionDone(transaction);
  const store = transaction.objectStore(DELETED_MEMORY_STORE);
  const records = await requestValue(store.getAll());
  records
    .filter(record => record.kind === 'mind-map-thought' && record.payload?.mapId === oldMapId)
    .forEach(record => store.put({ ...record, payload: { ...record.payload, mapId: newMapId } }));
  await completion;
}

async function restoreMindMap(memory) {
  const payload = memory.payload || {};
  const document = payload.document;
  if (!document) throw new Error('This recovery record is missing its map.');
  const library = readMapLibrary();
  const originalMapId = payload.mapId || memory.originalId;
  const mapId = mapIdAvailable(originalMapId, library) ? originalMapId : uniqueMapId(library);
  const restoredDocument = {
    ...document,
    updatedAt: new Date().toISOString()
  };
  const meta = mapMetaFromDocument(mapId, restoredDocument, payload.meta?.template);
  try {
    localStorage.setItem(MAP_DOCUMENT_KEY(mapId), JSON.stringify(restoredDocument));
    writeMapLibrary({ ...library, items: [meta, ...library.items.filter(item => item.id !== mapId)] });
  } catch (error) {
    try { localStorage.removeItem(MAP_DOCUMENT_KEY(mapId)); } catch { /* ignore */ }
    throw new Error(`The map could not be restored to browser storage. ${error.message || ''}`.trim());
  }
  await retargetThoughtMemories(originalMapId, mapId);
  await deleteRecords([memory.id], 'mind-map-restored');
  return { kind: memory.kind, title: memory.title, restoredId: mapId };
}

async function restoreMindMapThought(memory) {
  const payload = memory.payload || {};
  const mapId = payload.mapId;
  const originalThought = payload.thought;
  if (!mapId || !originalThought) throw new Error('This recovery record is missing its thought or map reference.');
  const key = MAP_DOCUMENT_KEY(mapId);
  const raw = localStorage.getItem(key);
  if (!raw) {
    const error = new Error('Restore the mind map that owned this thought first.');
    error.code = 'PARENT_MISSING';
    throw error;
  }
  const document = JSON.parse(raw);
  document.thoughts = Array.isArray(document.thoughts) ? document.thoughts : [];
  document.links = Array.isArray(document.links) ? document.links : [];
  const existingIds = new Set(document.thoughts.map(thought => thought.id));
  const existing = document.thoughts.find(thought => thought.id === originalThought.id);
  let thoughtId = originalThought.id;
  if (existing?.forgotten) {
    document.thoughts = document.thoughts.map(thought => thought.id === thoughtId ? { ...thought, ...originalThought, forgotten: false, forgottenAt: undefined } : thought);
  } else if (existing) {
    thoughtId = uniqueRecordId(existingIds, 't');
    document.thoughts.push({ ...originalThought, id: thoughtId, forgotten: false, forgottenAt: undefined });
  } else {
    existingIds.add(thoughtId);
    document.thoughts.push({ ...originalThought, forgotten: false, forgottenAt: undefined });
  }
  const linkIds = new Set(document.links.map(link => link.id));
  for (const originalLink of payload.links || []) {
    const link = {
      ...originalLink,
      id: linkIds.has(originalLink.id) ? uniqueRecordId(linkIds, 'e') : (linkIds.add(originalLink.id), originalLink.id),
      from: originalLink.from === originalThought.id ? thoughtId : originalLink.from,
      to: originalLink.to === originalThought.id ? thoughtId : originalLink.to
    };
    if (!existingIds.has(link.from) || !existingIds.has(link.to)) continue;
    const duplicate = document.links.some(item => item.kind === link.kind && item.from === link.from && item.to === link.to);
    if (!duplicate) document.links.push(link);
  }
  document.pins = Array.isArray(document.pins) ? document.pins : [];
  if (payload.wasPinned && !document.pins.includes(thoughtId)) document.pins.push(thoughtId);
  document.updatedAt = new Date().toISOString();
  localStorage.setItem(key, JSON.stringify(document));
  const library = readMapLibrary();
  writeMapLibrary({
    ...library,
    items: library.items.map(item => item.id === mapId ? mapMetaFromDocument(mapId, document, item.template) : item)
  });
  await deleteRecords([memory.id], 'mind-map-thought-restored');
  return { kind: memory.kind, title: memory.title, restoredId: thoughtId };
}

export async function restoreDeletedMemory(id) {
  const memory = await getDeletedMemoryRaw(id);
  if (!memory) throw new Error('This deleted memory no longer exists.');
  if (Number(memory.expiresAt || 0) <= Date.now()) {
    await permanentlyDeleteDeletedMemory(id, { reason: 'expired' });
    throw new Error('This memory reached its 30-day expiry and has been permanently deleted.');
  }
  let result;
  if (memory.kind === 'journal-entry') result = await restoreJournalEntry(memory);
  else if (memory.kind === 'journal-attachment') result = await restoreJournalAttachment(memory);
  else if (memory.kind === 'journal') result = await restoreJournal(memory);
  else if (memory.kind === 'collection') result = await restoreCollection(memory);
  else if (memory.kind === 'template') result = await restoreTemplate(memory);
  else if (memory.kind === 'mind-map') result = await restoreMindMap(memory);
  else if (memory.kind === 'mind-map-thought') result = await restoreMindMapThought(memory);
  else throw new Error('This version of Silver does not recognise that deleted memory type.');
  notifyDeletedMemoriesChanged('restored');
  return result;
}

export async function permanentlyDeleteDeletedMemory(id, { reason = 'permanently-deleted' } = {}) {
  const records = await getAllDeletedMemoriesRaw();
  const memory = records.find(record => record.id === id);
  if (!memory) return false;
  finalizeForgottenThought(memory);
  const ids = new Set([id]);
  if (memory.kind === 'mind-map') {
    relatedThoughtMemoryIds(records, memory.payload?.mapId || memory.originalId).forEach(relatedId => ids.add(relatedId));
  }
  await deleteRecords([...ids], reason);
  return true;
}

export async function emptyDeletedMemories() {
  const records = await getAllDeletedMemoriesRaw();
  records.forEach(finalizeForgottenThought);
  const db = await openDatabase();
  const transaction = db.transaction(DELETED_MEMORY_STORE, 'readwrite');
  const completion = transactionDone(transaction);
  transaction.objectStore(DELETED_MEMORY_STORE).clear();
  await completion;
  notifyDeletedMemoriesChanged('emptied');
  return records.length;
}

export function deletedMemoryTypeLabel(kind) {
  return ({
    'journal-entry': 'Journal entry',
    'journal-attachment': 'Media attachment',
    journal: 'Journal',
    collection: 'Collection',
    template: 'Writing template',
    'mind-map': 'Mind map',
    'mind-map-thought': 'Mind-map thought'
  })[kind] || 'Deleted memory';
}

export function deletedMemoryRetention(memory, now = Date.now()) {
  const milliseconds = Math.max(0, Number(memory?.expiresAt || 0) - now);
  const totalHours = Math.ceil(milliseconds / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return {
    milliseconds,
    totalHours,
    days,
    hours,
    label: totalHours <= 0
      ? 'Expiring now'
      : days >= 1
        ? `${days} ${days === 1 ? 'day' : 'days'}${hours ? ` ${hours}h` : ''} remaining`
        : `${Math.max(1, hours)}h remaining`
  };
}
