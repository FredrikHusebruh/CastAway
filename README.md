# CastAway

**Where will lost fishing nets wash ashore?** CastAway takes reports of lost fishing gear that has not been recovered and simulates how each item drifts with ocean currents and wind. It records where the simulated particles strand on the Norwegian coast and turns that into a day-by-day *beaching forecast*: the stretches of coast most likely to receive nets on a chosen date. The result is shown on an interactive map with a date slider.

This is a 3-day hackathon prototype, so it favours a working result over completeness.

```
BarentsWatch lost gear ─► NorKyst currents + wind ─► OpenDrift (OceanDrift) ─► stranded particles ─► ~1 km coast cells per day ─► FastAPI ─► React map
```

## Setup

You need Python 3.11 and Node 20+. Developed on Windows; the commands use bash.

```bash
# backend: uv venv (OpenDrift installs from PyPI)
cd backend
uv venv .venv --python 3.11
uv pip install --python .venv/Scripts/python.exe -r requirements.txt   # on macOS/Linux: .venv/bin/python
cp .env.example .env            # optional: BarentsWatch credentials, overrides

# alternative: conda (conda-forge)
conda env create -f environment.yml && conda activate castaway

# frontend
cd ../frontend
npm install
```

**BarentsWatch credentials are optional.**
- Without credentials, CastAway uses the public, anonymised lost-gear download (OLEX format).
- To use the authenticated `notremoved` endpoint, register an API client at barentswatch.no → Min side → API-klienter. Then put `BW_CLIENT_ID` and `BW_CLIENT_SECRET` in `backend/.env`.
- Never commit `.env`.

## Run

```bash
cd backend
.venv/Scripts/python.exe scripts/run_forecast.py          # fetch -> forcing -> simulate -> aggregate
.venv/Scripts/python.exe -m uvicorn castaway.api:app --port 8000

cd frontend
npm run dev                                                # http://localhost:5173
```

The pipeline writes these files to `backend/data/output/`:
- `index.json`: dates, bbox, run time, colour breaks and attribution.
- `lost_gear.geojson`.
- `beaching_<YYYY-MM-DD>.geojson`, one per day.
- `tracks/<net_id>.json`.

Useful flags:
- `--max-nets N`: run a quick test on the N most recent items.
- `--force`: re-simulate everything.
- `--refetch`: ignore the cached BarentsWatch download.
- `--region vestland|lofoten`: use a different region.

### Mock data for demos

The real reports in the default region are mostly old: the median is about 200 days. Old items are all released at the start of the hindcast window. To demo time-aware drift, generate synthetic reports instead:

```bash
.venv/Scripts/python.exe scripts/make_mock_gear.py --n 60 --seed 42   # -> data/raw/mock_gear.csv
.venv/Scripts/python.exe scripts/run_forecast.py --mock
```

How the mock reports are generated:
- **Gear type:** random from a demo mix, mostly nets, long lines and pots.
- **Position:** random, at sea and within `--near-coast-km` (default 10) of land, using the same land mask OpenDrift strands against.
- **Loss time:** random within the last `--days`. By default that's the period after spin-up, so every item drifts from its own loss time.

Currents and wind stay real. The map shows a **MOCK DATA** badge (`index.json` `gear_source: "mock"`).

Mock runs are simulated in their own `runs/mock_<hour>/` directory, but they write the same `data/output/` files as real runs. Run `run_forecast.py` without `--mock` to switch back.

Other helper scripts:
- `scripts/fetch_gear.py`: inspect the lost-gear data and per-region counts.
- `scripts/plot_one_net.py`: sanity plot of one net (`data/output/one_net.png`).

| Endpoint | Returns |
|---|---|
| `GET /api/dates` | available dates + run metadata (`index.json`) |
| `GET /api/gear` | lost gear points (GeoJSON) |
| `GET /api/beaching?date=YYYY-MM-DD` | coast cells for the 7 days up to that date: `expected_nets`, `particle_count`, `n_nets`, `contributing_net_ids` |
| `GET /api/paths?ids=a,b&date=YYYY-MM-DD` | individual particle trajectories (a sample of 40 per item, fewer when many are selected) up to that date, with windage and whether each had stranded |
| `GET /api/drift?ids=a,b&date=YYYY-MM-DD` | drift-likelihood heat map for up to 25 items up to that date: `cells` = `[lat, lon, relative likelihood 0–1]` on a 2 km grid |
| `GET /api/net/{id}/track?date=YYYY-MM-DD` | hourly particle-centroid track of one net, up to that date |

**Runtime** (default region, 111 items × 200 particles, Windows laptop):

| Stage | Time |
|---|---|
| Ocean forcing, first run | about 14 min (about 110 s per day, sequential; cached in `data/raw/forcing/`) |
| Ocean forcing, later runs | only new days, plus forecast days older than 12 h |
| Simulation | about 6 min (5 batches of about 60–85 s) |
| Aggregation | about 10 s |
| Rerun within the same forecast hour | under 1 min (simulated nets are skipped) |

With the forcing cached, a full run takes about 6–7 minutes. To shorten it, lower `CASTAWAY_PARTICLES_PER_NET` or `CASTAWAY_HINDCAST_DAYS`.

## Configuration

Everything lives in `backend/castaway/config.py`. Most settings can be overridden with environment variables or `backend/.env`.

| Setting | Default | Meaning |
|---|---|---|
| `CASTAWAY_REGION` | `finnmark_east` | Region preset (`finnmark_east`, `vestland`, `lofoten`) |
| `CASTAWAY_PARTICLES_PER_NET` | 200 | Particles per lost item |
| `CASTAWAY_SEED_RADIUS_M` | 500 | Seeding radius around the reported position |
| `WIND_DRIFT_FACTORS` | 0, 0.01, 0.02, 0.03 | Windage ensemble; each net's particles are split evenly across these |
| `CASTAWAY_HINDCAST_DAYS` | 7 | How far back drift is simulated (cap) |
| `CASTAWAY_FORECAST_DAYS` | 3 | Forecast horizon |
| `CASTAWAY_MAX_NET_AGE_DAYS` | 365 | Ignore reports older than this |
| `CASTAWAY_SPINUP_HOURS` | 24 | Discard strandings in the first hours of the window (see limitations) |
| `CASTAWAY_NETS_PER_RUN` | 25 | Nets per OpenDrift run (batch) |
| `CASTAWAY_CELL_SIZE_KM` | 1.0 | Coast cell size |
| `CASTAWAY_BEACHING_WINDOW_DAYS` | 7 | Each date shows strandings in the N days up to it |
| `CASTAWAY_DRIFT_CELL_KM` | 2.0 | Grid size of the drift-likelihood heat map |
| `CASTAWAY_USE_MEPS_FORECAST_WIND` | false | Use MEPS 2.5 km wind for the forecast period |
| `GEAR_FLOAT_PROB` | seine 0.8, generic 0.5, nets 0.3, long line 0.2, sensor/cable 0.1, pots 0.05 | Probability that gear floats; used as a particle weight |
| `CASTAWAY_NOW` | current hour | Fix the run time for reproducible runs |

### Default region

The default is **East Finnmark** (lon 25.0–31.5°E, lat 69.6–71.3°N). The real data put it there: most recent lost-gear reports are in Finnmark (the king-crab fishery), while Vestland and Lofoten have only a handful.

## How the forecast is computed

1. **Lost gear.** CastAway fetches unrecovered gear from BarentsWatch, keeping only `id, lon, lat, lost_time, gear_type`. It drops invalid positions, items outside the bbox and reports older than `MAX_NET_AGE_DAYS`.
2. **Forcing.** MET Norway's NorKyst v3 (800 m) provides surface currents plus its atmospheric wind. A regional subset is downloaded from thredds.met.no and cached one file per day.
3. **Drift.** OpenDrift `OceanDrift` with `coastline_action = stranding`:
   - Each item gets `PARTICLES_PER_NET` particles within `SEED_RADIUS_M` of its position, split across the wind-drift factors.
   - Particles are seeded at `max(lost_time, now − HINDCAST_DAYS)` and run to `now + FORECAST_DAYS`.
   - Time step 15 min, output every hour, horizontal diffusivity 10 m²/s.
4. **Beaching.** Each stranded particle contributes `float_prob(gear) / particles_per_net` expected nets to its ~1 km cell. For a selected date, a cell's `expected_nets` is the sum over strandings in the **7 UTC days up to and including that date** (`BEACHING_WINDOW_DAYS`).
5. **Drift paths.** Selecting an item, or a coast cell, draws a sample of its particles' own trajectories up to the selected date, like OpenDrift's spaghetti plots.
   - Lines are coloured by windage (0–3%, how hard the wind pushes the net), light to dark violet. That ensemble is the main source of spread.
   - An orange dot marks where a particle washed ashore.
   - The map zooms to the paths when the selection changes.
6. **Drift likelihood (optional heat map layer).**
   - For each item, the particle positions are counted per hour on a 2 km grid. The result shows where the item is likely to have been at any moment up to the selected date.
   - When several items are selected (e.g. all items behind one coast cell), each item's distribution is weighted by its float probability and the distributions are summed.
   - The map shows this relative likelihood as a single-hue violet heat map.
7. **Map.**
   - Cells are coloured on a single-hue orange scale with log-spaced class breaks, because the values are very skewed.
   - When zoomed out, cells are drawn as dots so they stay visible; from zoom 11 they are drawn as true 1 km squares.

## Known limitations and shortcuts

- **Most lost gear sinks.** Pots and long lines usually stay on the bottom, and the float probabilities are rough guesses. Treat `expected_nets` as a relative risk index, not a count.
- **Unreported losses** are invisible to the model.
- **Uncertainty grows with drift time**, and the forecast horizon is about 3 days, limited by NorKyst's forecast length.
- **Hindcast cap.** Items lost before `now − HINDCAST_DAYS` are seeded at their *reported* position at the start of the window. This assumes they stayed near where they were lost. Downloading more history is slow (see Runtime).
- **Spin-up.** Because those items are all released at once at their (often near-shore) positions, about 60% of all strandings happen in the first 24 h. That is an artefact of seeding, not a real arrival peak, so strandings in the first `SPINUP_HOURS` are discarded and the date slider starts on the first full day after spin-up.
- **Anonymised data (no credentials).** The public OLEX download has no "removed" flag, so it may include gear that has since been recovered. Records without a `ToolId` get a synthetic id, and lines are seeded at their centroid.
- **The authenticated `notremoved` parser** is written from the OpenAPI schema. Re-check it against a real response (`scripts/fetch_gear.py --inspect`) once credentials exist.
- **Wind.** NorKyst's own atmospheric forcing (MEPS-derived) is used for both hindcast and forecast, fetched at a 3-hourly stride to keep downloads manageable. MEPS 2.5 km wind is optional.
- **Coast cells** are a regular lon/lat grid; only cells that receive strandings are shown, so they follow the coastline. The coastline is OpenDrift's GSHHG landmask, which misses small skerries and fine fjord detail.
- **Days are UTC days.**
- **Drift heat map:** cells are 2 km, so cells on the shoreline can overlap land. Likelihood is relative (the top cell = 1), not an absolute probability. The older centroid track endpoint (`/api/net/{id}/track`) is still served but no longer drawn.
- **Not built** (out of scope): user accounts, reporting found nets, notifications, deployment. `api.py` marks an extension point for a `found_reports` layer.

## Licences and attribution

**CastAway** is licensed under the **GNU General Public License v2.0 or later** (`GPL-2.0-or-later`); see [LICENSE](LICENSE). It is GPL because the backend builds on OpenDrift (GPL v2). Third-party data keeps its own licence:

- **Data:** BarentsWatch (lost fishing gear) and MET Norway (NorKyst, MEPS) are available under NLOD / CC BY 4.0, which requires attribution. The map always shows **"Data: BarentsWatch, MET Norway. Drift model: OpenDrift."**
- **OpenDrift** is GPL v2. It runs only server-side to produce the forecast files and is not distributed with the frontend.
- **Map tiles** are © OpenStreetMap contributors (ODbL).
