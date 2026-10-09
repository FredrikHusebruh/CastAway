"""Stranded particles -> ~1 km coast cells per day -> GeoJSON files for the API.

Cells are a regular lon/lat grid (sized for CELL_SIZE_KM at the region's centre latitude).
Only cells that receive strandings are written, so they trace the coastline by construction.
"""

from __future__ import annotations

import json
import logging
import math
import warnings
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import xarray as xr

from castaway import config

log = logging.getLogger(__name__)

STRANDING_COLUMNS = ["net_id", "lon", "lat", "time", "weight"]
KM_PER_DEG_LAT = 111.32


# --- Reading OpenDrift output ---------------------------------------------------------
def _flag_code(status: xr.DataArray, name: str) -> int:
    meanings = str(status.attrs["flag_meanings"]).split()
    return int(np.asarray(status.attrs["flag_values"])[meanings.index(name)])


def _trajectory_net_ids(sidecar: dict[str, Any], n_traj: int) -> tuple[np.ndarray, np.ndarray]:
    """Per-trajectory net id and particle weight from the batch sidecar."""
    ids = np.empty(n_traj, dtype=object)
    weights = np.zeros(n_traj)
    for net in sidecar["nets"]:
        sl = slice(net["first"], net["first"] + net["count"])
        ids[sl] = net["id"]
        weights[sl] = net["weight"]
    return ids, weights


def _last_valid_index(lon: np.ndarray) -> np.ndarray:
    """Index of the last non-NaN output step per trajectory (-1 if never valid)."""
    valid = ~np.isnan(lon)
    last = lon.shape[1] - 1 - np.argmax(valid[:, ::-1], axis=1)
    return np.where(valid.any(axis=1), last, -1)


def load_batch(nc_path: Path) -> tuple[xr.Dataset, dict[str, Any]]:
    sidecar = json.loads(nc_path.with_suffix(".json").read_text(encoding="utf-8"))
    return xr.open_dataset(nc_path), sidecar


def batch_strandings(nc_path: Path) -> pd.DataFrame:
    """Every stranded particle in one batch: net id, position, stranding time and weight."""
    ds, sidecar = load_batch(nc_path)
    with ds:
        lon = ds["lon"].values.astype(float)
        lat = ds["lat"].values.astype(float)
        status = ds["status"].values
        times = pd.to_datetime(ds["time"].values, utc=True)
        code = _flag_code(ds["status"], "stranded")
    ids, weights = _trajectory_net_ids(sidecar, lon.shape[0])
    last = _last_valid_index(lon)
    rows = np.arange(lon.shape[0])
    ok = last >= 0
    stranded = np.zeros_like(ok)
    stranded[ok] = status[rows[ok], last[ok]] == code
    r, t = rows[stranded], last[stranded]
    return pd.DataFrame(
        {"net_id": ids[r], "lon": lon[r, t], "lat": lat[r, t], "time": times[t], "weight": weights[r]},
        columns=STRANDING_COLUMNS,
    )


def load_strandings(run_dir: Path) -> pd.DataFrame:
    frames = [batch_strandings(p) for p in sorted(run_dir.glob("batch_*.nc"))]
    if not frames:
        return pd.DataFrame(columns=STRANDING_COLUMNS)
    return pd.concat(frames, ignore_index=True)


# --- Cells -----------------------------------------------------------------------
def cell_size_deg(lat0: float, km: float | None = None) -> tuple[float, float]:
    dlat = (km or config.CELL_SIZE_KM) / KM_PER_DEG_LAT
    return dlat / math.cos(math.radians(lat0)), dlat


def assign_cells(strandings: pd.DataFrame, lat0: float) -> pd.DataFrame:
    dlon, dlat = cell_size_deg(lat0)
    out = strandings.copy()
    out["i"] = np.floor(out["lon"] / dlon).astype(int)
    out["j"] = np.floor(out["lat"] / dlat).astype(int)
    out["cell_id"] = out["i"].astype(str) + "_" + out["j"].astype(str)
    out["date"] = out["time"].dt.strftime("%Y-%m-%d")
    return out


def rolling_cells(strandings: pd.DataFrame, lat0: float, dates: list[str], window_days: int) -> pd.DataFrame:
    """Per (date, cell) over the ``window_days`` UTC days ending on each date (inclusive):
    expected_nets (sum of weights), particle_count, contributing_net_ids."""
    cols = ["date", "cell_id", "i", "j", "expected_nets", "particle_count", "contributing_net_ids"]
    if strandings.empty:
        return pd.DataFrame(columns=cols)
    cells = assign_cells(strandings, lat0)
    frames = []
    for day in dates:
        first = (date.fromisoformat(day) - timedelta(days=window_days - 1)).isoformat()
        sel = cells[(cells["date"] >= first) & (cells["date"] <= day)]
        if sel.empty:
            continue
        grouped = sel.groupby(["cell_id", "i", "j"], as_index=False).agg(
            expected_nets=("weight", "sum"),
            particle_count=("weight", "size"),
            contributing_net_ids=("net_id", lambda s: sorted(set(s))),
        )
        frames.append(grouped.assign(date=day))
    if not frames:
        return pd.DataFrame(columns=cols)
    out = pd.concat(frames, ignore_index=True)
    return out.sort_values(["date", "expected_nets"], ascending=[True, False])[cols].reset_index(drop=True)


def color_breaks(values: pd.Series, n_classes: int = config.COLOR_CLASSES) -> list[float]:
    """Legend class breaks: log-spaced between the smallest and largest non-zero value (1 significant digit).

    Values are strongly right-skewed (most cells hold one or two particles), so quantile
    breaks collapse onto the single-particle weights of each gear type.
    """
    nonzero = values[values > 0].astype(float)
    if nonzero.empty or nonzero.min() == nonzero.max():
        return []
    lo, hi = float(nonzero.min()), float(nonzero.max())
    inner = np.geomspace(lo, hi, n_classes + 1)[1:-1]
    return sorted({b for b in (float(f"{x:.1g}") for x in inner) if lo < b < hi})


def cell_polygon(i: int, j: int, lat0: float) -> list[list[float]]:
    dlon, dlat = cell_size_deg(lat0)
    w, s = i * dlon, j * dlat
    return [[w, s], [w + dlon, s], [w + dlon, s + dlat], [w, s + dlat], [w, s]]


# --- GeoJSON writers -------------------------------------------------------------------
def _feature_collection(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}


def cells_geojson(day_cells: pd.DataFrame, lat0: float) -> dict[str, Any]:
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [cell_polygon(c.i, c.j, lat0)]},
            "properties": {
                "cell_id": c.cell_id,
                "expected_nets": round(float(c.expected_nets), 4),
                "particle_count": int(c.particle_count),
                "n_nets": len(c.contributing_net_ids),
                "contributing_net_ids": list(c.contributing_net_ids),
            },
        }
        for c in day_cells.itertuples()
    ]
    return _feature_collection(features)


def gear_geojson(gear: pd.DataFrame) -> dict[str, Any]:
    """Lost gear points. Only PII-free columns are written."""
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(g.lon, 5), round(g.lat, 5)]},
            "properties": {
                "id": g.id,
                "lost_time": g.lost_time.isoformat(),
                "gear_type": g.gear_type,
                "float_prob": g.float_prob,
            },
        }
        for g in gear.itertuples()
    ]
    return _feature_collection(features)


def net_tracks(run_dir: Path) -> dict[str, list[dict[str, Any]]]:
    """Hourly centroid of each net's particles that are still in the water or just stranded."""
    tracks: dict[str, list[dict[str, Any]]] = {}
    for nc_path in sorted(run_dir.glob("batch_*.nc")):
        ds, sidecar = load_batch(nc_path)
        with ds:
            lon = ds["lon"].values.astype(float)
            lat = ds["lat"].values.astype(float)
            times = pd.to_datetime(ds["time"].values, utc=True)
        for net in sidecar["nets"]:
            sl = slice(net["first"], net["first"] + net["count"])
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN hours
                clon, clat = np.nanmean(lon[sl], axis=0), np.nanmean(lat[sl], axis=0)
            tracks[net["id"]] = [
                {"time": t.isoformat(), "lon": round(float(x), 5), "lat": round(float(y), 5)}
                for t, x, y in zip(times, clon, clat, strict=True)
                if not np.isnan(x)
            ]
    return tracks


def drift_density(run_dir: Path, lat0: float) -> dict[str, dict[str, Any]]:
    """Per net: particle-hours in each DRIFT_CELL_KM cell, per UTC day -> {"weight", "days": {day: [[i, j, n]]}}."""
    dlon, dlat = cell_size_deg(lat0, config.DRIFT_CELL_KM)
    out: dict[str, dict[str, Any]] = {}
    for nc_path in sorted(run_dir.glob("batch_*.nc")):
        ds, sidecar = load_batch(nc_path)
        with ds:
            lon = ds["lon"].values.astype(float)
            lat = ds["lat"].values.astype(float)
            days = pd.to_datetime(ds["time"].values, utc=True).strftime("%Y-%m-%d").to_numpy()
        for net in sidecar["nets"]:
            sl = slice(net["first"], net["first"] + net["count"])
            nlon, nlat = lon[sl], lat[sl]
            ok = ~np.isnan(nlon)
            frame = pd.DataFrame(
                {
                    "day": np.broadcast_to(days, nlon.shape)[ok],
                    "i": np.floor(nlon[ok] / dlon).astype(int),
                    "j": np.floor(nlat[ok] / dlat).astype(int),
                }
            )
            counts = frame.groupby(["day", "i", "j"]).size()
            out[net["id"]] = {
                "weight": net["weight"] * net["count"],  # = float_prob of the net
                "days": {
                    day: [[int(i), int(j), int(n)] for (i, j), n in grp.droplevel("day").items()]
                    for day, grp in counts.groupby(level="day")
                },
            }
    return out


def particle_paths(run_dir: Path) -> dict[str, dict[str, Any]]:
    """Per net: a sample of individual particle trajectories (hourly), for the spaghetti view.

    {"start": iso time of output step 0, "particles": [{"wdf", "first", "stranded", "coords": [[lon, lat]]}]}
    ``first`` is the output step of the first position; ``stranded`` means the particle's final status.
    """
    out: dict[str, dict[str, Any]] = {}
    for nc_path in sorted(run_dir.glob("batch_*.nc")):
        ds, sidecar = load_batch(nc_path)
        with ds:
            lon = ds["lon"].values.astype(float)
            lat = ds["lat"].values.astype(float)
            status = ds["status"].values
            wdf = ds["wind_drift_factor"].values.astype(float)
            start = pd.Timestamp(ds["time"].values[0], tz="UTC").isoformat()
            code = _flag_code(ds["status"], "stranded")
        last = _last_valid_index(lon)
        for net in sidecar["nets"]:
            particles = []
            taken: dict[float, int] = {}
            for t in range(net["first"], net["first"] + net["count"]):
                valid = np.flatnonzero(~np.isnan(lon[t]))
                if valid.size == 0:
                    continue
                factor = round(float(np.nanmax(wdf[t]) if wdf.ndim == 2 else wdf[t]), 3)
                if taken.get(factor, 0) >= config.PATH_PARTICLES_PER_FACTOR:
                    continue
                taken[factor] = taken.get(factor, 0) + 1
                first, end = int(valid[0]), int(last[t])
                particles.append(
                    {
                        "wdf": factor,
                        "first": first,
                        "stranded": bool(status[t, end] == code),
                        "coords": [
                            [round(float(x), 4), round(float(y), 4)]
                            for x, y in zip(lon[t, first : end + 1], lat[t, first : end + 1], strict=True)
                        ],
                    }
                )
            out[net["id"]] = {"start": start, "particles": particles}
    return out


def trim_paths(nets: dict[str, dict[str, Any]], until: str | None, per_factor: int, step: int) -> list[dict[str, Any]]:
    """Particle paths up to the end of ``until`` (UTC date), thinned for display.

    Returns [{"id", "wdf", "stranded", "coords": [[lat, lon]]}].

    ``stranded`` is true only if the particle had stranded by then; coords are subsampled every ``step`` hours
    (the last position is always kept).
    """
    out = []
    for net_id, net in nets.items():
        start = pd.Timestamp(net["start"])
        limit = (
            None
            if until is None
            else int((pd.Timestamp(until, tz="UTC") + pd.Timedelta(days=1) - start) / pd.Timedelta(hours=1)) - 1
        )
        taken: dict[float, int] = {}
        for p in net["particles"]:
            if taken.get(p["wdf"], 0) >= per_factor:
                continue
            taken[p["wdf"]] = taken.get(p["wdf"], 0) + 1
            n_until = len(p["coords"]) if limit is None else limit - p["first"] + 1
            coords = p["coords"][: max(n_until, 0)]
            if len(coords) < 2:
                continue
            thinned = coords[::step] + ([coords[-1]] if (len(coords) - 1) % step else [])
            out.append(
                {
                    "id": net_id,
                    "wdf": p["wdf"],
                    "stranded": p["stranded"] and len(coords) == len(p["coords"]),
                    "coords": [[y, x] for x, y in thinned],
                }
            )
    return out


def combine_drift(nets: list[dict[str, Any]], until: str | None, cell_deg: tuple[float, float]) -> list[list[float]]:
    """Relative drift likelihood [[lat, lon, v]] (cell centres, v in (0, 1]) for one or more nets.

    Each net's particle-hours up to ``until`` (inclusive) become a distribution over cells
    (where it is likely to be at a random moment), weighted by its float probability, summed
    over nets and scaled so the most likely cell is 1.
    """
    dlon, dlat = cell_deg
    acc: dict[tuple[int, int], float] = {}
    for net in nets:
        cells = [c for day, cs in net["days"].items() if until is None or day <= until for c in cs]
        total = sum(c[2] for c in cells)
        for i, j, n in cells:
            acc[(i, j)] = acc.get((i, j), 0.0) + net["weight"] * n / total
    if not acc:
        return []
    top = max(acc.values())
    return sorted(
        ([round((j + 0.5) * dlat, 5), round((i + 0.5) * dlon, 5), round(v / top, 4)] for (i, j), v in acc.items()),
        key=lambda c: c[2],
    )


def _dates(window: config.Window) -> list[str]:
    first, last = window.first_day.date(), window.end.date()
    return [(first + timedelta(days=k)).isoformat() for k in range((last - first).days + 1)]


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")


def write_outputs(
    gear: pd.DataFrame,
    run_dir: Path,
    window: config.Window,
    region: str,
    source: str,
) -> dict[str, Any]:
    """Write lost_gear.geojson, beaching_<date>.geojson, tracks/<id>.json, drift/<id>.json and index.json."""
    out = config.OUTPUT_DIR
    bbox = config.region_bbox(region)
    lat0 = bbox.center[1]
    for old in [
        *out.glob("beaching_*.geojson"),
        *config.TRACKS_DIR.glob("*.json"),
        *config.DRIFT_DIR.glob("*.json"),
        *config.PATHS_DIR.glob("*.json"),
    ]:
        old.unlink()

    _write_json(out / "lost_gear.geojson", gear_geojson(gear))
    all_strandings = load_strandings(run_dir)
    strandings = all_strandings[all_strandings["time"] >= window.first_day]
    log.info("discarded %d spin-up strandings before %s", len(all_strandings) - len(strandings), window.first_day)
    dates = _dates(window)
    cells = rolling_cells(strandings, lat0, dates, config.BEACHING_WINDOW_DAYS)
    totals: dict[str, float] = {}
    for day in dates:
        day_cells = cells[cells["date"] == day]
        totals[day] = round(float(day_cells["expected_nets"].sum()), 3)
        _write_json(out / f"beaching_{day}.geojson", cells_geojson(day_cells, lat0))
    for net_id, track in net_tracks(run_dir).items():
        _write_json(config.TRACKS_DIR / f"{net_id}.json", track)
    for net_id, density in drift_density(run_dir, lat0).items():
        _write_json(config.DRIFT_DIR / f"{net_id}.json", density)
    for net_id, paths in particle_paths(run_dir).items():
        _write_json(config.PATHS_DIR / f"{net_id}.json", paths)

    index = {
        "region": region,
        "bbox": bbox.as_list(),
        "dates": dates,
        "expected_nets_per_date": totals,
        "beaching_window_days": config.BEACHING_WINDOW_DAYS,
        "drift_cell_km": config.DRIFT_CELL_KM,
        "wind_drift_factors": list(config.WIND_DRIFT_FACTORS),
        "drift_cell_deg": list(cell_size_deg(lat0, config.DRIFT_CELL_KM)),
        "window_start": window.start.isoformat(),
        "spinup_hours": config.SPINUP_HOURS,
        "forecast_start": window.forecast_start.isoformat(),
        "forecast_end": window.end.isoformat(),
        "run_timestamp": datetime.now(UTC).isoformat(timespec="seconds"),
        "n_nets": int(len(gear)),
        "n_stranded_particles": int(len(strandings)),
        "particles_per_net": config.PARTICLES_PER_NET,
        "cell_size_km": config.CELL_SIZE_KM,
        "color_breaks": color_breaks(cells["expected_nets"]),
        "gear_source": source,
        "attribution": config.ATTRIBUTION,
    }
    _write_json(out / "index.json", index)
    log.info("wrote %d dates, %d stranded particles, %d cells", len(dates), len(strandings), len(cells))
    return index
