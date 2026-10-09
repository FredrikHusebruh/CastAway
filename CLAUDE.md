# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CastAway is a hackathon prototype (favour a working result over completeness). It forecasts where lost fishing gear will wash ashore on the Norwegian coast:

```
barentswatch.py ──> forcing.py ──> simulate.py ──> aggregate.py ──> data/output/*.geojson ──> api.py ──> mobile/ (the app)
                                                                                                  └──> frontend/ (debug map)
 lost-gear table    NorKyst subset   OpenDrift runs   strandings→cells   index.json, tracks/     FastAPI     date slider
```

`backend/scripts/run_forecast.py` runs the whole pipeline. The API serves only precomputed files; it never runs a model.

## Commands

The Python env is a uv venv at `backend/.venv` (Python 3.11, OpenDrift from PyPI). `backend/environment.yml` is a conda-forge fallback; that env exists at `~/anaconda3/envs/castaway`, and conda is not on PATH.

```bash
# one-time setup
cd backend && uv venv .venv --python 3.11 && uv pip install --python .venv/Scripts/python.exe -r requirements.txt
cd mobile && npm install          # the app
cd frontend && npm install        # the debug map

# pipeline (from backend/)
PY=.venv/Scripts/python.exe
$PY scripts/fetch_gear.py                 # fetch + inspect lost gear, per-region counts
$PY scripts/plot_one_net.py               # single-net sanity run -> data/output/one_net.png
$PY scripts/run_forecast.py [--region kristiansand|finnmark_east|vestland|lofoten] [--max-nets N] [--force] [--refetch] [--mock]
$PY scripts/make_mock_gear.py [--n 60] [--days N] [--seed 42]      # synthetic gear -> data/raw/mock_gear.csv (use with --mock)
CASTAWAY_NOW=2026-10-08T21:00:00Z $PY scripts/run_forecast.py   # pin "now" to reuse an existing run dir (re-aggregate only)

# tests / lint (from backend/)
$PY -m pytest
$PY -m pytest tests/test_aggregate.py::test_expected_nets   # single test
$PY -m ruff check .

# serve
$PY -m uvicorn castaway.api:app --reload --port 8000     # from backend/
npm run dev | npm run build | npm run lint                # from mobile/: the app (Vite on :5174, proxies /api; lint = oxlint)
npm run dev | npm run build | npm run lint                # from frontend/: the debug map (Vite on :5173)
```

**Runtime expectations:**
- The first pipeline run downloads about 110 s of NorKyst forcing per day. The default window is 7 hindcast + 3 forecast days, so roughly 20 minutes.
- The forcing is cached per day in `data/raw/forcing/`, so later runs only fetch new or stale forecast days.
- Simulation results go to `data/output/runs/<mock|real>_<region>_<forecast hour>_<gear fingerprint>/` with a `manifest.json`. Reruns with identical input skip nets already simulated; changed input (mock ids repeat!) gets a fresh folder.

**Deployment (static, no server):**
- **`mobile/` is THE app**, for phones and PCs alike. New user-facing features go here. **`frontend/` is a debug tool**; only add features to it if they help debugging.
- `.github/workflows/ci-cd.yml`:
  - On every push it runs the backend tests and lints and builds both apps (`VITE_STATIC=true`; the debug map with `VITE_DATA_URL=../data`), saving both builds as artifacts.
  - On `Main`, daily, or a manual run, the `publish` job runs the forecast and assembles `site/`: the app build at the root, `backend/data/output/` minus `runs/` and `tracks/` in `site/data/`, and the debug-map build in `site/debug/`. It then uploads `site/` by FTP (SamKirkland/FTP-Deploy-Action) to `public_html/castaway/`.
  - `publish` only requires the backend tests and the app. If the debug map fails, it is left out with a warning and never blocks the real app's deploy.
  - The secrets are `FTP_SERVER`, `FTP_USERNAME` and `FTP_PASSWORD`, and the workflow only needs `contents: read`.
- `staticData.ts` reproduces `/api/paths`, `/api/drift` and `/api/net/{id}/beaching` from the files. Whenever `aggregate.trim_paths`, `combine_drift`, `item_window_cells` or the API thinning change, change it too.
- **Shared copies:** `mobile/src/` keeps copies of `staticData.ts`, `raster.ts`, `api.ts`, `format.ts` and `components/Legend.tsx` from `frontend/src/`. When you change one, make the same change in the other; `format.ts` has extra mobile helpers at the end, and the mobile `api.ts` keeps an empty default `API_URL` for the dev proxy.
- Check parity by running `staticData.ts` in Node against the static files and comparing with the API (0 mismatches as of 2026-10-09).

## Rules

- **Config is the single source of truth.** All tunables, URLs, paths and region presets live in `backend/castaway/config.py`, and most can be overridden with a `CASTAWAY_*` env var. Don't put magic numbers in the modules.
- **Verify every stage by running it** before building on it, and record each shortcut or simplification in README "Known limitations / shortcuts".
- **BarentsWatch:**
  - Make requests sequentially, single-threaded (BarentsWatch asks for this).
  - Always cache raw responses in `backend/data/raw/`.
  - Credentials come only from `backend/.env` (`BW_CLIENT_ID`, `BW_CLIENT_SECRET`). Never commit them.
  - Inspect a real response before you write or change parsing code. Don't guess field names.
- **THREDDS (thredds.met.no):**
  - Its terms forbid parallel OPeNDAP sessions, so keep downloads sequential.
  - Each request costs about 1 s per variable per time step, whatever the area. That's why `forcing.py` caches daily subsets and fetches wind at a 3 h stride.
  - Never point OpenDrift readers at the remote URLs for the long hindcast.
- **Privacy:** raw records contain PII: vesselName, contactEmail/Phone, ircs, mmsi, imo, regNum and the comments. The only fields that may leave `data/raw/` are `id, lon, lat, lost_time, gear_type, float_prob`.
  - `fetch_notremoved` strips each record to `NOTREMOVED_FIELDS` *before* writing `notremoved.json`, so no personal data ever reaches disk.
  - The CI cache holds only `backend/data/raw/forcing`. GitHub caches are readable by pull-request runs, including runs from forks, so never cache the BarentsWatch downloads.
- **Data exchange:**
  - GeoJSON in WGS84, coordinates in `[lon, lat]` order, times in ISO-8601 UTC.
  - Per-day files are `beaching_<YYYY-MM-DD>.geojson`.
- **Attribution "Data: BarentsWatch, MET Norway. Drift model: OpenDrift." must stay visible on the map.** OpenDrift is GPL v2 and only runs server-side. Don't bundle it into the frontend.
- **Times:** use aware UTC datetimes throughout the codebase. OpenDrift wants naive UTC, so convert with `simulate.naive_utc()` at that boundary only. OpenDrift's own log timestamps are UTC; the other logs use local time.
- **Map colours:**
  - The beaching layer uses **viridis** (user's choice, dark purple → yellow) with opacity that increases with value (`RAMP`/`RAMP_OPACITY` in `format.ts`, mirrored in `index.css`). It is drawn as a smooth raster: `raster.ts` `buildRaster` interpolates cell values bilinearly, Gaussian-smooths them (`*_SMOOTH_CELLS` in `Map.tsx`, rescaled to keep the peak value), maps rows to Mercator, then colours them. The user rejected numbered hotspot badges, so don't add them back.
  - The goal is that hotspots stand out; the user found evenly weighted cells useless. Don't switch to blue, which disappears against the sea.
  - Class breaks come from `index.json` `color_breaks`. They are log-spaced, because quantiles collapse onto the per-gear single-particle weights.
- **Mock data:**
  - `castaway/mock_gear.py` produces the real gear schema, and `index.json` `gear_source: "mock"` triggers the MOCK DATA badge in the UI. Never remove that badge.
  - Mock and real runs overwrite the same `data/output/` files. Output names repeat across runs, so the API sets `Cache-Control: no-cache` on `/api/*` and the frontend fetches with `cache: 'no-cache'`. Keep both, or stale data from a previous run shows up in the browser.
- **Map semantics:**
  - A beaching date means strandings in the `BEACHING_WINDOW_DAYS` (7) days up to and including it, not just that day. `index.json` `expected_nets_per_date` holds those 7-day totals.
  - The default drift view is particle paths from `paths/<id>.json`: `PATH_PARTICLES_PER_FACTOR` particles per windage, every output step (15 min; `step_minutes` is stored in each file). `/api/paths` trims them to the date and thins them when many nets are selected. Paths are coloured by windage (viridis).
  - The optional heat map from `drift/<id>.json`. Those files hold per-day particle-hour counts on a `DRIFT_CELL_KM` grid. `aggregate.combine_drift` (used by `/api/drift`) turns them into relative likelihood.
  - The drift heat map and the particle paths use **viridis** (`format.ts` `VIRIDIS`/`WINDAGE_RAMP`), at the user's request.
  - Beaching and drift likelihood are interpolated rasters (`ImageOverlay`), not per-cell shapes. Clicks on the beaching layer are resolved to the nearest cell in `BeachingLayer`, and gear markers set `bubblingMouseEvents={false}`.
  - Stranded-particle markers are 100 m squares at true size, de-duplicated per spot. Never draw them as circles.
  - Particle paths and stranding squares are drawn by `PathsCanvas` on a single canvas, batched per colour, with pixel thinning, redrawn on `moveend`/`zoomend`. Don't go back to one Leaflet `Polyline` per particle; that made the map laggy.
- **Item focus:**
  - Clicking a lost item (`onShowItem`) sets `itemId` in `App.tsx`. The beaching layer then shows `/api/net/{id}/beaching` instead of the regional file: the same cell format, where `expected_nets` is that item's total chance.
  - The data comes from `output/strandings/<id>.json`, written by `aggregate.item_strandings` from the spin-up-filtered strandings. So an item's map is exactly its share of the regional map.
  - A coast-cell popup keeps regional mode.
- **Spin-up:** most nets are seeded together at the window start, so strandings in the first `SPINUP_HOURS` are seeding artefacts. `aggregate.write_outputs` drops them, and the dates start at `Window.first_day`.
- **Code style:** small typed functions. Python 3.11 and ruff on the backend; TypeScript strict and Tailwind on the frontend.
- **Out of scope:** accounts, gamification, found-net reporting and notifications. Leave stubs at the marked extension points (e.g. a `found_reports` layer, and the mobile app's "coming soon" tabs), but don't build them.
- **Deployment is in scope** (since 2026-10-09, at the user's request), as the static FTP pipeline described above. Keep it simple, and don't add servers.

## Data sources and quirks (verified 2026-10-08)

- **Lost gear:**
  - With credentials: OAuth client-credentials → `GET /bwapi/v1/lostfishingfacility/notremoved`. Fields per the OpenAPI spec: `lostMessageId, toolTypeCode, lostTime, geometry`.
  - The user has credentials in `backend/.env` (since 2026-10-09), so `notremoved` is the active real source. Its records are GeoJSON Point/LineString, `toolTypeCode` values look like `CRABPOT`/`NETS`, and `lostTime` is local time with an offset.
  - Without credentials, the fallback is the public `GET /bwapi/v1/geodata/download/anonymouslostfishingfacility?format=OLEX`. It is gzip'd OLEX text:
    - Blocks start with `Rute`.
    - Point lines read `lat_minutes lon_minutes unix_epoch label`; divide by 60 for degrees.
    - The gear is in `MTekst 1: Redskapstype: <gear>`.
    - `ToolId` is sometimes empty; those records get a synthetic hash id.
    - Some records are invalid placeholders at lon 180 / lat 90.
- **Gear names:** canonicalised by keyword (`pot`, `net`, `line`, `seine`, `sensor`/`cable`) to the keys of `GEAR_FLOAT_PROB`.
- **Currents and wind:** NorKyst v3 `thredds.met.no/thredds/dodsC/fou-hi/norkystv3_800m_m00_be`.
  - Hourly, from 2024-01 to about now+4 days, on a polar-stereographic X/Y grid.
  - Currents are `u_eastward`/`v_northward`; wind is `Uwind_eastward`/`Vwind_northward`, so it has wind for the hindcast too.
  - The old `sea/norkyst800m/1h/aggregate_be` URL times out.
- **MEPS** `mepslatest` covers only about 61 h ahead. It is off by default (`USE_MEPS_FORECAST_WIND`): NorKyst's wind is MEPS-derived anyway, and reading MEPS remotely in every batch is slow.
- **OpenDrift 1.14 API:**
  - Diffusivity is set with `environment:constant:horizontal_diffusivity`.
  - Stranded particles are found from the `status` variable's `flag_meanings` at each trajectory's last valid output step.
- **Default region:** `kristiansand` (the Agder coast), the user's chosen test area.
  - It has only about 3 real reports a year, so it's used with mock data.
  - `finnmark_east` has the most real reports (about 111 within a year).
  - Forcing is cached per region (`norkyst_*_<region>_<day>.nc`).
