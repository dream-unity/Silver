import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { BrainDocument, CreateKind, PlexZones } from '../types'
import { ADVANCED_KINDS, childrenOf, curvePath, gatePoint, jumpsOf, layoutPlex, parentsOf } from '../lib/plex'

type Menu = { x: number; y: number; id: string } | null
type Drag = {
  fromId: string
  kind: CreateKind
  x: number
  y: number
  startX: number
  startY: number
  moved: boolean
} | null
type Draft = {
  x: number
  y: number
  kind: CreateKind
  name: string
  label: string
  fromId: string
  advanced: boolean
}

const TAP_SLOP = 22
const HOLD_MS = 420
const DRAFT_W = 268
const DRAFT_H = 168

export function Plex({
  doc,
  zones,
  expand,
  onActivate,
  onCreate,
  onCommit,
  onLink,
  onForget,
  onPin,
}: {
  doc: BrainDocument
  zones: PlexZones
  expand: boolean
  onActivate: (id: string) => void
  onCreate: (kind: CreateKind, fromId: string) => void
  onCommit: (kind: CreateKind, fromId: string, name: string, extra?: { label?: string; x?: number; y?: number }) => void
  onLink: (fromId: string, toId: string, kind: CreateKind) => void
  onForget: (id: string) => void
  onPin: (id: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const skipClick = useRef(false)
  const holdTimer = useRef<number | null>(null)
  const holdId = useRef<number | null>(null)
  const [size, setSize] = useState({ w: 1000, h: 700 })
  const [drag, setDrag] = useState<Drag>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [heldId, setHeldId] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const apply = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { nodes, edges } = useMemo(() => layoutPlex(zones, size.w, size.h, expand), [zones, size, expand])
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const activeNode = byId.get(doc.activeId) ?? nodes.find((node) => node.role === 'active')

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    if (!draft) return
    const handle = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(handle)
  }, [draft?.fromId, draft?.x, draft?.y])

  function clearHoldTimer() {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }

  function localPoint(event: ReactPointerEvent | PointerEvent) {
    const rect = host.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function hitThought(x: number, y: number, except?: string) {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index]
      if (!node || node.id === except) continue
      if (x >= node.x && x <= node.x + node.w && y >= node.y && y <= node.y + node.h) return node.id
    }
    return null
  }

  function isChrome(target: EventTarget | null) {
    const el = target as HTMLElement | null
    if (!el) return false
    return Boolean(el.closest('.thought, .gate, .quick-add, .ctx-menu, .inline-draft'))
  }

  function placeDraft(point: { x: number; y: number }) {
    return {
      x: Math.max(12, Math.min(size.w - DRAFT_W - 12, point.x + 16)),
      y: Math.max(12, Math.min(size.h - DRAFT_H - 12, point.y - 20)),
    }
  }

  function openDraft(point: { x: number; y: number }, kind: CreateKind = 'free', fromId?: string) {
    if (!activeNode) return
    const spot = placeDraft(point)
    setMenu(null)
    setDraft((prev) => ({
      x: spot.x,
      y: spot.y,
      kind,
      name: prev?.name ?? '',
      label: prev?.label ?? '',
      fromId: fromId ?? activeNode.id,
      advanced: kind !== 'free' && kind !== 'related',
    }))
  }

  function finishDraft() {
    setDraft((current) => {
      if (!current) return current
      const name = current.name.trim()
      if (!name) return current
      onCommit(current.kind, current.fromId, name, { label: current.label || undefined, x: current.x, y: current.y })
      return null
    })
  }

  function startGate(event: ReactPointerEvent, fromId: string, kind: CreateKind) {
    event.preventDefault()
    event.stopPropagation()
    skipClick.current = true
    clearHoldTimer()
    holdId.current = null
    const point = localPoint(event)
    host.current?.setPointerCapture(event.pointerId)
    setDrag({ fromId, kind, x: point.x, y: point.y, startX: point.x, startY: point.y, moved: false })
  }

  function startThoughtPress(event: ReactPointerEvent, fromId: string) {
    if (event.button !== 0) return
    event.stopPropagation()
    const point = localPoint(event)
    clearHoldTimer()
    holdTimer.current = window.setTimeout(() => {
      skipClick.current = true
      setHeldId(fromId)
      setDrag(null)
    }, HOLD_MS)
    host.current?.setPointerCapture(event.pointerId)
    setDrag({ fromId, kind: 'related', x: point.x, y: point.y, startX: point.x, startY: point.y, moved: false })
  }

  function move(event: ReactPointerEvent) {
    if (!drag) return
    const point = localPoint(event)
    const moved = drag.moved || Math.hypot(point.x - drag.startX, point.y - drag.startY) > TAP_SLOP
    if (moved) clearHoldTimer()
    setDrag({ ...drag, x: point.x, y: point.y, moved })
    setHover(moved ? hitThought(point.x, point.y, drag.fromId) : null)
  }

  function endDrag(event: ReactPointerEvent) {
    if (!drag) return
    if (host.current?.hasPointerCapture(event.pointerId)) {
      host.current.releasePointerCapture(event.pointerId)
    }
    const point = localPoint(event)
    const moved = drag.moved || Math.hypot(point.x - drag.startX, point.y - drag.startY) > TAP_SLOP
    const targetId = moved ? hitThought(point.x, point.y, drag.fromId) : null
    if (moved && targetId) onLink(drag.fromId, targetId, drag.kind === 'free' ? 'related' : drag.kind)
    else if (!moved && drag.kind !== 'related' && drag.kind !== 'free') openDraft(point, drag.kind, drag.fromId)
    else if (moved && drag.kind !== 'related' && drag.kind !== 'free') openDraft(point, drag.kind, drag.fromId)
    else if (moved) openDraft(point, 'related', drag.fromId)
    setDrag(null)
    setHover(null)
  }

  function cancelDrag() {
    clearHoldTimer()
    setDrag(null)
    setHover(null)
  }

  function onBackgroundDown(event: ReactPointerEvent) {
    if (event.button !== 0) return
    if (drag || isChrome(event.target)) return
    const point = localPoint(event)
    if (hitThought(point.x, point.y)) return
    event.preventDefault()
    skipClick.current = true
    holdId.current = event.pointerId
    setHeldId(null)
    host.current?.setPointerCapture(event.pointerId)
    openDraft(point, 'free')
  }

  function onBackgroundUp(event: ReactPointerEvent) {
    clearHoldTimer()
    if (drag) {
      endDrag(event)
      holdId.current = null
      return
    }
    if (holdId.current === event.pointerId) {
      event.preventDefault()
      if (host.current?.hasPointerCapture(event.pointerId)) {
        host.current.releasePointerCapture(event.pointerId)
      }
      holdId.current = null
      skipClick.current = true
      window.setTimeout(() => input.current?.focus({ preventScroll: true }), 0)
    }
  }

  const origin = drag ? byId.get(drag.fromId) : undefined
  const originGate = origin ? gatePoint(origin, drag?.kind === 'parent' ? 'parent' : drag?.kind === 'child' ? 'child' : 'center') : null
  const draftFrom = draft ? byId.get(draft.fromId) : undefined
  const draftGate =
    draft && draftFrom && draft.kind !== 'free'
      ? gatePoint(draftFrom, draft.kind === 'parent' || draft.kind === 'child' ? draft.kind : 'center')
      : null
  const sourceName = draftFrom?.thought.name ?? zones.active.name

  return (
    <div
      ref={host}
      className={`plex${drag ? ' is-wiring' : ''}${draft ? ' is-drafting' : ' is-capturing'}`}
      onPointerDown={onBackgroundDown}
      onPointerMove={move}
      onPointerUp={onBackgroundUp}
      onPointerCancel={() => {
        cancelDrag()
        holdId.current = null
      }}
      onClick={(event) => {
        if (!skipClick.current) return
        event.preventDefault()
        event.stopPropagation()
        skipClick.current = false
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg className="plex-lines" width={size.w} height={size.h}>
        {edges.map((edge) => {
          const from = byId.get(edge.fromId)
          const to = byId.get(edge.toId)
          if (!from || !to) return null
          const a =
            edge.kind === 'jump'
              ? gatePoint(from, from.role === 'jump' ? 'center' : 'jump')
              : edge.kind === 'related' || edge.kind === 'sibling'
                ? gatePoint(from, 'center')
                : from.y < to.y
                  ? gatePoint(from, 'child')
                  : gatePoint(from, 'parent')
          const b =
            edge.kind === 'jump'
              ? gatePoint(to, to.role === 'jump' ? 'center' : 'jump')
              : edge.kind === 'related' || edge.kind === 'sibling'
                ? gatePoint(to, 'center')
                : from.y < to.y
                  ? gatePoint(to, 'parent')
                  : gatePoint(to, 'child')
          return <path key={edge.id} d={curvePath(a.x, a.y, b.x, b.y)} className={`link link-${edge.kind}`} />
        })}
        {drag?.moved && originGate ? (
          <path d={curvePath(originGate.x, originGate.y, drag.x, drag.y)} className={`link link-drag link-${drag.kind}`} />
        ) : null}
        {draft && draftGate ? (
          <path
            d={curvePath(draftGate.x, draftGate.y, draft.x + 18, draft.y + 22)}
            className={`link link-drag link-${draft.kind}`}
          />
        ) : null}
      </svg>

      {nodes.map((node) => {
        const filledParent = parentsOf(doc, node.id).length > 0
        const filledChild = childrenOf(doc, node.id).length > 0
        const filledJump = jumpsOf(doc, node.id).length > 0
        const held = heldId === node.id
        return (
          <div
            key={node.id}
            className={`thought role-${node.role}${hover === node.id ? ' drop-target' : ''}${held ? ' is-held' : ''}`}
            data-thought-id={node.id}
            style={{
              left: node.x,
              top: node.y,
              width: node.w,
              height: node.h,
              borderColor: node.thought.color,
              color: node.role === 'active' ? '#f8fbff' : node.thought.color,
            }}
            onPointerDown={(event) => startThoughtPress(event, node.id)}
            onClick={() => {
              if (skipClick.current) {
                skipClick.current = false
                return
              }
              onActivate(node.id)
            }}
            onDoubleClick={() => openDraft({ x: node.x + node.w + 20, y: node.y }, 'related', node.id)}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setHeldId(node.id)
              setMenu({ x: event.clientX, y: event.clientY, id: node.id })
            }}
          >
            <button type="button" className="gate parent-gate" data-filled={filledParent} title="Hold for parent" onPointerDown={(event) => startGate(event, node.id, 'parent')} />
            <button type="button" className="gate jump-gate" data-filled={filledJump} title="Hold for jump" onPointerDown={(event) => startGate(event, node.id, 'jump')} />
            <button type="button" className="gate child-gate" data-filled={filledChild} title="Hold for child" onPointerDown={(event) => startGate(event, node.id, 'child')} />
            {node.thought.label ? <em>{node.thought.label}</em> : null}
            <strong>{node.thought.name}</strong>
            {held ? (
              <div className="quick-add">
                <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onCreate('parent', node.id) }}>+ parent</button>
                <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onCreate('jump', node.id) }}>+ jump</button>
                <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onCreate('child', node.id) }}>+ child</button>
              </div>
            ) : null}
          </div>
        )
      })}

      {draft ? (
        <form
          className={`inline-draft kind-${draft.kind}`}
          style={{ left: draft.x, top: draft.y, width: DRAFT_W }}
          onSubmit={(event) => {
            event.preventDefault()
            finishDraft()
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <em>
            {draft.kind === 'free'
              ? 'New thought'
              : draft.kind === 'related'
                ? `Line to ${sourceName}`
                : `${draft.kind} of ${sourceName}`}
          </em>
          <input
            ref={input}
            value={draft.name}
            placeholder="Name the thought"
            aria-label="New thought"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setDraft(null)
              }
            }}
          />
          {draft.kind === 'related' ? (
            <div className="draft-kinds" aria-label="Connection">
              <button type="button" className="on" onMouseDown={(event) => event.preventDefault()}>
                Line
              </button>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setDraft({ ...draft, kind: 'free' })}>
                Keep free
              </button>
            </div>
          ) : null}
          {draft.advanced ? (
            <div className="draft-kinds" aria-label="Advanced relation">
              {ADVANCED_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={draft.kind === kind ? 'on' : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setDraft({ ...draft, kind })}
                >
                  {kind}
                </button>
              ))}
            </div>
          ) : null}
          <div className="draft-actions">
            <button type="submit" disabled={!draft.name.trim()}>
              Create
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="plex-legend">
        <span>tap empty space for a free thought</span>
        <span>drag to draw a simple line</span>
        <span>hold a thought for parent / child / jump</span>
      </div>

      {menu ? (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { onActivate(menu.id); setMenu(null) }}>Activate</button>
          <button type="button" onClick={() => { onCreate('related', menu.id); setMenu(null) }}>Draw a line</button>
          <button type="button" onClick={() => { onCreate('child', menu.id); setMenu(null) }}>Create child</button>
          <button type="button" onClick={() => { onCreate('parent', menu.id); setMenu(null) }}>Create parent</button>
          <button type="button" onClick={() => { onCreate('jump', menu.id); setMenu(null) }}>Create jump</button>
          <button type="button" onClick={() => { onPin(menu.id); setMenu(null) }}>Pin / unpin</button>
          <button type="button" onClick={() => { onForget(menu.id); setMenu(null) }}>Forget</button>
        </div>
      ) : null}
    </div>
  )
}
