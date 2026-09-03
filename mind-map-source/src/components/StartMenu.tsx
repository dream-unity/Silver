import { useState } from 'react'
import type { BrainMeta } from '../types'

export function StartMenu({
  items,
  onOpen,
  onCreateBlank,
  onCreateTheory,
  onDelete,
  onImport,
}: {
  items: BrainMeta[]
  onOpen: (id: string) => void
  onCreateBlank: (title: string) => void
  onCreateTheory: () => void
  onDelete: (id: string) => void
  onImport: (raw: string) => void
}) {
  const [title, setTitle] = useState('')

  return (
    <div className="start-menu">
      <header className="start-hero">
        <strong>TheBrain</strong>
        <h1>Your maps</h1>
        <p>Open a map, start from nothing, or copy the Dream Unity theory. Each map is its own plex.</p>
      </header>

      <form
        className="start-create"
        onSubmit={(event) => {
          event.preventDefault()
          onCreateBlank(title.trim() || 'Untitled')
          setTitle('')
        }}
      >
        <label>
          New mind map
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Name anything — Neuropsychology, a project, a life"
            autoFocus
          />
        </label>
        <button type="submit">Create blank map</button>
        <button type="button" onClick={onCreateTheory}>
          Copy Dream Unity theory
        </button>
        <label className="ghost file-btn">
          Import JSON
          <input
            type="file"
            accept="application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              onImport(await file.text())
              event.target.value = ''
            }}
          />
        </label>
      </form>

      <section className="start-grid">
        {items.length === 0 ? (
          <div className="start-empty">
            <em>No maps yet</em>
            <p>Create a blank map and tap empty space to think. Dream Unity is a template, not a lock.</p>
          </div>
        ) : (
          items.map((item) => (
            <article key={item.id} className="start-card" style={{ borderColor: item.color }}>
              <button type="button" className="start-open" onClick={() => onOpen(item.id)}>
                <em>{item.template === 'dream-unity' ? 'Theory' : 'Map'}</em>
                <strong>{item.title}</strong>
                <span>
                  {item.thoughtCount} thought{item.thoughtCount === 1 ? '' : 's'} · {item.homeName}
                </span>
                <small>{new Date(item.updatedAt).toLocaleString()}</small>
              </button>
              <button type="button" className="start-forget" onClick={() => onDelete(item.id)}>
                Forget
              </button>
            </article>
          ))
        )}
      </section>
    </div>
  )
}
