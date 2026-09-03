# Dream Unity — TheBrain

A web reconstruction of [TheBrain](https://thebrain.com) for the Dream Unity theory.

This is not a conventional mind map. It is a **Plex**: the active thought sits in the centre and the whole map reorganises around it.

## TheBrain model

| Zone | Position | Meaning |
| --- | --- | --- |
| Active thought | Centre | Current focus |
| Parents | Above | Superordinate topics |
| Children | Below | Subtopics |
| Jumps | Left | Related, not hierarchical |
| Siblings | Right | Share a parent with the active thought |

Each thought has three **gates**: top = parent, bottom = child, left = jump. Hollow means no links; filled means links exist. Drag a gate onto another thought to link them, or drop on empty space to create a new thought.

## Views

- **Normal** — the Plex
- **Outline** — parentless roots and their child trees
- **Mind Map** — active thought with parents above and children below
- **Cards** — every visible thought as a note card

Expand shows one extra generation (grandparents / grandchildren).

## Mechanics

Instant Activate search, pins, back/forward/home, notes, URL attachments, types/labels, tags, thought colour, forget instead of hard delete, JSON export/import, local persistence.

Shortcuts: `F6` child, `F7` parent, `F8` jump, `Home`, `Alt+←` / `Alt+→`, `/` search, `Ctrl+Delete` forget. Double-click a thought to create a child.

```bash
npm install
npm run dev
```
