# Architecture

Vite + React 19 + @xyflow/react.

- `src/seed.ts` — canonical Whole Theory and Mirror & Freedom cards
- `src/lib/document.ts` — view filters, add/connect/file operations
- `src/lib/store.ts` — IndexedDB snapshot (`dream-unity-atlas-v2`)
- `src/components/AtlasCanvas.tsx` — quadrant desk, cards, labelled edges
- `src/components/FilingRail.tsx` — view switcher
- `src/components/Inspector.tsx` — selected card readout
- `src/components/Dossier.tsx` — full note and drawers

GitHub Pages builds from `main` with `.github/workflows/deploy-pages.yml`. Base path is `/theory/`.
