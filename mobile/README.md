# CastAway mobile

A phone-first UI for CastAway. It uses the same FastAPI backend and data as `../frontend` (the desktop map), with a layout built for touch:

- a full-screen map, with no zoom buttons (pinch to zoom)
- a bottom sheet holding a thumb-sized date bar (prev/next, play, slider)
- tabs in the sheet for Hotspots, Layers, Legend and About
- tapping a lost item or coast cell opens a detail card in the sheet, instead of a small map popup
- a larger tap area around map dots
- a bottom menu with Home, Leaderboard, Rapportering and Profile. Home returns to the whole region. The other three are "coming soon" placeholders, because accounts, leaderboards and found-net reporting are out of scope for the prototype (see `../CLAUDE.md`)
- a **?** button at the top right that opens a step-by-step guide to the app, with a close button

## Run

```bash
# 1. backend (from ../backend), as in the main README
.venv/bin/python -m uvicorn castaway.api:app --port 8000

# 2. mobile UI
npm install
npm run dev          # http://localhost:5174 (the desktop frontend uses 5173)
```

**On your phone:** connect it to the same Wi-Fi as your laptop and open the "Network" URL Vite prints (`http://<laptop-ip>:5174`). The dev server proxies `/api` to the backend, so you don't need to change the backend's CORS settings. Set `CASTAWAY_API_URL` if the backend is not on `http://localhost:8000`.

To install it like an app, use "Add to Home Screen" in Safari or Chrome. A web manifest is included.

`src/api.ts`, `src/format.ts` and `components/Legend.tsx` are copies from `../frontend/src`. Keep them in sync when the API or colour ramps change.
