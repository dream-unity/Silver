import { beforeEach, describe, expect, it } from 'vitest'
import { addBrain, blankDocument, loadBrain, loadLibrary, repairDocument } from './store'
import { SEED } from '../seed'

function memoryStorage() {
  const mem = new Map<string, string>()
  return {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mem.set(key, value)
    },
    removeItem: (key: string) => {
      mem.delete(key)
    },
    clear: () => mem.clear(),
    key: (index: number) => [...mem.keys()][index] ?? null,
    get length() {
      return mem.size
    },
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true })
})

describe('repairDocument', () => {
  it('rebuilds a map whose active thought is missing', () => {
    const repaired = repairDocument({
      ...SEED,
      activeId: 'does-not-exist',
      homeId: 'missing-home',
    })
    expect(repaired?.activeId).toBeTruthy()
    expect(repaired?.thoughts.some((thought) => thought.id === repaired.activeId)).toBe(true)
    expect(repaired?.thoughts.some((thought) => thought.id === repaired.homeId)).toBe(true)
  })

  it('returns null for an empty payload so the start menu can take over', () => {
    expect(repairDocument({ schemaVersion: 4, thoughts: [] })).toBeNull()
    expect(repairDocument(null)).toBeNull()
  })
})

describe('library', () => {
  it('stores a blank map and reads it back', () => {
    const created = addBrain(blankDocument('Neuropsychology'), 'blank')
    expect(created.doc.thoughts).toHaveLength(1)
    expect(created.doc.thoughts[0]?.name).toBe('Neuropsychology')
    expect(loadBrain(created.id)?.title).toBe('Neuropsychology')
    expect(loadLibrary().items[0]?.title).toBe('Neuropsychology')
  })
})
