import type { Attachment, BrainDocument, CreateKind, Link, Thought } from '../types'
import { uid, nowIso } from './ids'
import { findByName, hasLink, parentsOf } from './plex'
import { SEED } from '../seed'

function stamp(doc: BrainDocument): BrainDocument {
  return { ...doc, updatedAt: nowIso() }
}

export function cloneSeed(): BrainDocument {
  return structuredClone(SEED)
}

export function activate(doc: BrainDocument, id: string): BrainDocument {
  if (id === doc.activeId) return doc
  const exists = doc.thoughts.some((thought) => thought.id === id && !thought.forgotten)
  if (!exists) return doc
  const trimmed = doc.history.slice(0, doc.historyIndex + 1)
  const history = [...trimmed.filter((item) => item !== id), id].slice(-60)
  return stamp({ ...doc, activeId: id, history, historyIndex: history.length - 1 })
}

export function goHistory(doc: BrainDocument, direction: -1 | 1): BrainDocument {
  const next = doc.historyIndex + direction
  if (next < 0 || next >= doc.history.length) return doc
  const id = doc.history[next]
  if (!id) return doc
  return stamp({ ...doc, activeId: id, historyIndex: next })
}

export function updateThought(doc: BrainDocument, id: string, patch: Partial<Thought>): BrainDocument {
  return stamp({
    ...doc,
    thoughts: doc.thoughts.map((thought) => (thought.id === id ? { ...thought, ...patch } : thought)),
  })
}

function childLink(fromId: string, toId: string): Link {
  return { id: uid('e'), kind: 'child', from: fromId, to: toId }
}

function jumpLink(fromId: string, toId: string): Link {
  return { id: uid('e'), kind: 'jump', from: fromId, to: toId }
}

function relatedLink(fromId: string, toId: string): Link {
  return { id: uid('e'), kind: 'related', from: fromId, to: toId }
}

function linksForCreate(doc: BrainDocument, fromId: string, toId: string, kind: CreateKind): Link[] {
  if (kind === 'free') return []
  if (kind === 'related') return [relatedLink(fromId, toId)]
  if (kind === 'jump') return [jumpLink(fromId, toId)]
  if (kind === 'child') return [childLink(fromId, toId)]
  if (kind === 'parent') return [childLink(toId, fromId)]
  const parents = parentsOf(doc, fromId)
  if (parents.length) return parents.map((parent) => childLink(parent, toId))
  return [relatedLink(fromId, toId)]
}

export function createLinkedThought(
  doc: BrainDocument,
  fromId: string,
  kind: CreateKind,
  name: string,
  focus: 'new' | 'source' = 'new',
  extra: { label?: string; x?: number; y?: number } = {},
): BrainDocument {
  const title = name.trim() || 'New Thought'
  const existing = findByName(doc, title)
  if (existing && existing.id !== fromId) {
    if (kind === 'free') return focus === 'source' ? activate(doc, fromId) : activate(doc, existing.id)
    const linked = linkThoughts(doc, fromId, existing.id, kind)
    return focus === 'source' ? activate(linked, fromId) : linked
  }

  const source = doc.thoughts.find((thought) => thought.id === fromId)
  const thought: Thought = {
    id: uid('t'),
    name: title,
    notes: '',
    color: source?.color ?? '#94a3b8',
    tags: extra.label ? [extra.label.toLowerCase()] : [],
    attachments: [],
    label: extra.label || undefined,
    x: extra.x,
    y: extra.y,
  }
  const next = stamp({
    ...doc,
    thoughts: [...doc.thoughts, thought],
    links: [...doc.links, ...linksForCreate(doc, fromId, thought.id, kind)],
  })
  return activate(next, focus === 'source' ? fromId : thought.id)
}

export function linkThoughts(doc: BrainDocument, fromId: string, toId: string, kind: CreateKind): BrainDocument {
  if (fromId === toId || kind === 'free') return doc
  const additions = linksForCreate(doc, fromId, toId, kind).filter((link) => !hasLink(doc.links, link.kind, link.from, link.to))
  if (!additions.length) return activate(doc, toId)
  return activate(stamp({ ...doc, links: [...doc.links, ...additions] }), toId)
}

export function unlinkThoughts(doc: BrainDocument, a: string, b: string): BrainDocument {
  return stamp({
    ...doc,
    links: doc.links.filter((link) => {
      const pair = (link.from === a && link.to === b) || (link.from === b && link.to === a)
      return !pair
    }),
  })
}

export function forgetThought(doc: BrainDocument, id: string): BrainDocument {
  if (id === doc.homeId) return doc
  return stamp({
    ...doc,
    thoughts: doc.thoughts.map((thought) => (thought.id === id ? { ...thought, forgotten: true } : thought)),
    pins: doc.pins.filter((pin) => pin !== id),
    activeId: doc.activeId === id ? doc.homeId : doc.activeId,
  })
}

export function rememberThought(doc: BrainDocument, id: string): BrainDocument {
  return stamp({
    ...doc,
    thoughts: doc.thoughts.map((thought) => (thought.id === id ? { ...thought, forgotten: false } : thought)),
  })
}

export function togglePin(doc: BrainDocument, id: string): BrainDocument {
  const pins = doc.pins.includes(id) ? doc.pins.filter((pin) => pin !== id) : [...doc.pins, id]
  return stamp({ ...doc, pins })
}

export function addAttachment(doc: BrainDocument, id: string, attachment: Omit<Attachment, 'id'>): BrainDocument {
  const item: Attachment = { id: uid('a'), title: attachment.title, url: attachment.url }
  return stamp({
    ...doc,
    thoughts: doc.thoughts.map((thought) =>
      thought.id === id ? { ...thought, attachments: [...thought.attachments, item] } : thought,
    ),
  })
}

export function removeAttachment(doc: BrainDocument, thoughtId: string, attachmentId: string): BrainDocument {
  return stamp({
    ...doc,
    thoughts: doc.thoughts.map((thought) =>
      thought.id === thoughtId
        ? { ...thought, attachments: thought.attachments.filter((item) => item.id !== attachmentId) }
        : thought,
    ),
  })
}
