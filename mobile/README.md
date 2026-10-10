# CastAway mobile

The CastAway app, phone-first but also used on PCs. **The whole UI is in Norwegian.** It uses the same FastAPI backend and data as `../frontend` (the desktop map), with a layout built for touch:

- a full-screen vector map (MapLibre GL with free OpenFreeMap tiles, no API key) made for the sea: blue sea, crisp coastline, soft natural land colours and place names, no roads or borders (always light); it opens where you are if you allow location
- a bottom sheet holding a thumb-sized date bar (prev/next, play, slider). **Play steps through time half an hour at a time**: selected items' particles move along their drift paths, strandings pop up along the coast as they happen, and the beaching map cross-fades from one day to the next
- tabs in the sheet for Hotspots, Layers, Legend and About
- tapping a lost item or coast cell opens a detail card in the sheet, instead of a small map popup
- a larger tap area around map dots
- hotspots and coast cells are named after the nearest place (Kartverket's public place-name service), with coordinates as a fallback
- the same map content as the desktop app: smooth viridis rasters for the beaching forecast and drift heat map (MapLibre image layers), drift paths with 100 m stranding squares (GPU line and symbol layers), and **item focus** (tap a lost item → "Vis hvor det driver i land" shows that item's own chance in %; "Vis alle" goes back)
- a bottom menu with **Hjem**, **Rapportering**, **Toppliste** and **Profil**:
  - Hjem returns to the whole region.
  - Rapportering reports found gear, "checked, nothing here" and clean-ups, using an in-app camera with GPS and time. A found item can later be marked as handed in.
  - Toppliste ranks people, teams and municipalities, per season or all-time, against labelled demo participants.
  - Profil holds the name, team and municipality, points, streak, badges, and a demo moderator.
  - Everything is stored on the device only (IndexedDB/localStorage). The points rules are in `src/game/rules.ts` (see the main README, "Reporting and points").
- the user's own reports on the map as the "Mine funn" layer (teal dots, fainter while pending)
- a **?** button at the top right that opens a step-by-step guide to the app, with a close button

## Run

```bash
# 1. backend (from ../backend), as in the main README
.venv/bin/python -m uvicorn castaway.api:app --port 8000

# 2. mobile UI
npm install
npm run dev          # http://localhost:5174 (the desktop frontend uses 5173)
npm test             # points and verification rules (vitest)
```

The camera and GPS need https or localhost. **On your phone:** connect it to the same Wi-Fi as your laptop and open the "Network" URL Vite prints (`http://<laptop-ip>:5174`). The dev server proxies `/api` to the backend, so you don't need to change the backend's CORS settings. Set `CASTAWAY_API_URL` if the backend is not on `http://localhost:8000`.

To install it like an app, use "Add to Home Screen" in Safari or Chrome. A web manifest is included.

`src/api.ts`, `src/format.ts`, `src/raster.ts`, `src/staticData.ts` and `components/Legend.tsx` come from `../frontend/src` (`api.ts` keeps the empty default `API_URL` for the dev proxy; `format.ts` and `Legend.tsx` are translated to Norwegian and have a few extras, but their logic must match). Keep them in sync when the API, colour ramps or `aggregate.py` change.

**Static build** (this is what the website publishes): `VITE_STATIC=true npm run build`, then copy the forecast files into `dist/data/`. The app then reads `data/*.json|geojson` instead of the API. This is **the** CastAway app, used on phones and PCs; `../frontend` is a debug map. The CI workflow builds it on every push and publishes it at the site root (`castaway/`), with the forecast files in `castaway/data/`. The debug map is at `castaway/debug/`.
