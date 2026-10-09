"""Download and cache a regional NorKyst v3 surface subset (currents + wind), one file per UTC day.

THREDDS costs ~1 s per variable per time step regardless of area, so reading it remotely
from OpenDrift would be slow on every run. Instead we fetch each day once (sequentially, as
THREDDS asks), and keep past days forever. Days touching the forecast are refreshed when stale.
Currents and wind go to separate files because wind is fetched at a coarser time stride.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pyproj
import xarray as xr

from castaway import config

log = logging.getLogger(__name__)

_PACKED = {"dtype": "int16", "scale_factor": 0.001, "_FillValue": -32767, "zlib": True, "complevel": 4}


@dataclass(frozen=True)
class ForcingFiles:
    currents: list[Path]
    wind: list[Path]


def open_remote() -> xr.Dataset:
    return xr.open_dataset(config.NORKYST_URL)


def grid_window(ds: xr.Dataset, bbox: config.BBox) -> dict[str, slice]:
    """X/Y index slices of the NorKyst grid covering ``bbox`` (edges sampled: the grid is stereographic)."""
    crs = pyproj.CRS.from_proj4(ds["projection_stere"].attrs["proj4"])
    to_grid = pyproj.Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    lon_grid, lat_grid = np.meshgrid(np.linspace(bbox.west, bbox.east, 50), np.linspace(bbox.south, bbox.north, 50))
    x, y = to_grid.transform(lon_grid.ravel(), lat_grid.ravel())
    return {"X": _index_slice(ds["X"].values, x), "Y": _index_slice(ds["Y"].values, y)}


def _index_slice(axis: np.ndarray, values: np.ndarray, pad: int = 2) -> slice:
    lo = max(int(np.searchsorted(axis, values.min())) - pad, 0)
    hi = min(int(np.searchsorted(axis, values.max())) + pad, len(axis))
    return slice(lo, hi)


def day_path(kind: str, region: str, day: date) -> Path:
    return config.FORCING_DIR / f"norkyst_{kind}_{region}_{day:%Y%m%d}.nc"


def needs_download(path: Path, day: date) -> bool:
    """Missing files, or files written before the day was final (forecast data) and now stale."""
    if not path.exists():
        return True
    written = datetime.fromtimestamp(path.stat().st_mtime, UTC)
    day_end = datetime(day.year, day.month, day.day, tzinfo=UTC) + timedelta(days=1)
    if written >= day_end + timedelta(hours=12):
        return False  # written well after the day ended: best-estimate data, keep forever
    age_h = (datetime.now(UTC) - written).total_seconds() / 3600
    return age_h > config.FORECAST_FORCING_MAX_AGE_HOURS


def _subset(ds: xr.Dataset, names: tuple[str, ...], win: dict[str, slice], day: date, stride_h: int) -> xr.Dataset:
    t0 = np.datetime64(day.isoformat())
    t1 = t0 + np.timedelta64(1, "D") - np.timedelta64(1, "s")
    sub = ds[list(names)].isel(**win).sel(time=slice(t0, t1))
    if "depth" in sub.dims:
        sub = sub.isel(depth=0)
    sub = sub.isel(time=slice(None, None, stride_h))
    sub = sub.drop_vars([v for v in ("depth", "forecast_reference_time") if v in sub.variables])
    sub["projection_stere"] = ds["projection_stere"]
    for coord in ("lon", "lat"):
        if coord not in sub.variables:
            sub = sub.assign_coords({coord: ds[coord].isel(**win)})
    return sub.load()


def _download_day(ds: xr.Dataset, win: dict[str, slice], kind: str, region: str, day: date) -> Path | None:
    names, stride = (
        (config.NORKYST_CURRENT_VARS, 1) if kind == "currents" else (config.NORKYST_WIND_VARS, config.WIND_STRIDE_HOURS)
    )
    t = time.perf_counter()
    sub = _subset(ds, names, win, day, stride)
    if sub.sizes.get("time", 0) == 0:
        log.info("no %s data for %s (beyond NorKyst range)", kind, day)
        return None
    path = day_path(kind, region, day)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.nc")
    sub.to_netcdf(tmp, encoding={n: _PACKED for n in names})
    tmp.replace(path)
    log.info("%s %s: %d steps in %.0fs", kind, day, sub.sizes["time"], time.perf_counter() - t)
    return path


def ensure_forcing(region: str, bbox: config.BBox, start: datetime, end: datetime) -> ForcingFiles:
    """Make sure daily currents + wind files exist for [start, end]; download missing/stale days."""
    padded = bbox.padded(config.FORCING_MARGIN_DEG)
    days = [start.date() + timedelta(days=i) for i in range((end.date() - start.date()).days + 1)]
    ds: xr.Dataset | None = None
    win: dict[str, slice] = {}
    files: dict[str, list[Path]] = {"currents": [], "wind": []}
    for day in days:
        for kind in ("currents", "wind"):
            path = day_path(kind, region, day)
            if needs_download(path, day):
                if ds is None:
                    ds = open_remote()
                    win = grid_window(ds, padded)
                    log.info("NorKyst window X=%s Y=%s", win["X"], win["Y"])
                path = _download_day(ds, win, kind, region, day)
            if path is not None:
                files[kind].append(path)
    if ds is not None:
        ds.close()
    return ForcingFiles(currents=files["currents"], wind=files["wind"])
