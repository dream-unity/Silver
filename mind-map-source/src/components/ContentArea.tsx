import { useState } from 'react'
import type { PlexZones, Thought } from '../types'

export function ContentArea({
  thought,
  zones,
  pinned,
  onNotes,
  onRename,
  onLabel,
  onTags,
  onColor,
  onActivate,
  onPin,
  onForget,
  onAttach,
  onDetach,
}: {
  thought: Thought
  zones: PlexZones
  pinned: boolean
  onNotes: (notes: string) => void
  onRename: (name: string) => void
  onLabel: (label: string) => void
  onTags: (tags: string[]) => void
  onColor: (color: string) => void
  onActivate: (id: string) => void
  onPin: () => void
  onForget: () => void
  onAttach: (title: string, url: string) => void
  onDetach: (id: string) => void
}) {
  const [url, setUrl] = useState('')
  const words = thought.notes.trim() ? thought.notes.trim().split(/\s+/).length : 0
  const mapped = zones.parents.length + zones.children.length + zones.jumps.length + zones.siblings.length + zones.related.length

  return (
    <aside className="content-pane">
      <header className="content-head">
        <input className="thought-title" value={thought.name} onChange={(event) => onRename(event.target.value)} />
        <div className="content-actions">
          <button type="button" onClick={onPin}>{pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" onClick={onForget}>Forget</button>
        </div>
      </header>
      <div className="meta-row">
        <input className="label-input" value={thought.label ?? ''} placeholder="Type / label" onChange={(event) => onLabel(event.target.value)} />
        <input className="tag-input" value={thought.tags.join(', ')} placeholder="tags" onChange={(event) => onTags(event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))} />
        <input className="color-input" type="color" value={thought.color} onChange={(event) => onColor(event.target.value)} />
      </div>
      <p className="meta-line">{mapped} mapped links · {words} words · {thought.attachments.length} attachments</p>
      <textarea className="notes" value={thought.notes} placeholder="Notes for this thought…" onChange={(event) => onNotes(event.target.value)} />
      <section className="mapped">
        <h4>Mapped Links</h4>
        <Mapped label="Lines" mark="—" items={zones.related} onActivate={onActivate} />
        <Mapped label="Parents" mark="↑" items={zones.parents} onActivate={onActivate} />
        <Mapped label="Jumps" mark="↔" items={zones.jumps} onActivate={onActivate} />
        <Mapped label="Children" mark="↓" items={zones.children} onActivate={onActivate} />
        <Mapped label="Siblings" mark="→" items={zones.siblings} onActivate={onActivate} />
        <Mapped label="Unlinked" mark="·" items={zones.loose} onActivate={onActivate} />
      </section>
      <section className="attachments">
        <h4>Attachments</h4>
        {thought.attachments.map((item) => (
          <div key={item.id} className="attach-row">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
            ) : (
              <span>{item.title}</span>
            )}
            <button type="button" onClick={() => onDetach(item.id)}>×</button>
          </div>
        ))}
        <form className="attach-form" onSubmit={(event) => {
          event.preventDefault()
          if (!url.trim()) return
          onAttach(url.replace(/^https?:\/\//, '').slice(0, 48), url.trim())
          setUrl('')
        }}>
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste a URL and press Enter" />
        </form>
      </section>
    </aside>
  )
}

function Mapped({
  label,
  mark,
  items,
  onActivate,
}: {
  label: string
  mark: string
  items: Thought[]
  onActivate: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="mapped-group">
      <b>{label}</b>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onActivate(item.id)}>
          {mark} {item.name}
        </button>
      ))}
    </div>
  )
}
