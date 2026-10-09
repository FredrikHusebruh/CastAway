# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CastAway is a hackathon prototype (favour a working result over completeness). It forecasts where lost fishing gear will wash ashore on the Norwegian coast:

```
barentswatch.py ──> forcing.py ──> simulate.py ──> aggregate.py ──> data/output/*.geojson ──> api.py ──> frontend (React map)
 lost-gear table    NorKyst subset   OpenDrift runs   strandings→cells   index.json, tracks/     FastAPI     date slider
```

`backend/scripts/run_forecast.py` runs the whole pipeline. The API serves only precomputed files; it never runs a model.

## Commands

The Python env is a uv venv at `backend/.venv` (Python 3.11, OpenDrift from PyPI). `backend/environment.yml` is a conda-forge fallback; that env exists at `~/anaconda3/envs/castaway`, and conda is not on PATH.

```bash
# one-time setup
cd backend && uv venv .venv --python 3.11 && uv pip install --python .venv/Scripts/python.exe -r requirements.txt
cd frontend && npm install

# pipeline (from backend/)
PY=.venv/Scripts/python.exe
$PY scripts/fetch_gear.py                 # fetch + inspect lost gear, per-region counts
$PY scripts/plot_one_net.py               # single-net sanity run -> data/output/one_net.png
$PY scripts/run_forecast.py [--region finnmark_east] [--max-nets N] [--force] [--refetch] [--mock]
$PY scripts/make_mock_gear.py [--n 60] [--days N] [--seed 42]      # synthetic gear -> data/raw/mock_gear.csv (use with --mock)
CASTAWAY_NOW=2026-10-08T21:00:00Z $PY scripts/run_forecast.py   # pin "now" to reuse an existing run dir (re-aggregate only)

# tests / lint (from backend/)
$PY -m pytest
$PY -m pytest tests/test_aggregate.py::test_expected_nets   # single test
$PY -m ruff check .

# serve
$PY -m uvicorn castaway.api:app --reload --port 8000     # from backend/
npm run dev | npm run build | npm run lint                # from frontend/ (Vite on :5173; lint = oxlint)
```

**Runtime expectations:**
- The first pipeline run downloads about 110 s of NorKyst forcing per day. The default window is 7 hindcast + 3 forecast days, so roughly 20 minutes.
- The forcing is cached per day in `data/raw/forcing/`, so later runs only fetch new or stale forecast days.
- Simulation results go to `data/output/runs/<forecast_start>/` with a `manifest.json`, so reruns skip nets already simulated.

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
- **Data exchange:**
  - GeoJSON in WGS84, coordinates in `[lon, lat]` order, times in ISO-8601 UTC.
  - Per-day files are `beaching_<YYYY-MM-DD>.geojson`.
- **Attribution "Data: BarentsWatch, MET Norway. Drift model: OpenDrift." must stay visible on the map.** OpenDrift is GPL v2 and only runs server-side. Don't bundle it into the frontend.
- **Times:** use aware UTC datetimes throughout the codebase. OpenDrift wants naive UTC, so convert with `simulate.naive_utc()` at that boundary only. OpenDrift's own log timestamps are UTC; the other logs use local time.
- **Map colours:**
  - The beaching layer uses a single-hue orange ramp (`frontend/src/format.ts` and `index.css`), validated as an ordinal ramp against the OSM basemap. Don't switch to blue, which disappears against the sea.
  - Class breaks come from `index.json` `color_breaks`. They are log-spaced, because quantiles collapse onto the per-gear single-particle weights.
- **Mock data:**
  - `castaway/mock_gear.py` produces the real gear schema, and `index.json` `gear_source: "mock"` triggers the MOCK DATA badge in the UI. Never remove that badge.
  - Mock runs live in `runs/mock_<hour>/` but overwrite the same `data/output/` files.
- **Map semantics:**
  - A beaching date means strandings in the `BEACHING_WINDOW_DAYS` (7) days up to and including it, not just that day. `index.json` `expected_nets_per_date` holds those 7-day totals.
  - The default drift view is particle paths from `paths/<id>.json`: `PATH_PARTICLES_PER_FACTOR` particles per windage, hourly. `/api/paths` trims them to the date and thins them when many nets are selected. Paths are coloured by windage (ordinal violet).
  - The optional heat map from `drift/<id>.json`. Those files hold per-day particle-hour counts on a `DRIFT_CELL_KM` grid. `aggregate.combine_drift` (used by `/api/drift`) turns them into relative likelihood.
  - The violet drift ramp (`format.ts` `DRIFT_RAMP`) was validated against the OSM sea colour.
- **Spin-up:** most nets are seeded together at the window start, so strandings in the first `SPINUP_HOURS` are seeding artefacts. `aggregate.write_outputs` drops them, and the dates start at `Window.first_day`.
- **Code style:** small typed functions. Python 3.11 and ruff on the backend; TypeScript strict and Tailwind on the frontend.
- **Out of scope:** accounts, gamification, found-net reporting, notifications and deployment. Leave stubs at the marked extension points (e.g. a `found_reports` layer), but don't build them.

## Data sources and quirks (verified 2026-10-08)

- **Lost gear:**
  - With credentials: OAuth client-credentials → `GET /bwapi/v1/lostfishingfacility/notremoved`. Fields per the OpenAPI spec: `lostMessageId, toolTypeCode, lostTime, geometry`.
  - Without credentials (the current default): the public `GET /bwapi/v1/geodata/download/anonymouslostfishingfacility?format=OLEX`. It is gzip'd OLEX text:
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
- **Default region:** `finnmark_east`, because that's where most recent reports are. Vestland and Lofoten have very few.
