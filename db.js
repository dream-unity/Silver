const DB_NAME = 'silver-private-journal';
const DB_VERSION = 1;

const STORES = Object.freeze({
  journals: 'journals',
  collections: 'collections',
  entries: 'entries',
  attachments: 'attachments',
  templates: 'templates',
  settings: 'settings'
});

let databasePromise;

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('The local journal operation failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('The local journal transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('The local journal transaction was cancelled.'));
  });
}

export function uid(prefix = '') {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return prefix ? `${prefix}-${id}` : id;
}

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('This browser does not support the private local database Silver requires.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORES.collections)) {
        const store = db.createObjectStore(STORES.collections, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.journals)) {
        const store = db.createObjectStore(STORES.journals, { keyPath: 'id' });
        store.createIndex('collectionId', 'collectionId', { unique: false });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.entries)) {
        const store = db.createObjectStore(STORES.entries, { keyPath: 'id' });
        store.createIndex('journalId', 'journalId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('favorite', 'favorite', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.attachments)) {
        const store = db.createObjectStore(STORES.attachments, { keyPath: 'id' });
        store.createIndex('entryId', 'entryId', { unique: false });
        store.createIndex('kind', 'kind', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.templates)) {
        const store = db.createObjectStore(STORES.templates, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Silver could not open its local database.'));
    request.onblocked = () => reject(new Error('Close other Silver tabs, then reload this page.'));
  });
  return databasePromise;
}

async function runStore(storeName, mode, callback) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, mode);
  const completion = transactionDone(transaction);
  const store = transaction.objectStore(storeName);
  try {
    const operation = callback(store, transaction);
    const [result] = await Promise.all([operation, completion]);
    return result;
  } catch (error) {
    try { transaction.abort(); } catch {}
    throw error;
  }
}

export async function getAll(storeName) {
  return runStore(storeName, 'readonly', store => requestValue(store.getAll()));
}

export async function getOne(storeName, id) {
  return runStore(storeName, 'readonly', store => requestValue(store.get(id)));
}

export async function putOne(storeName, value) {
  return runStore(storeName, 'readwrite', store => requestValue(store.put(value)));
}

export async function putMany(storeName, values) {
  if (!values.length) return;
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  const completion = transactionDone(transaction);
  const store = transaction.objectStore(storeName);
  values.forEach(value => store.put(value));
  await completion;
}

export async function deleteOne(storeName, id) {
  return runStore(storeName, 'readwrite', store => requestValue(store.delete(id)));
}

export async function clearStore(storeName) {
  return runStore(storeName, 'readwrite', store => requestValue(store.clear()));
}

export async function getByIndex(storeName, indexName, value) {
  return runStore(storeName, 'readonly', store => requestValue(store.index(indexName).getAll(value)));
}

export async function loadLibrary() {
  const [collections, journals, entries, attachments, templates, settingsRecords] = await Promise.all([
    getAll(STORES.collections),
    getAll(STORES.journals),
    getAll(STORES.entries),
    getAll(STORES.attachments),
    getAll(STORES.templates),
    getAll(STORES.settings)
  ]);
  return {
    collections,
    journals,
    entries,
    attachments,
    templates,
    settings: Object.fromEntries(settingsRecords.map(record => [record.key, record.value]))
  };
}

export async function saveSetting(key, value) {
  await putOne(STORES.settings, { key, value });
  return value;
}

export async function removeSetting(key) {
  await deleteOne(STORES.settings, key);
}

export async function saveEntry(entry, attachments = []) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.entries, STORES.attachments], 'readwrite');
  const completion = transactionDone(transaction);
  transaction.objectStore(STORES.entries).put(entry);
  const attachmentStore = transaction.objectStore(STORES.attachments);
  attachments.forEach(attachment => attachmentStore.put(attachment));
  await completion;
}

export async function deleteEntry(entryId) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.entries, STORES.attachments], 'readwrite');
  const completion = transactionDone(transaction);
  transaction.objectStore(STORES.entries).delete(entryId);
  const attachmentStore = transaction.objectStore(STORES.attachments);
  const index = attachmentStore.index('entryId');
  const request = index.openCursor(IDBKeyRange.only(entryId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await completion;
}

export async function deleteAttachment(attachmentId) {
  await deleteOne(STORES.attachments, attachmentId);
}

export async function saveJournal(journal) {
  await putOne(STORES.journals, journal);
}

export async function deleteJournal(journalId, fallbackJournalId) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.journals, STORES.entries], 'readwrite');
  const completion = transactionDone(transaction);
  const journalStore = transaction.objectStore(STORES.journals);
  const entryStore = transaction.objectStore(STORES.entries);
  const index = entryStore.index('journalId');
  const request = index.openCursor(IDBKeyRange.only(journalId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.update({ ...cursor.value, journalId: fallbackJournalId, updatedAt: Date.now() });
    cursor.continue();
  };
  journalStore.delete(journalId);
  await completion;
}

export async function saveCollection(collection) {
  await putOne(STORES.collections, collection);
}

export async function deleteCollection(collectionId) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.collections, STORES.journals], 'readwrite');
  const completion = transactionDone(transaction);
  transaction.objectStore(STORES.collections).delete(collectionId);
  const journalStore = transaction.objectStore(STORES.journals);
  const request = journalStore.index('collectionId').openCursor(IDBKeyRange.only(collectionId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.update({ ...cursor.value, collectionId: '' });
    cursor.continue();
  };
  await completion;
}

export async function saveTemplate(template) {
  await putOne(STORES.templates, template);
}

export async function deleteTemplate(templateId) {
  await deleteOne(STORES.templates, templateId);
}

export async function importLibrary(library, { replace = false } = {}) {
  const db = await openDatabase();
  const storeNames = Object.values(STORES);
  const transaction = db.transaction(storeNames, 'readwrite');
  const completion = transactionDone(transaction);

  if (replace) storeNames.forEach(name => transaction.objectStore(name).clear());

  (library.collections || []).forEach(value => transaction.objectStore(STORES.collections).put(value));
  (library.journals || []).forEach(value => transaction.objectStore(STORES.journals).put(value));
  (library.entries || []).forEach(value => transaction.objectStore(STORES.entries).put(value));
  (library.attachments || []).forEach(value => transaction.objectStore(STORES.attachments).put(value));
  (library.templates || []).forEach(value => transaction.objectStore(STORES.templates).put(value));
  Object.entries(library.settings || {}).forEach(([key, value]) => transaction.objectStore(STORES.settings).put({ key, value }));

  await completion;
}

export async function eraseLibrary() {
  const db = await openDatabase();
  const storeNames = Object.values(STORES);
  const transaction = db.transaction(storeNames, 'readwrite');
  const completion = transactionDone(transaction);
  storeNames.forEach(name => transaction.objectStore(name).clear());
  await completion;
}

export async function ensureSeedData() {
  const library = await loadLibrary();
  const now = Date.now();
  let changed = false;

  if (!library.collections.length) {
    const collection = { id: 'collection-life', name: 'Life', createdAt: now, updatedAt: now };
    await saveCollection(collection);
    library.collections.push(collection);
    changed = true;
  }

  if (!library.journals.length) {
    const journal = {
      id: 'journal-personal',
      name: 'Personal',
      colour: '#7c88a5',
      collectionId: 'collection-life',
      createdAt: now,
      updatedAt: now,
      isDefault: true
    };
    await saveJournal(journal);
    library.journals.push(journal);
    changed = true;
  }

  if (!library.templates.length) {
    const templates = [
      {
        id: 'template-daily-reflection',
        name: 'Daily reflection',
        body: '## What happened\n\n\n## What I noticed\n\n\n## What matters now\n\n',
        createdAt: now,
        builtIn: true
      },
      {
        id: 'template-dream',
        name: 'Dream record',
        body: '## What I remember\n\n\n## Images, people and places\n\n\n## Feeling tone\n\n\n## Possible meaning\n\n',
        createdAt: now + 1,
        builtIn: true
      },
      {
        id: 'template-gratitude',
        name: 'Gratitude',
        body: '## Three things I appreciate\n\n- \n- \n- \n\n## Why they mattered today\n\n',
        createdAt: now + 2,
        builtIn: true
      },
      {
        id: 'template-decision',
        name: 'Decision record',
        body: '## Decision\n\n\n## Facts\n\n\n## Assumptions\n\n\n## Options\n\n\n## Chosen action and why\n\n',
        createdAt: now + 3,
        builtIn: true
      }
    ];
    await putMany(STORES.templates, templates);
    library.templates.push(...templates);
    changed = true;
  }

  const defaults = {
    theme: 'system',
    reminderTime: '',
    autoLockMinutes: 0,
    mediaFilter: 'all'
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in library.settings)) {
      await saveSetting(key, value);
      library.settings[key] = value;
      changed = true;
    }
  }

  return changed ? loadLibrary() : library;
}

export { STORES };
