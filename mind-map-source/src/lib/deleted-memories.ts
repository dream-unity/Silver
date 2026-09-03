import type { BrainDocument, BrainMeta, Link, Thought } from '../types'

const DB_NAME = 'silver-private-journal'
const DB_VERSION = 2
const STORE = 'deletedMemories'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const CHANNEL = 'silver-deleted-memories-v1'
const SIGNAL_KEY = 'silver-deleted-memories-signal-v1'
const LIBRARY_KEY = 'dream-unity-library-v1'
const DOC_KEY = (id: string) => `dream-unity-brain-v4:${id}`
let databasePromise: Promise<IDBDatabase> | null = null
let bus: BroadcastChannel | null = null

interface DeletedMemoryRecord {
  id: string
  schemaVersion: 1
  kind: 'mind-map' | 'mind-map-thought'
  originalId: string
  title: string
  summary: string
  sourceTitle: string
  deletedAt: number
  expiresAt: number
  payload: Record<string, unknown>
}

function id(prefix: string) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${value}`
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Deleted Memories could not read local storage.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Deleted Memories could not update local storage.'))
    transaction.onabort = () => reject(transaction.error || new Error('The Deleted Memories update was cancelled.'))
  })
}

function createSchema(db: IDBDatabase) {
  if (!db.objectStoreNames.contains('collections')) {
    const store = db.createObjectStore('collections', { keyPath: 'id' })
    store.createIndex('name', 'name', { unique: false })
    store.createIndex('createdAt', 'createdAt', { unique: false })
  }
  if (!db.objectStoreNames.contains('journals')) {
    const store = db.createObjectStore('journals', { keyPath: 'id' })
    store.createIndex('collectionId', 'collectionId', { unique: false })
    store.createIndex('name', 'name', { unique: false })
    store.createIndex('createdAt', 'createdAt', { unique: false })
  }
  if (!db.objectStoreNames.contains('entries')) {
    const store = db.createObjectStore('entries', { keyPath: 'id' })
    store.createIndex('journalId', 'journalId', { unique: false })
    store.createIndex('createdAt', 'createdAt', { unique: false })
    store.createIndex('updatedAt', 'updatedAt', { unique: false })
    store.createIndex('favorite', 'favorite', { unique: false })
  }
  if (!db.objectStoreNames.contains('attachments')) {
    const store = db.createObjectStore('attachments', { keyPath: 'id' })
    store.createIndex('entryId', 'entryId', { unique: false })
    store.createIndex('kind', 'kind', { unique: false })
    store.createIndex('createdAt', 'createdAt', { unique: false })
  }
  if (!db.objectStoreNames.contains('templates')) {
    const store = db.createObjectStore('templates', { keyPath: 'id' })
    store.createIndex('name', 'name', { unique: false })
  }
  if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' })
  if (!db.objectStoreNames.contains(STORE)) {
    const store = db.createObjectStore(STORE, { keyPath: 'id' })
    store.createIndex('kind', 'kind', { unique: false })
    store.createIndex('deletedAt', 'deletedAt', { unique: false })
    store.createIndex('expiresAt', 'expiresAt', { unique: false })
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('This browser cannot open the shared Deleted Memories database.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => createSchema(request.result)
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error || new Error('The shared Deleted Memories database could not be opened.'))
    request.onblocked = () => reject(new Error('Close another Silver tab, then try again.'))
  })
  return databasePromise
}

function channel() {
  if (!bus && 'BroadcastChannel' in globalThis) {
    try { bus = new BroadcastChannel(CHANNEL) } catch { /* unavailable */ }
  }
  return bus
}

function notify(reason: string) {
  const detail = { reason, at: Date.now() }
  try { channel()?.postMessage(detail) } catch { /* unavailable */ }
  try { localStorage.setItem(SIGNAL_KEY, JSON.stringify(detail)) } catch { /* private mode */ }
}

function record(input: Omit<DeletedMemoryRecord, 'id' | 'schemaVersion' | 'deletedAt' | 'expiresAt'>): DeletedMemoryRecord {
  const deletedAt = Date.now()
  return {
    ...input,
    id: id('deleted'),
    schemaVersion: 1,
    deletedAt,
    expiresAt: deletedAt + RETENTION_MS,
  }
}

async function allRecords(): Promise<DeletedMemoryRecord[]> {
  const db = await openDatabase()
  const transaction = db.transaction(STORE, 'readonly')
  const completion = transactionDone(transaction)
  const values = await requestValue(transaction.objectStore(STORE).getAll()) as DeletedMemoryRecord[]
  await completion
  return values
}

async function put(value: DeletedMemoryRecord, reason: string) {
  const db = await openDatabase()
  const transaction = db.transaction(STORE, 'readwrite')
  const completion = transactionDone(transaction)
  transaction.objectStore(STORE).put(value)
  await completion
  notify(reason)
  return value
}

function clean(value = '', limit = 240) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, limit)
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

function finalizeForgottenThought(memory: DeletedMemoryRecord) {
  if (memory.kind !== 'mind-map-thought') return
  const payload = memory.payload as { mapId?: string; thought?: Thought }
  const mapId = payload.mapId
  const thoughtId = payload.thought?.id || memory.originalId
  if (!mapId || !thoughtId) return
  const document = readJson<BrainDocument>(DOC_KEY(mapId))
  if (!document) return
  const thought = document.thoughts.find(item => item.id === thoughtId)
  if (!thought?.forgotten) return
  const thoughts = document.thoughts.filter(item => item.id !== thoughtId)
  const links = document.links.filter(link => link.from !== thoughtId && link.to !== thoughtId)
  const history = document.history.filter(item => item !== thoughtId)
  const next: BrainDocument = {
    ...document,
    thoughts,
    links,
    pins: document.pins.filter(item => item !== thoughtId),
    activeId: document.activeId === thoughtId ? document.homeId : document.activeId,
    history,
    historyIndex: Math.max(0, Math.min(document.historyIndex, Math.max(0, history.length - 1))),
    updatedAt: new Date().toISOString(),
  }
  try {
    localStorage.setItem(DOC_KEY(mapId), JSON.stringify(next))
    const library = readJson<{ schemaVersion: 1; activeId: string | null; items: BrainMeta[] }>(LIBRARY_KEY)
    if (library?.schemaVersion === 1 && Array.isArray(library.items)) {
      const items = library.items.map(item => item.id === mapId
        ? { ...item, thoughtCount: next.thoughts.filter(entry => !entry.forgotten).length, updatedAt: next.updatedAt }
        : item)
      localStorage.setItem(LIBRARY_KEY, JSON.stringify({ ...library, items }))
    }
  } catch {
    /* Expiry may continue even when map storage is unavailable. */
  }
}

export async function purgeExpiredDeletedMemories(now = Date.now()) {
  const records = await allRecords()
  const expired = records.filter(item => Number(item.expiresAt || 0) <= now)
  if (!expired.length) return 0
  const ids = new Set(expired.map(item => item.id))
  for (const memory of expired) {
    finalizeForgottenThought(memory)
    if (memory.kind === 'mind-map') {
      const mapId = (memory.payload as { mapId?: string }).mapId || memory.originalId
      records
        .filter(item => item.kind === 'mind-map-thought' && (item.payload as { mapId?: string }).mapId === mapId)
        .forEach(item => ids.add(item.id))
    }
  }
  const db = await openDatabase()
  const transaction = db.transaction(STORE, 'readwrite')
  const completion = transactionDone(transaction)
  const store = transaction.objectStore(STORE)
  ids.forEach(value => store.delete(value))
  await completion
  notify('expired')
  return ids.size
}

export async function getDeletedMemoryCount() {
  await purgeExpiredDeletedMemories()
  return (await allRecords()).length
}

export function subscribeDeletedMemories(listener: () => void) {
  const broadcast = () => listener()
  const storage = (event: StorageEvent) => {
    if (event.key === SIGNAL_KEY) listener()
  }
  const shared = channel()
  shared?.addEventListener('message', broadcast)
  window.addEventListener('storage', storage)
  return () => {
    shared?.removeEventListener('message', broadcast)
    window.removeEventListener('storage', storage)
  }
}

export async function moveMindMapToDeletedMemories(mapId: string, meta: BrainMeta, document: BrainDocument) {
  const activeThoughts = document.thoughts.filter(thought => !thought.forgotten).length
  return put(record({
    kind: 'mind-map',
    originalId: mapId,
    title: meta.title || document.title || 'Untitled map',
    summary: `${activeThoughts} active thought${activeThoughts === 1 ? '' : 's'}`,
    sourceTitle: 'Map Your Mind',
    payload: { mapId, meta, document },
  }), 'mind-map-deleted')
}

export async function moveMindMapThoughtToDeletedMemories(mapId: string, mapTitle: string, document: BrainDocument, thoughtId: string) {
  const thought = document.thoughts.find(item => item.id === thoughtId)
  if (!thought || thought.id === document.homeId || thought.forgotten) return null
  const links: Link[] = document.links.filter(link => link.from === thoughtId || link.to === thoughtId)
  return put(record({
    kind: 'mind-map-thought',
    originalId: thought.id,
    title: thought.name || 'Untitled thought',
    summary: clean(thought.notes) || `${links.length} connected relationship${links.length === 1 ? '' : 's'}`,
    sourceTitle: mapTitle || document.title || 'Map Your Mind',
    payload: {
      mapId,
      mapTitle: mapTitle || document.title,
      thought,
      links,
      wasPinned: document.pins.includes(thoughtId),
      wasActive: document.activeId === thoughtId,
    },
  }), 'mind-map-thought-deleted')
}

export function openSharedDeletedMemories() {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'silver-open-deleted-memories' }, window.location.origin)
    return
  }
  window.location.assign('../?view=deleted')
}
