"""Fetch lost fishing gear from BarentsWatch and normalise it to a small, PII-free table.

Two sources:
- ``notremoved`` (OAuth client credentials, needs BW_CLIENT_ID/SECRET in backend/.env)
- anonymised OLEX bulk download (public, used when no credentials are configured)

All requests are sequential and cached in ``data/raw/``.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from castaway import config

GEAR_COLUMNS = ["id", "lon", "lat", "lost_time", "gear_type", "float_prob"]

# The only notremoved fields CastAway uses. Everything else (vesselName, contactEmail/Phone, mmsi, ircs, regNum,
# comments, ...) is personal data and is dropped before anything is written to disk.
NOTREMOVED_FIELDS = ("lostMessageId", "toolId", "isRemoved", "toolTypeCode", "lostTime", "geometry")

_token: dict[str, Any] = {"value": None, "expires": 0.0}


# --- Auth / HTTP ------------------------------------------------------------------
def has_credentials() -> bool:
    return bool(config.BW_CLIENT_ID and config.BW_CLIENT_SECRET)


def get_token() -> str:
    """Return a cached OAuth2 token, refreshing it a minute before expiry."""
    if _token["value"] and time.time() < _token["expires"] - 60:
        return _token["value"]
    resp = requests.post(
        config.BW_TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": config.BW_CLIENT_ID,
            "client_secret": config.BW_CLIENT_SECRET,
            "scope": "api",
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=config.HTTP_TIMEOUT_S,
    )
    resp.raise_for_status()
    body = resp.json()
    _token["value"] = body["access_token"]
    _token["expires"] = time.time() + float(body.get("expires_in", 3600))
    return _token["value"]


def _is_fresh(path: Path) -> bool:
    age_s = time.time() - path.stat().st_mtime if path.exists() else float("inf")
    return age_s < config.RAW_CACHE_MAX_AGE_HOURS * 3600


def strip_personal_data(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only NOTREMOVED_FIELDS of each record."""
    return [{k: r.get(k) for k in NOTREMOVED_FIELDS} for r in records]


def fetch_notremoved(force: bool = False) -> list[dict[str, Any]]:
    """Lost gear not yet removed (authenticated), personal fields stripped. Cached as data/raw/notremoved.json."""
    path = config.RAW_DIR / "notremoved.json"
    if force or not _is_fresh(path):
        resp = requests.get(
            config.BW_API_BASE + config.BW_NOTREMOVED_PATH,
            headers={"Authorization": f"Bearer {get_token()}"},
            timeout=config.HTTP_TIMEOUT_S,
        )
        resp.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(strip_personal_data(resp.json())), encoding="utf-8")
    return strip_personal_data(json.loads(path.read_text(encoding="utf-8")))  # also cleans older cache files


def fetch_anonymous_olex(force: bool = False) -> str:
    """Public anonymised lost-gear download (OLEX text, gzip). Cached as data/raw/anonymous_olex.gz."""
    path = config.RAW_DIR / "anonymous_olex.gz"
    if force or not _is_fresh(path):
        resp = requests.get(config.BW_API_BASE + config.BW_ANON_OLEX_PATH, timeout=config.HTTP_TIMEOUT_S)
        resp.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(resp.content)
    return gzip.decompress(path.read_bytes()).decode("utf-8", errors="replace")


# --- Parsing -----------------------------------------------------------------------
def canonical_gear(raw: str | None) -> str:
    """Map API codes ("NETS") and OLEX names ("Crab pot") to a GEAR_FLOAT_PROB key."""
    s = (raw or "").lower()
    if "crab" in s and "pot" in s:
        return "crab_pot"
    if "pot" in s:
        return "fish_pot"
    if "seine" in s or "purse" in s:
        return "seine"
    if "net" in s:
        return "nets"
    if "line" in s:
        return "longline"
    if "sensor" in s or "cable" in s:
        return "sensor_cable"
    if "generic" in s:
        return "generic"
    return "unknown"


def _synthetic_id(lon: float, lat: float, epoch: int) -> str:
    return "olex-" + hashlib.sha1(f"{lon:.5f},{lat:.5f},{epoch}".encode()).hexdigest()[:12]


def parse_olex(text: str) -> pd.DataFrame:
    """Parse OLEX route blocks into one row per lost item (centroid of its points).

    Point lines are ``lat_minutes lon_minutes unix_epoch label``; gear is in
    ``MTekst 1: Redskapstype: <gear>``.
    """
    blocks: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("Rute ") or line == "Rute":
            cur = {"tool_id": None, "pts": [], "gear": None}
            blocks.append(cur)
        elif cur is None:
            continue
        elif line.startswith("ToolId"):
            parts = line.split()
            cur["tool_id"] = parts[1] if len(parts) > 1 else None
        elif line[:1].isdigit():
            lat_min, lon_min, epoch = line.split()[:3]
            cur["pts"].append((float(lon_min) / 60.0, float(lat_min) / 60.0, int(epoch)))
        elif line.startswith("MTekst 1:") and "Redskapstype:" in line:
            cur["gear"] = line.split("Redskapstype:", 1)[1].strip()

    rows = []
    for b in blocks:
        if not b["pts"]:
            continue
        lon = sum(p[0] for p in b["pts"]) / len(b["pts"])
        lat = sum(p[1] for p in b["pts"]) / len(b["pts"])
        epoch = b["pts"][0][2]
        rows.append(
            {
                "id": b["tool_id"] or _synthetic_id(lon, lat, epoch),
                "lon": lon,
                "lat": lat,
                "lost_time": datetime.fromtimestamp(epoch, UTC),
                "gear_type": canonical_gear(b["gear"]),
            }
        )
    return _finish(pd.DataFrame(rows, columns=GEAR_COLUMNS[:-1]))


def _geometry_centroid(geom: Any) -> tuple[float, float]:
    """Centroid of a GeoJSON-like geometry ({"type", "coordinates"}) or WKT string."""
    if isinstance(geom, str):
        from shapely import wkt

        c = wkt.loads(geom).centroid
        return c.x, c.y
    from shapely.geometry import shape

    c = shape(geom).centroid
    return c.x, c.y


def normalise_api_records(records: list[dict[str, Any]]) -> pd.DataFrame:
    """Normalise ``notremoved`` records (field names from the FishInfo OpenAPI spec).

    NOTE: written from the OpenAPI schema; re-verify against a real response
    (``scripts/fetch_gear.py --inspect``) once credentials are available.
    """
    rows = []
    for r in records:
        if r.get("isRemoved") or not r.get("geometry"):
            continue
        lon, lat = _geometry_centroid(r["geometry"])
        rows.append(
            {
                "id": r.get("lostMessageId") or r.get("toolId"),
                "lon": lon,
                "lat": lat,
                "lost_time": pd.to_datetime(r.get("lostTime"), utc=True),
                "gear_type": canonical_gear(r.get("toolTypeCode")),
            }
        )
    return _finish(pd.DataFrame(rows, columns=GEAR_COLUMNS[:-1]))


def _finish(df: pd.DataFrame) -> pd.DataFrame:
    df["lost_time"] = pd.to_datetime(df["lost_time"], utc=True)
    df["float_prob"] = df["gear_type"].map(config.GEAR_FLOAT_PROB).fillna(config.GEAR_FLOAT_PROB["unknown"])
    return df.drop_duplicates("id").reset_index(drop=True)


# --- Filtering / entry point ---------------------------------------------------------------
def filter_gear(df: pd.DataFrame, bbox: config.BBox, now: datetime) -> pd.DataFrame:
    """Drop invalid positions, gear outside the bbox, and reports that are too old or in the future."""
    valid = (df["lat"].abs() < 89.9) & (df["lon"].abs() < 179.9)
    inside = df["lon"].between(bbox.west, bbox.east) & df["lat"].between(bbox.south, bbox.north)
    oldest = now - timedelta(days=config.MAX_NET_AGE_DAYS)
    recent = (df["lost_time"] >= oldest) & (df["lost_time"] <= now)
    return df[valid & inside & recent].sort_values("lost_time").reset_index(drop=True)


def load_mock_gear() -> pd.DataFrame:
    """Synthetic reports written by scripts/make_mock_gear.py."""
    if not config.MOCK_GEAR_PATH.exists():
        raise FileNotFoundError(f"{config.MOCK_GEAR_PATH} missing - run scripts/make_mock_gear.py first")
    return _finish(pd.read_csv(config.MOCK_GEAR_PATH, usecols=GEAR_COLUMNS[:-1]))


def load_all_gear(force: bool = False, source: str = config.GEAR_SOURCE) -> tuple[pd.DataFrame, str]:
    """All normalised lost gear (unfiltered) and the name of the source used."""
    if source == "mock":
        return load_mock_gear(), "mock"
    if has_credentials():
        return normalise_api_records(fetch_notremoved(force)), "barentswatch_notremoved"
    return parse_olex(fetch_anonymous_olex(force)), "barentswatch_anonymous_olex"


def load_gear(
    bbox: config.BBox, now: datetime, force: bool = False, source: str = config.GEAR_SOURCE
) -> pd.DataFrame:
    """Lost gear inside ``bbox``; real data is cached to data/raw/gear_normalised.csv."""
    df, used = load_all_gear(force, source)
    gear = filter_gear(df, bbox, now)
    gear.attrs["source"] = used
    if used != "mock":
        gear.to_csv(config.RAW_DIR / "gear_normalised.csv", index=False)
    return gear
