import { describe, expect, it } from 'vitest'
import { SEED } from '../seed'
import { childrenOf, parentsOf, plexZones, relatedOf, relationFromPoint, siblingsOf } from './plex'
import { createLinkedThought } from './mutate'

describe('plex zones', () => {
  it('puts Dream Unity children below the home thought', () => {
    const zones = plexZones(SEED, 'home')
    expect(zones?.active.name).toBe('Dream Unity')
    expect(zones?.children.map((t) => t.id).sort()).toEqual(['maker', 'machine', 'unity', 'world'].sort())
    expect(zones?.parents).toEqual([])
    expect(zones?.jumps.map((t) => t.id).sort()).toEqual(['mirror', 'realisation'].sort())
  })

  it('derives siblings from a shared parent', () => {
    expect(parentsOf(SEED, 'intention')).toEqual(['maker'])
    expect(childrenOf(SEED, 'maker')).toContain('craft')
    expect(siblingsOf(SEED, 'intention')).toEqual(expect.arrayContaining(['craft', 'insight']))
  })

  it('shows jumps beside the active thought', () => {
    const zones = plexZones(SEED, 'unity-core')
    expect(zones?.jumps.some((t) => t.id === 'creative-freedom')).toBe(true)
    expect(zones?.parents.some((t) => t.id === 'unity')).toBe(true)
  })

  it('keeps an unlinked thought visible without forcing a relation', () => {
    const next = createLinkedThought(SEED, 'home', 'free', 'Solo Idea', 'source', { x: 80, y: 90 })
    const zones = plexZones(next, 'home')
    const solo = next.thoughts.find((thought) => thought.name === 'Solo Idea')
    expect(zones?.loose.some((thought) => thought.name === 'Solo Idea')).toBe(true)
    expect(relatedOf(next, 'home')).not.toContain(solo?.id)
    expect(solo?.x).toBe(80)
    expect(solo?.y).toBe(90)
  })

  it('stores a simple mind-map line as related', () => {
    const next = createLinkedThought(SEED, 'home', 'related', 'Connected Idea', 'source')
    const zones = plexZones(next, 'home')
    expect(zones?.related.some((thought) => thought.name === 'Connected Idea')).toBe(true)
  })
})

describe('spatial capture', () => {
  const active = { x: 400, y: 300, w: 200, h: 60 }

  it('reads the TheBrain compass from an empty tap', () => {
    expect(relationFromPoint(active, { x: 500, y: 120 })).toBe('parent')
    expect(relationFromPoint(active, { x: 500, y: 520 })).toBe('child')
    expect(relationFromPoint(active, { x: 120, y: 330 })).toBe('jump')
    expect(relationFromPoint(active, { x: 860, y: 330 })).toBe('sibling')
  })

  it('defaults a tap on the active thought to a simple line', () => {
    expect(relationFromPoint(active, { x: 500, y: 330 })).toBe('related')
  })
})
