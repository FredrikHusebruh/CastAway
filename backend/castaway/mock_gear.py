"""Synthetic lost-gear reports for demos: random loss time, gear type and a sea position near the coast.

Output has the same columns as the real normalised table (barentswatch.GEAR_COLUMNS), so the rest
of the pipeline cannot tell the difference; index.json marks the run as gear_source="mock".
"""

from __future__ import annotations

import math
from datetime import datetime
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd

from castaway import config

# Rough demo mix: mostly gear that can actually float.
DEFAULT_GEAR_MIX: dict[str, float] = {
    "nets": 0.35,
    "longline": 0.2,
    "crab_pot": 0.2,
    "generic": 0.1,
    "seine": 0.05,
    "sensor_cable": 0.05,
    "fish_pot": 0.05,
}
KM_PER_DEG_LAT = 111.32
_RING_DIRECTIONS = 12


@lru_cache(maxsize=1)
def _landmask() -> Any:
    from roaring_landmask import RoaringLandmask  # installed with OpenDrift; same mask it strands against

    return RoaringLandmask.new()


def _is_land(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    return np.asarray(_landmask().contains_many(np.asarray(lon, float), np.asarray(lat, float)))


def _near_land(lon: float, lat: float, km: float) -> bool:
    """True if any point on rings at km/2 and km around (lon, lat) is on land."""
    angles = np.linspace(0, 2 * math.pi, _RING_DIRECTIONS, endpoint=False)
    radii = np.repeat([km / 2, km], _RING_DIRECTIONS)
    angles = np.tile(angles, 2)
    dlat = radii * np.sin(angles) / KM_PER_DEG_LAT
    dlon = radii * np.cos(angles) / (KM_PER_DEG_LAT * math.cos(math.radians(lat)))
    return bool(_is_land(lon + dlon, lat + dlat).any())


def random_sea_positions(
    n: int, bbox: config.BBox, rng: np.random.Generator, near_coast_km: float, max_tries: int = 200_000
) -> list[tuple[float, float]]:
    """Uniform positions inside ``bbox`` that are at sea and within ``near_coast_km`` of land."""
    points: list[tuple[float, float]] = []
    for _ in range(max_tries):
        if len(points) == n:
            return points
        lon, lat = rng.uniform(bbox.west, bbox.east), rng.uniform(bbox.south, bbox.north)
        if not _is_land(np.array([lon]), np.array([lat]))[0] and _near_land(lon, lat, near_coast_km):
            points.append((round(lon, 5), round(lat, 5)))
    raise RuntimeError(f"found only {len(points)} of {n} sea positions near the coast in {bbox}")


def make_mock_gear(
    n: int,
    bbox: config.BBox,
    start: datetime,
    end: datetime,
    seed: int = 42,
    near_coast_km: float = 10.0,
    gear_mix: dict[str, float] = DEFAULT_GEAR_MIX,
) -> pd.DataFrame:
    """``n`` synthetic reports lost uniformly between ``start`` and ``end`` (aware UTC)."""
    rng = np.random.default_rng(seed)
    positions = random_sea_positions(n, bbox, rng, near_coast_km)
    span_s = (end - start).total_seconds()
    lost = [pd.Timestamp(start) + pd.Timedelta(seconds=float(s)) for s in rng.uniform(0, span_s, n)]
    types = list(gear_mix)
    weights = np.array([gear_mix[t] for t in types]) / sum(gear_mix.values())
    gear_types = rng.choice(types, size=n, p=weights)
    df = pd.DataFrame(
        {
            "id": [f"mock-{k:04d}" for k in range(n)],
            "lon": [p[0] for p in positions],
            "lat": [p[1] for p in positions],
            "lost_time": [t.floor("min") for t in lost],
            "gear_type": gear_types,
        }
    )
    df["float_prob"] = df["gear_type"].map(config.GEAR_FLOAT_PROB)
    return df.sort_values("lost_time").reset_index(drop=True)
