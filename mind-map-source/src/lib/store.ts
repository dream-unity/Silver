import type { BrainDocument, BrainLibrary, BrainMeta, Thought } from '../types'
import { cloneSeed } from './mutate'
import { uid, nowIso } from './ids'

const LEGACY_KEY = 'dream-unity-brain-v4'
const LIBRARY_KEY = 'dream-unity-library-v1'
const DOC_KEY = (id: string) => `dream-unity-brain-v4:${id}`

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode */
  }
}

export function seedDocument(): BrainDocument {
  return cloneSeed()
}

export function blankDocument(title: string): BrainDocument {
  const name = title.trim() || 'Untitled'
  const homeId = uid('t')
  const home: Thought = {
    id: homeId,
    name,
    notes: '',
    color: '#94a3b8',
    tags: [],
    attachments: [],
    label: 'Home',
  }
  return {
    schemaVersion: 4,
    title: name,
    homeId,
    activeId: homeId,
    pins: [homeId],
    thoughts: [home],
    links: [],
    history: [homeId],
    historyIndex: 0,
    updatedAt: nowIso(),
  }
}

export function repairDocument(input: unknown): BrainDocument | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<BrainDocument>
  if (!Array.isArray(raw.thoughts) || raw.thoughts.length === 0) return null

  const thoughts = raw.thoughts.map((thought, index) => ({
    id: thought?.id || uid('t'),
    name: thought?.name?.trim() || `Thought ${index + 1}`,
    notes: thought?.notes ?? '',
    color: thought?.color || '#94a3b8',
    tags: Array.isArray(thought?.tags) ? thought.tags : [],
    attachments: Array.isArray(thought?.attachments) ? thought.attachments : [],
    label: thought?.label,
    icon: thought?.icon,
    forgotten: thought?.forgotten,
  }))

  const byId = new Map(thoughts.map((thought) => [thought.id, thought]))
  let home = (raw.homeId && byId.get(raw.homeId)) || thoughts.find((thought) => !thought.forgotten) || thoughts[0]
  if (!home) return null
  if (home.forgotten) {
    home = { ...home, forgotten: false }
    const index = thoughts.findIndex((thought) => thought.id === home.id)
    if (index >= 0) thoughts[index] = home
  }

  const active =
    (raw.activeId && thoughts.find((thought) => thought.id === raw.activeId && !thought.forgotten)) || home

  const links = Array.isArray(raw.links)
    ? raw.links.filter((link) => link && byId.has(link.from) && byId.has(link.to))
    : []

  const history = (Array.isArray(raw.history) ? raw.history : []).filter((id) => byId.has(id))
  const nextHistory = history.length ? history : [active.id]

  return {
    schemaVersion: 4,
    title: raw.title?.trim() || home.name || 'Untitled',
    homeId: home.id,
    activeId: active.id,
    pins: (Array.isArray(raw.pins) ? raw.pins : []).filter((id) => byId.has(id)),
    thoughts,
    links,
    history: nextHistory,
    historyIndex: Math.min(Math.max(0, raw.historyIndex ?? nextHistory.length - 1), nextHistory.length - 1),
    updatedAt: raw.updatedAt || nowIso(),
  }
}

function metaFrom(id: string, doc: BrainDocument, template?: BrainMeta['template']): BrainMeta {
  const home = doc.thoughts.find((thought) => thought.id === doc.homeId) ?? doc.thoughts[0]
  return {
    id,
    title: doc.title || home?.name || 'Untitled',
    updatedAt: doc.updatedAt,
    thoughtCount: doc.thoughts.filter((thought) => !thought.forgotten).length,
    homeName: home?.name || doc.title || 'Untitled',
    color: home?.color || '#94a3b8',
    template,
  }
}

function emptyLibrary(): BrainLibrary {
  return { schemaVersion: 1, activeId: null, items: [] }
}

export function loadLibrary(): BrainLibrary {
  const stored = readJson<BrainLibrary>(LIBRARY_KEY)
  const library = stored?.schemaVersion === 1 && Array.isArray(stored.items) ? stored : emptyLibrary()

  const legacy = repairDocument(readJson(LEGACY_KEY))
  if (legacy && !library.items.length) {
    const id = uid('b')
    writeJson(DOC_KEY(id), legacy)
    const next = {
      schemaVersion: 1 as const,
      activeId: null,
      items: [metaFrom(id, legacy, legacy.title === 'Dream Unity' ? 'dream-unity' : 'blank')],
    }
    writeJson(LIBRARY_KEY, next)
    try {
      localStorage.removeItem(LEGACY_KEY)
    } catch {
      /* ignore */
    }
    return next
  }

  return library
}

export function saveLibrary(library: BrainLibrary) {
  writeJson(LIBRARY_KEY, library)
}

export function loadBrain(id: string): BrainDocument | null {
  return repairDocument(readJson(DOC_KEY(id)))
}

export function saveBrain(id: string, doc: BrainDocument, library: BrainLibrary): BrainLibrary {
  const repaired = repairDocument(doc)
  if (!repaired) return library
  writeJson(DOC_KEY(id), repaired)
  const existing = library.items.find((item) => item.id === id)
  const item = metaFrom(id, repaired, existing?.template)
  const items = existing ? library.items.map((entry) => (entry.id === id ? item : entry)) : [item, ...library.items]
  const next = { ...library, items, activeId: id }
  saveLibrary(next)
  return next
}

export function addBrain(doc: BrainDocument, template?: BrainMeta['template']): { id: string; doc: BrainDocument; library: BrainLibrary } {
  const repaired = repairDocument(doc) ?? blankDocument(doc.title || 'Untitled')
  const id = uid('b')
  const library = loadLibrary()
  writeJson(DOC_KEY(id), repaired)
  const next = {
    schemaVersion: 1 as const,
    activeId: id,
    items: [metaFrom(id, repaired, template), ...library.items.filter((item) => item.id !== id)],
  }
  saveLibrary(next)
  return { id, doc: repaired, library: next }
}

export function deleteBrain(id: string): BrainLibrary {
  const library = loadLibrary()
  try {
    localStorage.removeItem(DOC_KEY(id))
  } catch {
    /* ignore */
  }
  const next = {
    ...library,
    items: library.items.filter((item) => item.id !== id),
    activeId: library.activeId === id ? null : library.activeId,
  }
  saveLibrary(next)
  return next
}

export function loadDocument(): BrainDocument {
  return repairDocument(cloneSeed()) ?? blankDocument('Untitled')
}

export function saveDocument(doc: BrainDocument): void {
  writeJson(LEGACY_KEY, doc)
}

export function resetDocument(): BrainDocument {
  const seed = cloneSeed()
  writeJson(LEGACY_KEY, seed)
  return seed
}

export function exportDocument(doc: BrainDocument): string {
  return JSON.stringify(doc, null, 2)
}

export function importDocument(raw: string): BrainDocument | null {
  try {
    return repairDocument(JSON.parse(raw))
  } catch {
    return null
  }
}
