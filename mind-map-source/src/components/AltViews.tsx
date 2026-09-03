import type { BrainDocument, Thought } from '../types'
import { childrenOf, parentsOf, resolve, thoughtMap, visibleThoughts } from '../lib/plex'

export function OutlineView({
  doc,
  onActivate,
}: {
  doc: BrainDocument
  onActivate: (id: string) => void
}) {
  const roots = visibleThoughts(doc).filter((thought) => parentsOf(doc, thought.id).length === 0)
  return (
    <div className="alt-view outline-view">
      {roots.map((thought) => (
        <OutlineNode key={thought.id} doc={doc} thought={thought} depth={0} activeId={doc.activeId} onActivate={onActivate} />
      ))}
    </div>
  )
}

function OutlineNode({
  doc,
  thought,
  depth,
  activeId,
  onActivate,
}: {
  doc: BrainDocument
  thought: Thought
  depth: number
  activeId: string
  onActivate: (id: string) => void
}) {
  const kids = resolve(doc, childrenOf(doc, thought.id))
  return (
    <div className="outline-node" style={{ paddingLeft: depth * 18 }}>
      <button type="button" className={thought.id === activeId ? 'is-active' : undefined} style={{ color: thought.color }} onClick={() => onActivate(thought.id)}>
        {thought.name}
      </button>
      {kids.map((child) => (
        <OutlineNode key={child.id} doc={doc} thought={child} depth={depth + 1} activeId={activeId} onActivate={onActivate} />
      ))}
    </div>
  )
}

export function MindMapView({
  doc,
  onActivate,
}: {
  doc: BrainDocument
  onActivate: (id: string) => void
}) {
  const map = thoughtMap(doc)
  const active = map.get(doc.activeId)
  if (!active) return null
  const kids = resolve(doc, childrenOf(doc, active.id))
  const parents = resolve(doc, parentsOf(doc, active.id))
  return (
    <div className="alt-view mindmap-view">
      <div className="mm-parents">
        {parents.map((thought) => (
          <button key={thought.id} type="button" style={{ borderColor: thought.color }} onClick={() => onActivate(thought.id)}>
            {thought.name}
          </button>
        ))}
      </div>
      <div className="mm-active" style={{ borderColor: active.color }}>{active.name}</div>
      <div className="mm-children">
        {kids.map((thought) => (
          <button key={thought.id} type="button" style={{ borderColor: thought.color }} onClick={() => onActivate(thought.id)}>
            {thought.name}
            <small>{resolve(doc, childrenOf(doc, thought.id)).length} children</small>
          </button>
        ))}
      </div>
    </div>
  )
}

export function CardView({
  doc,
  onActivate,
}: {
  doc: BrainDocument
  onActivate: (id: string) => void
}) {
  return (
    <div className="alt-view card-view">
      {visibleThoughts(doc).map((thought) => (
        <button key={thought.id} type="button" className={thought.id === doc.activeId ? 'is-active' : undefined} style={{ borderColor: thought.color }} onClick={() => onActivate(thought.id)}>
          <em>{thought.label ?? thought.tags[0] ?? 'Thought'}</em>
          <strong>{thought.name}</strong>
          <p>{thought.notes.slice(0, 140) || 'No notes yet.'}</p>
        </button>
      ))}
    </div>
  )
}
