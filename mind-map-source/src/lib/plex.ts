import type { BrainDocument, CreateKind, Link, PlexEdge, PlexZones, PlacedThought, Thought } from '../types'

export const THOUGHT_TYPES = ['', 'Practice', 'Portal', 'Principle', 'Lens', 'Core'] as const
export const ADVANCED_KINDS: CreateKind[] = ['parent', 'child', 'jump', 'sibling']

export function thoughtMap(doc: BrainDocument): Map<string, Thought> {
  return new Map(doc.thoughts.map((thought) => [thought.id, thought]))
}

export function visibleThoughts(doc: BrainDocument): Thought[] {
  return doc.thoughts.filter((thought) => !thought.forgotten)
}

export function parentsOf(doc: BrainDocument, id: string): string[] {
  return doc.links.filter((link) => link.kind === 'child' && link.to === id).map((link) => link.from)
}

export function childrenOf(doc: BrainDocument, id: string): string[] {
  return doc.links.filter((link) => link.kind === 'child' && link.from === id).map((link) => link.to)
}

export function jumpsOf(doc: BrainDocument, id: string): string[] {
  return doc.links
    .filter((link) => link.kind === 'jump' && (link.from === id || link.to === id))
    .map((link) => (link.from === id ? link.to : link.from))
}

export function relatedOf(doc: BrainDocument, id: string): string[] {
  return doc.links
    .filter((link) => link.kind === 'related' && (link.from === id || link.to === id))
    .map((link) => (link.from === id ? link.to : link.from))
}

export function siblingsOf(doc: BrainDocument, id: string): string[] {
  const seen = new Set<string>()
  for (const parent of parentsOf(doc, id)) {
    for (const child of childrenOf(doc, parent)) {
      if (child !== id) seen.add(child)
    }
  }
  return [...seen]
}

export function resolve(doc: BrainDocument, ids: string[]): Thought[] {
  const map = thoughtMap(doc)
  const seen = new Set<string>()
  const out: Thought[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const thought = map.get(id)
    if (!thought || thought.forgotten) continue
    seen.add(id)
    out.push(thought)
  }
  return out
}

export function plexZones(doc: BrainDocument, activeId = doc.activeId): PlexZones | null {
  const active = thoughtMap(doc).get(activeId)
  if (!active || active.forgotten) return null
  const parents = resolve(doc, parentsOf(doc, activeId))
  const children = resolve(doc, childrenOf(doc, activeId))
  const jumps = resolve(doc, jumpsOf(doc, activeId))
  const siblings = resolve(doc, siblingsOf(doc, activeId))
  const related = resolve(doc, relatedOf(doc, activeId))
  const taken = new Set([activeId, ...parents, ...children, ...jumps, ...siblings, ...related].map((item) => (typeof item === 'string' ? item : item.id)))
  const loose = visibleThoughts(doc).filter((thought) => thought.id !== activeId && !taken.has(thought.id))
  const grandparentIds = parents.flatMap((parent) => parentsOf(doc, parent.id))
  const grandchildIds = children.flatMap((child) => childrenOf(doc, child.id))
  return {
    active,
    parents,
    children,
    jumps,
    siblings,
    related,
    loose,
    grandparents: resolve(doc, grandparentIds).filter((thought) => thought.id !== activeId),
    grandchildren: resolve(doc, grandchildIds).filter((thought) => thought.id !== activeId),
  }
}

export function searchThoughts(doc: BrainDocument, query: string): Thought[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return visibleThoughts(doc).filter((thought) => {
    const hay = `${thought.name} ${thought.label ?? ''} ${thought.notes} ${thought.tags.join(' ')}`.toLowerCase()
    return hay.includes(q)
  })
}

export function findByName(doc: BrainDocument, name: string): Thought | undefined {
  const q = name.trim().toLowerCase()
  return visibleThoughts(doc).find((thought) => thought.name.toLowerCase() === q)
}

export function hasLink(links: Link[], kind: Link['kind'], a: string, b: string): boolean {
  if (kind === 'jump' || kind === 'related') {
    return links.some((link) => link.kind === kind && ((link.from === a && link.to === b) || (link.from === b && link.to === a)))
  }
  return links.some((link) => link.kind === 'child' && link.from === a && link.to === b)
}

function row(items: Thought[], y: number, cx: number, gap: number, w: number, h: number, role: PlacedThought['role']): PlacedThought[] {
  if (!items.length) return []
  const span = (items.length - 1) * (w + gap)
  const start = cx - span / 2
  return items.map((thought, index) => ({
    id: thought.id,
    thought,
    role,
    x: start + index * (w + gap),
    y,
    w,
    h,
  }))
}

function column(items: Thought[], x: number, cy: number, gap: number, w: number, h: number, role: PlacedThought['role']): PlacedThought[] {
  if (!items.length) return []
  const span = (items.length - 1) * (h + gap)
  const start = cy - span / 2
  return items.map((thought, index) => ({
    id: thought.id,
    thought,
    role,
    x,
    y: start + index * (h + gap),
    w,
    h,
  }))
}

function ring(items: Thought[], cx: number, cy: number, radius: number, w: number, h: number, role: PlacedThought['role']): PlacedThought[] {
  if (!items.length) return []
  return items.map((thought, index) => {
    const angle = -Math.PI / 2 + (index * (2 * Math.PI)) / items.length
    return {
      id: thought.id,
      thought,
      role,
      x: cx + Math.cos(angle) * radius - w / 2,
      y: cy + Math.sin(angle) * radius - h / 2,
      w,
      h,
    }
  })
}

export function layoutPlex(
  zones: PlexZones,
  width: number,
  height: number,
  expand: boolean,
): { nodes: PlacedThought[]; edges: PlexEdge[] } {
  const cx = width / 2
  const cy = height / 2
  const aw = Math.min(260, Math.max(180, width * 0.22))
  const ah = 62
  const tw = Math.min(168, Math.max(128, width * 0.14))
  const th = 40
  const gap = 16
  const parentY = expand ? cy - 210 : cy - 150
  const childY = expand ? cy + 210 : cy + 150
  const jumpX = Math.max(24, cx - Math.min(360, width * 0.34))
  const sibX = Math.min(width - tw - 24, cx + Math.min(360, width * 0.34) - tw)
  const relatedRadius = Math.min(width, height) * 0.28
  const looseRadius = Math.min(width, height) * 0.4

  function parked(items: Thought[], fallback: PlacedThought[], role: PlacedThought['role']): PlacedThought[] {
    return items.map((thought, index) => {
      const laid = fallback[index]
      if (!laid || typeof thought.x !== 'number' || typeof thought.y !== 'number') return laid
      return {
        id: thought.id,
        thought,
        role,
        x: Math.max(12, Math.min(width - tw - 12, thought.x)),
        y: Math.max(12, Math.min(height - th - 12, thought.y)),
        w: tw,
        h: th,
      }
    })
  }

  const nodes: PlacedThought[] = [
    { id: zones.active.id, thought: zones.active, role: 'active', x: cx - aw / 2, y: cy - ah / 2, w: aw, h: ah },
    ...row(zones.parents, parentY - th / 2, cx, gap, tw, th, 'parent'),
    ...row(zones.children, childY - th / 2, cx, gap, tw, th, 'child'),
    ...column(zones.jumps, jumpX, cy, gap, tw, th, 'jump'),
    ...column(zones.siblings, sibX, cy, gap, tw, th, 'sibling'),
    ...parked(zones.related, ring(zones.related, cx, cy, relatedRadius, tw, th, 'related'), 'related'),
    ...parked(zones.loose, ring(zones.loose, cx, cy, looseRadius, tw, th, 'loose'), 'loose'),
  ]

  if (expand && zones.grandparents.length) {
    nodes.push(...row(zones.grandparents, parentY - 88, cx, gap, tw, th, 'grandparent'))
  }
  if (expand && zones.grandchildren.length) {
    const childRows = Math.ceil(zones.children.length / 8) || 1
    nodes.push(...row(zones.grandchildren, childY + 36 + childRows * 28, cx, gap, tw, th, 'grandchild'))
  }

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const edges: PlexEdge[] = []
  const add = (fromId: string, toId: string, kind: PlexEdge['kind']) => {
    if (!byId.has(fromId) || !byId.has(toId)) return
    edges.push({ id: `${kind}-${fromId}-${toId}`, kind, fromId, toId })
  }

  for (const parent of zones.parents) add(parent.id, zones.active.id, 'child')
  for (const child of zones.children) add(zones.active.id, child.id, 'child')
  for (const jump of zones.jumps) add(zones.active.id, jump.id, 'jump')
  for (const sibling of zones.siblings) add(zones.active.id, sibling.id, 'sibling')
  for (const related of zones.related) add(zones.active.id, related.id, 'related')
  if (expand) {
    for (const parent of zones.parents) {
      for (const grand of zones.grandparents) add(grand.id, parent.id, 'child')
    }
    for (const child of zones.children) {
      for (const grand of zones.grandchildren) add(child.id, grand.id, 'child')
    }
  }

  return { nodes, edges }
}

export function gatePoint(node: PlacedThought, gate: 'parent' | 'child' | 'jump' | 'center'): { x: number; y: number } {
  if (gate === 'parent') return { x: node.x + node.w / 2, y: node.y }
  if (gate === 'child') return { x: node.x + node.w / 2, y: node.y + node.h }
  if (gate === 'jump') return { x: node.x, y: node.y + node.h / 2 }
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 }
}

export function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const lift = Math.max(24, Math.min(90, Math.abs(dy) * 0.45 + Math.abs(dx) * 0.12))
  const cx1 = x1 + dx * 0.15
  const cy1 = y1 + (dy < 0 ? -lift : lift * 0.35)
  const cx2 = x2 - dx * 0.15
  const cy2 = y2 + (dy > 0 ? lift : -lift * 0.35)
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`
}

export function relationFromPoint(
  active: { x: number; y: number; w: number; h: number },
  point: { x: number; y: number },
): CreateKind {
  const cx = active.x + active.w / 2
  const cy = active.y + active.h / 2
  const dx = point.x - cx
  const dy = point.y - cy
  const inside =
    point.x >= active.x - 16 &&
    point.x <= active.x + active.w + 16 &&
    point.y >= active.y - 16 &&
    point.y <= active.y + active.h + 16
  if (inside) return 'related'
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'parent' : 'child'
  return dx < 0 ? 'jump' : 'sibling'
}

export function nextCreateKind(kind: CreateKind): CreateKind {
  if (kind === 'free') return 'related'
  if (kind === 'related') return 'parent'
  if (kind === 'parent') return 'jump'
  if (kind === 'jump') return 'child'
  if (kind === 'child') return 'sibling'
  return 'free'
}
