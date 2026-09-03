export type LinkKind = 'child' | 'jump' | 'related'
export type ViewMode = 'plex' | 'outline' | 'mindmap' | 'cards'
export type CreateKind = 'child' | 'parent' | 'jump' | 'sibling' | 'related' | 'free'

export interface Attachment {
  id: string
  title: string
  url?: string
}

export interface Thought {
  id: string
  name: string
  label?: string
  notes: string
  color: string
  icon?: string
  tags: string[]
  attachments: Attachment[]
  forgotten?: boolean
  x?: number
  y?: number
}

export interface Link {
  id: string
  kind: LinkKind
  from: string
  to: string
}

export interface BrainDocument {
  schemaVersion: 4
  title: string
  homeId: string
  activeId: string
  pins: string[]
  thoughts: Thought[]
  links: Link[]
  history: string[]
  historyIndex: number
  updatedAt: string
}

export interface BrainMeta {
  id: string
  title: string
  updatedAt: string
  thoughtCount: number
  homeName: string
  color: string
  template?: 'dream-unity' | 'blank'
}

export interface BrainLibrary {
  schemaVersion: 1
  activeId: string | null
  items: BrainMeta[]
}

export interface PlexZones {
  active: Thought
  parents: Thought[]
  children: Thought[]
  jumps: Thought[]
  siblings: Thought[]
  related: Thought[]
  loose: Thought[]
  grandparents: Thought[]
  grandchildren: Thought[]
}

export interface PlacedThought {
  id: string
  thought: Thought
  role: 'active' | 'parent' | 'child' | 'jump' | 'sibling' | 'grandparent' | 'grandchild' | 'related' | 'loose'
  x: number
  y: number
  w: number
  h: number
}

export interface PlexEdge {
  id: string
  kind: LinkKind | 'sibling'
  fromId: string
  toId: string
}
