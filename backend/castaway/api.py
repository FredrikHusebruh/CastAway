"""FastAPI app serving the precomputed forecast files in data/output/ (it never runs the model).

Run from backend/: python -m uvicorn castaway.api:app --reload --port 8000
"""

from __future__ import annotations

import json
import os
import re
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from castaway import config
from castaway.aggregate import cells_geojson, combine_drift, item_window_cells, trim_paths

GEOJSON = "application/geo+json"
NET_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")

app = FastAPI(title="CastAway", description="Where will lost fishing gear wash ashore?")
# Output files keep the same names across runs (e.g. beaching_<date>.geojson), so browsers must not reuse a
# cached copy without asking. The files are small, so re-sending them is cheap.
@app.middleware("http")
async def no_stale_cache(request: Request, call_next: Any) -> Response:
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CASTAWAY_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _require(path: Path) -> Path:
    if not path.exists():
        raise HTTPException(404, f"{path.name} not found - run scripts/run_forecast.py first")
    return path


def _index() -> dict[str, Any]:
    return json.loads(_require(config.OUTPUT_DIR / "index.json").read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict[str, str]:
    """Liveness check for deploys and monitoring (works before the first forecast exists)."""
    return {"status": "ok"}


@app.get("/api/dates")
def dates() -> dict[str, Any]:
    """Available dates plus run metadata (bbox, forecast start, attribution)."""
    return _index()


@app.get("/api/gear")
def gear() -> FileResponse:
    return FileResponse(_require(config.OUTPUT_DIR / "lost_gear.geojson"), media_type=GEOJSON)


@app.get("/api/coast")
def coast() -> FileResponse:
    """Coast cells of the region (the app checks that found-gear reports are near the coast)."""
    return FileResponse(_require(config.OUTPUT_DIR / "coast.json"), media_type="application/json")


@app.get("/api/beaching")
def beaching(date_: Annotated[date, Query(alias="date")]) -> FileResponse:
    return FileResponse(_require(config.OUTPUT_DIR / f"beaching_{date_.isoformat()}.geojson"), media_type=GEOJSON)


@app.get("/api/net/{net_id}/track")
def net_track(net_id: str, date_: Annotated[date | None, Query(alias="date")] = None) -> dict[str, Any]:
    """Hourly centroid track of one net, up to the end of ``date`` (UTC) if given."""
    if not NET_ID.match(net_id):
        raise HTTPException(400, "invalid net id")
    track = json.loads(_require(config.TRACKS_DIR / f"{net_id}.json").read_text(encoding="utf-8"))
    if date_ is not None:
        until = datetime.combine(date_ + timedelta(days=1), time(), tzinfo=UTC)
        track = [p for p in track if datetime.fromisoformat(p["time"]) < until]
    return {"id": net_id, "track": track}


@app.get("/api/drift")
def drift(
    ids: Annotated[str, Query(description="comma-separated net ids")],
    date_: Annotated[date | None, Query(alias="date")] = None,
) -> dict[str, Any]:
    """Relative likelihood of where the given nets have floated, up to the end of ``date`` (heat-map cells)."""
    net_ids = _net_ids(ids)
    nets = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in (config.DRIFT_DIR / f"{i}.json" for i in net_ids)
        if path.exists()
    ]
    cell_deg = tuple(_index()["drift_cell_deg"])
    until = date_.isoformat() if date_ else None
    return {"ids": net_ids, "cell_deg": cell_deg, "cells": combine_drift(nets, until, cell_deg)}


@app.get("/api/net/{net_id}/beaching")
def net_beaching(net_id: str, date_: Annotated[date, Query(alias="date")]) -> dict[str, Any]:
    """Where ONE item is likely to wash ashore in the beaching window up to ``date``.

    Cell ``expected_nets`` is the item's total chance of stranding there (float probability included);
    ``chance_total`` is the chance it strands anywhere in the window.
    """
    if not NET_ID.match(net_id):
        raise HTTPException(400, "invalid net id")
    item = json.loads(_require(config.STRANDINGS_DIR / f"{net_id}.json").read_text(encoding="utf-8"))
    index = _index()
    lat0 = (index["bbox"][1] + index["bbox"][3]) / 2
    window = index.get("beaching_window_days", config.BEACHING_WINDOW_DAYS)
    cells = item_window_cells(item, lat0, date_.isoformat(), window)
    fc = cells_geojson(cells, lat0)
    return {
        **fc,
        "id": net_id,
        "float_prob": item["float_prob"],
        "chance_total": round(float(cells["expected_nets"].sum()), 5) if not cells.empty else 0.0,
    }


def _net_ids(ids: str) -> list[str]:
    net_ids = [i for i in ids.split(",") if i][: config.MAX_DRIFT_NETS]
    if not net_ids or not all(NET_ID.match(i) for i in net_ids):
        raise HTTPException(400, "invalid net ids")
    return net_ids


@app.get("/api/paths")
def paths(
    ids: Annotated[str, Query(description="comma-separated net ids")],
    date_: Annotated[date | None, Query(alias="date")] = None,
) -> dict[str, Any]:
    """Individual particle trajectories of the given nets up to the end of ``date`` (spaghetti view).

    Fewer particles and coarser time steps are returned as more nets are selected, to keep the payload small.
    """
    net_ids = _net_ids(ids)
    nets = {
        i: json.loads(path.read_text(encoding="utf-8"))
        for i, path in ((i, config.PATHS_DIR / f"{i}.json") for i in net_ids)
        if path.exists()
    }
    # step is in output steps (15 min): full detail for a few nets, hourly / 2-hourly when many are selected
    per_factor, step = (6, 1) if len(net_ids) <= 3 else (4, 4) if len(net_ids) <= 10 else (2, 8)
    until = date_.isoformat() if date_ else None
    return {"ids": net_ids, "paths": trim_paths(nets, until, per_factor, step)}


# Found-gear reports, points and the leaderboard live only on the user's device (mobile/src/game/);
# a shared GET/POST /api/found would be the extension point for a server-side version.
