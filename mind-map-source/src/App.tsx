import { useEffect, useMemo, useState } from 'react'
import type { BrainDocument, BrainLibrary, CreateKind, ViewMode } from './types'
import { plexZones, searchThoughts, thoughtMap } from './lib/plex'
import {
  activate,
  addAttachment,
  createLinkedThought,
  forgetThought,
  goHistory,
  linkThoughts,
  removeAttachment,
  togglePin,
  updateThought,
} from './lib/mutate'
import {
  addBrain,
  blankDocument,
  deleteBrain,
  deleteBrainToDeletedMemories,
  exportDocument,
  importDocument,
  loadBrain,
  loadLibrary,
  repairDocument,
  saveBrain,
  seedDocument,
} from './lib/store'
import { Plex } from './components/Plex'
import { ContentArea } from './components/ContentArea'
import { CardView, MindMapView, OutlineView } from './components/AltViews'
import { StartMenu } from './components/StartMenu'
import {
  moveMindMapAttachmentToDeletedMemories,
  moveMindMapThoughtToDeletedMemories,
  subscribeDeletedMemories,
} from './lib/deleted-memories'
import { DeletedMemoriesButton } from './components/DeletedMemoriesButton'

export default function App() {
  const [library, setLibrary] = useState<BrainLibrary>(() => loadLibrary())
  const [brainId, setBrainId] = useState<string | null>(null)
  const [doc, setDoc] = useState<BrainDocument | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewMode>('plex')
  const [expand, setExpand] = useState(false)
  const [composer, setComposer] = useState<{ kind: CreateKind; fromId: string; name: string } | null>(null)
  const [pane, setPane] = useState(400)

  useEffect(() => {
    setLibrary(loadLibrary())
  }, [])

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

  useEffect(() => {
    if (!brainId || !doc) return
    const handle = window.setTimeout(() => setLibrary(saveBrain(brainId, doc, library)), 180)
    return () => window.clearTimeout(handle)
  }, [doc, brainId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!doc) return
      if (isTyping(event)) return
      if (event.key === 'Home') {
        event.preventDefault()
        setDoc((current) => (current ? activate(current, current.homeId) : current))
      }
      if (event.key === 'F6') {
        event.preventDefault()
        setComposer({ kind: 'related', fromId: doc.activeId, name: '' })
      }
      if (event.key === 'F7') {
        event.preventDefault()
        setComposer({ kind: 'parent', fromId: doc.activeId, name: '' })
      }
      if (event.key === 'F8') {
        event.preventDefault()
        setComposer({ kind: 'jump', fromId: doc.activeId, name: '' })
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault()
        setDoc((current) => (current ? goHistory(current, -1) : current))
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault()
        setDoc((current) => (current ? goHistory(current, 1) : current))
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Delete') {
        event.preventDefault()
        void forgetThoughtWithRecovery(doc.activeId)
      }
      if (event.key === '/') {
        event.preventDefault()
        document.getElementById('instant-activate')?.focus()
      }
      if (event.key === 'Escape') {
        setComposer(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, brainId])

  const zones = useMemo(() => (doc ? plexZones(doc) : null), [doc])
  const hits = useMemo(() => (doc && query.trim() ? searchThoughts(doc, query) : []), [doc, query])
  const map = useMemo(() => (doc ? thoughtMap(doc) : new Map()), [doc])
  const active = doc ? map.get(doc.activeId) ?? doc.thoughts.find((thought) => !thought.forgotten) : undefined
  const pins = doc ? doc.pins.map((id) => map.get(id)).filter(Boolean) : []
  const past = doc ? doc.history.slice().reverse().slice(0, 18).map((id) => map.get(id)).filter(Boolean) : []

  function openBrain(id: string) {
    const next = loadBrain(id)
    if (!next) {
      setLibrary(deleteBrain(id))
      setBrainId(null)
      setDoc(null)
      return
    }
    setBrainId(id)
    setDoc(next)
    setQuery('')
    setComposer(null)
    setView('plex')
    setLibrary((current) => ({ ...current, activeId: id }))
  }

  function createFrom(nextDoc: BrainDocument, template?: 'dream-unity' | 'blank') {
    const created = addBrain(nextDoc, template)
    setLibrary(created.library)
    setBrainId(created.id)
    setDoc(created.doc)
    setQuery('')
    setComposer(null)
    setView('plex')
  }

  function closeToMenu() {
    if (brainId && doc) setLibrary(saveBrain(brainId, doc, library))
    setBrainId(null)
    setDoc(null)
    setComposer(null)
  }

  function go(id: string) {
    setDoc((current) => (current ? activate(current, id) : current))
    setQuery('')
    setComposer(null)
  }


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

  if (!brainId || !doc) {
    return (
      <StartMenu
        items={library.items}
        onOpen={openBrain}
        onCreateBlank={(title) => createFrom(blankDocument(title), 'blank')}
        onCreateTheory={() => createFrom(seedDocument(), 'dream-unity')}
        onDelete={(id) => void deleteBrainWithRecovery(id)}
        onImport={(raw) => {
          const next = importDocument(raw)
          if (next) createFrom(next, 'blank')
        }}
      />
    )
  }

  const safeDoc = repairDocument(doc)
  const safeZones = safeDoc ? plexZones(safeDoc) : zones
  const safeActive = safeDoc ? thoughtMap(safeDoc).get(safeDoc.activeId) ?? active : active

  if (!safeDoc || !safeZones || !safeActive) {
    return (
      <StartMenu
        items={library.items}
        onOpen={openBrain}
        onCreateBlank={(title) => createFrom(blankDocument(title), 'blank')}
        onCreateTheory={() => createFrom(seedDocument(), 'dream-unity')}
        onDelete={(id) => void deleteBrainWithRecovery(id)}
        onImport={(raw) => {
          const next = importDocument(raw)
          if (next) createFrom(next, 'blank')
        }}
      />
    )
  }

  return (
    <div className="brain-shell">
      <header className="brain-toolbar">
        <button type="button" className="brand maps-btn" onClick={closeToMenu} title="All maps">
          <strong>TheBrain</strong>
          <em>{safeDoc.title}</em>
        </button>
        <label className="map-switch">
          <span>Maps</span>
          <select
            value={brainId}
            onChange={(event) => {
              if (brainId && doc) setLibrary(saveBrain(brainId, doc, library))
              openBrain(event.target.value)
            }}
          >
            {library.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="nav-btns">
          <button type="button" onClick={() => setDoc((current) => (current ? goHistory(current, -1) : current))} title="Back">
            ←
          </button>
          <button type="button" onClick={() => setDoc((current) => (current ? goHistory(current, 1) : current))} title="Forward">
            →
          </button>
          <button type="button" onClick={() => go(safeDoc.homeId)} title="Home thought">
            ⌂
          </button>
          <button type="button" className={expand ? 'on' : undefined} onClick={() => setExpand((value) => !value)} title="Expand one generation">
            ⊞
          </button>
        </div>
        <div className="view-switch">
          {(['plex', 'outline', 'mindmap', 'cards'] as ViewMode[]).map((mode) => (
            <button key={mode} type="button" className={view === mode ? 'on' : undefined} onClick={() => setView(mode)}>
              {mode === 'plex' ? 'Normal' : mode === 'mindmap' ? 'Mind Map' : mode === 'cards' ? 'Cards' : 'Outline'}
            </button>
          ))}
        </div>
        <div className="pin-rail">
          {pins.map((thought) =>
            thought ? (
              <button key={thought.id} type="button" className={thought.id === safeDoc.activeId ? 'pin active' : 'pin'} style={{ borderColor: thought.color, color: thought.color }} onClick={() => go(thought.id)}>
                {thought.name}
              </button>
            ) : null,
          )}
        </div>
        <div className="search-wrap">
          <input
            id="instant-activate"
            value={query}
            placeholder="Search / Create"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && query.trim()) {
                if (hits[0]) go(hits[0].id)
                else setDoc((current) => (current ? createLinkedThought(current, current.activeId, 'free', query.trim(), 'source') : current))
                setQuery('')
              }
            }}
          />
          {hits.length > 0 ? (
            <ul className="instant">
              {hits.slice(0, 8).map((thought) => (
                <li key={thought.id}>
                  <button type="button" onClick={() => go(thought.id)}>
                    <b>{thought.name}</b>
                    <i>{thought.label ?? thought.tags[0] ?? ''}</i>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button type="button" className="ghost" onClick={() => download(exportDocument(safeDoc))}>
          Export
        </button>
        <label className="ghost file-btn">
          Import
          <input
            type="file"
            accept="application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const next = importDocument(await file.text())
              if (next) createFrom(next, 'blank')
              event.target.value = ''
            }}
          />
        </label>
        <button type="button" className="ghost" onClick={closeToMenu}>
          Maps
        </button>
      </header>

      <div className="brain-body" style={{ gridTemplateColumns: `minmax(0,1fr) 8px ${pane}px` }}>
        <section className="plex-col">
          {view === 'plex' ? (
            <Plex
              doc={safeDoc}
              zones={safeZones}
              expand={expand}
              onActivate={go}
              onCreate={(kind, fromId) => setComposer({ kind, fromId, name: '' })}
              onCommit={(kind, fromId, name, extra) =>
                setDoc((current) => (current ? createLinkedThought(current, fromId, kind, name, 'source', extra) : current))
              }
              onLink={(fromId, toId, kind) => setDoc((current) => (current ? linkThoughts(current, fromId, toId, kind) : current))}
              onForget={(id) => void forgetThoughtWithRecovery(id)}
              onPin={(id) => setDoc((current) => (current ? togglePin(current, id) : current))}
            />
          ) : null}
          {view === 'outline' ? <OutlineView doc={safeDoc} onActivate={go} /> : null}
          {view === 'mindmap' ? <MindMapView doc={safeDoc} onActivate={go} /> : null}
          {view === 'cards' ? <CardView doc={safeDoc} onActivate={go} /> : null}
          <footer className="past-list">
            {past.map((thought) =>
              thought ? (
                <button key={`${thought.id}-past`} type="button" onClick={() => go(thought.id)}>
                  {thought.name}
                </button>
              ) : null,
            )}
          </footer>
        </section>
        <div
          className="splitter"
          onPointerDown={(event) => {
            const startX = event.clientX
            const start = pane
            const move = (next: PointerEvent) => setPane(Math.max(280, Math.min(560, start - (next.clientX - startX))))
            const up = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
        />
        <ContentArea
          thought={safeActive}
          zones={safeZones}
          pinned={safeDoc.pins.includes(safeActive.id)}
          onNotes={(notes) => setDoc((current) => (current ? updateThought(current, safeActive.id, { notes }) : current))}
          onRename={(name) => setDoc((current) => (current ? updateThought(current, safeActive.id, { name }) : current))}
          onLabel={(label) => setDoc((current) => (current ? updateThought(current, safeActive.id, { label }) : current))}
          onTags={(tags) => setDoc((current) => (current ? updateThought(current, safeActive.id, { tags }) : current))}
          onColor={(color) => setDoc((current) => (current ? updateThought(current, safeActive.id, { color }) : current))}
          onActivate={go}
          onPin={() => setDoc((current) => (current ? togglePin(current, safeActive.id) : current))}
          onForget={() => void forgetThoughtWithRecovery(safeActive.id)}
          onAttach={(title, url) => setDoc((current) => (current ? addAttachment(current, safeActive.id, { title, url }) : current))}
          onDetach={(id) => void detachWithRecovery(id)}
        />
      </div>

      {composer ? (
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            setDoc((current) => (current ? createLinkedThought(current, composer.fromId, composer.kind, composer.name, 'source') : current))
            setComposer(null)
          }}
        >
          <label>
            Create {composer.kind}
            <input autoFocus value={composer.name} onChange={(event) => setComposer({ ...composer, name: event.target.value })} placeholder="Thought name — existing names will be linked" />
          </label>
          <button type="submit">Create</button>
          <button type="button" onClick={() => setComposer(null)}>
            Cancel
          </button>
        </form>
      ) : null}
      <DeletedMemoriesButton />
    </div>
  )
}

function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  if (!target) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
}

function download(text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'dream-unity-brain.json'
  link.click()
  URL.revokeObjectURL(url)
}
