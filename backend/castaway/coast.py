"""Coastline grid for the app's report checks: which ~1 km cells of the region contain coast.

Uses OpenDrift's own landmask (roaring_landmask, GSHHG full resolution), so "coast" here is the same coast the
particles strand on. Cells are on the beaching grid (aggregate.cell_size_deg at the region's centre latitude):
cell (i, j) covers lon [i*dlon, (i+1)*dlon) and lat [j*dlat, (j+1)*dlat).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from castaway import config


def land_mask(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """True where a point is on land."""
    from roaring_landmask import RoaringLandmask

    flat = RoaringLandmask.new().contains_many(lon.ravel().astype(float), lat.ravel().astype(float))
    return np.asarray(flat, dtype=bool).reshape(lon.shape)


def coast_cells(bbox: config.BBox, cell_deg: tuple[float, float]) -> dict[str, Any]:
    """Cells holding both land and sea samples, over the bbox plus COAST_PAD_DEG.

    Returns ``{"cell_deg": [dlon, dlat], "bbox": [w, s, e, n] (padded), "cells": [[i, j], ...]}``.
    """
    dlon, dlat = cell_deg
    bbox = bbox.padded(config.COAST_PAD_DEG)
    i = np.arange(math.floor(bbox.west / dlon), math.floor(bbox.east / dlon) + 1)
    j = np.arange(math.floor(bbox.south / dlat), math.floor(bbox.north / dlat) + 1)
    k = config.COAST_SAMPLES_PER_CELL
    offsets = (np.arange(k) + 0.5) / k
    ii, jj = np.meshgrid(i, j, indexing="ij")
    lon = (ii[..., None, None] + offsets[:, None]) * dlon
    lat = (jj[..., None, None] + offsets[None, :]) * dlat
    lon, lat = np.broadcast_arrays(lon, lat)
    land_share = land_mask(lon, lat).mean(axis=(2, 3))
    coast = (land_share > 0) & (land_share < 1)
    return {
        "cell_deg": [dlon, dlat],
        "bbox": bbox.as_list(),
        "cells": np.stack([ii[coast], jj[coast]], axis=1).tolist(),
    }
