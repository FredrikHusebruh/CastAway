"""Central configuration. Every tunable lives here; modules import from this file.

Most values can be overridden with ``CASTAWAY_*`` environment variables (or backend/.env).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _env_str(name: str, default: str) -> str:
    return os.getenv(f"CASTAWAY_{name}", default)


def _env_int(name: str, default: int) -> int:
    return int(os.getenv(f"CASTAWAY_{name}", default))


def _env_float(name: str, default: float) -> float:
    return float(os.getenv(f"CASTAWAY_{name}", default))


def _env_bool(name: str, default: bool) -> bool:
    return os.getenv(f"CASTAWAY_{name}", str(default)).lower() in ("1", "true", "yes")


# --- Paths -------------------------------------------------------------------
DATA_DIR = BACKEND_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
FORCING_DIR = RAW_DIR / "forcing"
OUTPUT_DIR = DATA_DIR / "output"
RUNS_DIR = OUTPUT_DIR / "runs"
TRACKS_DIR = OUTPUT_DIR / "tracks"
DRIFT_DIR = OUTPUT_DIR / "drift"
PATHS_DIR = OUTPUT_DIR / "paths"
STRANDINGS_DIR = OUTPUT_DIR / "strandings"


# --- Region ------------------------------------------------------------------
@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def contains(self, lon: float, lat: float) -> bool:
        return self.west <= lon <= self.east and self.south <= lat <= self.north

    def padded(self, deg: float) -> BBox:
        return BBox(self.west - deg, self.south - deg, self.east + deg, self.north + deg)

    @property
    def center(self) -> tuple[float, float]:
        return ((self.west + self.east) / 2, (self.south + self.north) / 2)

    def as_list(self) -> list[float]:
        return [self.west, self.south, self.east, self.north]


# Default test area: Kristiansand / Agder coast (Mandal to Grimstad + Skagerrak). Real reports there are
# sparse (3 in the last year), so it is mainly used with mock data; East Finnmark has the most real reports.
REGIONS: dict[str, BBox] = {
    "kristiansand": BBox(7.0, 57.75, 8.9, 58.45),
    "finnmark_east": BBox(25.0, 69.6, 31.5, 71.3),
    "vestland": BBox(4.5, 59.5, 7.5, 62.0),
    "lofoten": BBox(12.0, 67.5, 16.5, 68.8),
}
REGION = _env_str("REGION", "kristiansand")
FORCING_MARGIN_DEG = 0.3  # extra forcing around the bbox so particles can leave it


def region_bbox(name: str = REGION) -> BBox:
    return REGIONS[name]


# --- Time window ---------------------------------------------------------------
HINDCAST_DAYS = _env_int("HINDCAST_DAYS", 7)  # cap on drift before "now" (forcing download cost)
FORECAST_DAYS = _env_int("FORECAST_DAYS", 3)
MAX_NET_AGE_DAYS = _env_int("MAX_NET_AGE_DAYS", 365)  # older reports are ignored
# Items lost before the window are all seeded at its start at their (often near-shore) reported
# position, so many strand within hours. Strandings during this spin-up are discarded.
SPINUP_HOURS = _env_int("SPINUP_HOURS", 24)


def utc_now() -> datetime:
    """Current time floored to the hour (override with CASTAWAY_NOW for reproducible runs)."""
    override = os.getenv("CASTAWAY_NOW")
    now = datetime.fromisoformat(override.replace("Z", "+00:00")) if override else datetime.now(UTC)
    return now.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


@dataclass(frozen=True)
class Window:
    start: datetime  # earliest seed time (hindcast cap)
    forecast_start: datetime  # "now"
    end: datetime  # FORECAST_END

    @property
    def first_day(self) -> datetime:
        """Midnight (UTC) of the first full day after spin-up: the first date shown on the map."""
        spun_up = self.start + timedelta(hours=SPINUP_HOURS)
        midnight = spun_up.replace(hour=0, minute=0, second=0, microsecond=0)
        return midnight if midnight == spun_up else midnight + timedelta(days=1)


def run_window(now: datetime | None = None) -> Window:
    now = now or utc_now()
    return Window(
        start=now - timedelta(days=HINDCAST_DAYS),
        forecast_start=now,
        end=now + timedelta(days=FORECAST_DAYS),
    )


# --- Simulation ------------------------------------------------------------------
PARTICLES_PER_NET = _env_int("PARTICLES_PER_NET", 200)
SEED_RADIUS_M = _env_float("SEED_RADIUS_M", 500.0)
WIND_DRIFT_FACTORS: tuple[float, ...] = (0.0, 0.01, 0.02, 0.03)
TIME_STEP_MINUTES = 15
OUTPUT_STEP_MINUTES = 15  # = model step, so drawn paths follow the water instead of cutting corners over land
NETS_PER_RUN = _env_int("NETS_PER_RUN", 25)
HORIZONTAL_DIFFUSIVITY = 10.0  # m2/s, unresolved sub-grid turbulence
MAX_SPEED_MS = 3.5  # sizes OpenDrift's reader data blocks; tidal sounds in Finnmark exceed the default 2 m/s
OPENDRIFT_LOGLEVEL = 30  # WARNING
# NorKyst wind is MEPS-derived; reading MEPS remotely per batch is slow, so it is opt-in.
USE_MEPS_FORECAST_WIND = _env_bool("USE_MEPS_FORECAST_WIND", False)

# Probability that a lost item of this gear type floats (weight on its particles).
GEAR_FLOAT_PROB: dict[str, float] = {
    "seine": 0.8,
    "generic": 0.5,
    "unknown": 0.5,
    "nets": 0.3,
    "longline": 0.2,
    "sensor_cable": 0.1,
    "crab_pot": 0.05,
    "fish_pot": 0.05,
}

# --- Aggregation -------------------------------------------------------------------
CELL_SIZE_KM = _env_float("CELL_SIZE_KM", 1.0)
BEACHING_WINDOW_DAYS = _env_int("BEACHING_WINDOW_DAYS", 7)  # each date shows strandings in the N days up to it
DRIFT_CELL_KM = _env_float("DRIFT_CELL_KM", 2.0)  # grid for the per-net drift-likelihood heat map
MAX_DRIFT_NETS = 25  # nets combined in one /api/drift or /api/paths request
PATH_PARTICLES_PER_FACTOR = 6  # particle paths stored per net and wind drift factor (spaghetti view)
COLOR_CLASSES = 5  # legend classes for expected_nets (breaks are data-driven, see aggregate.color_breaks)
COAST_SAMPLES_PER_CELL = 4  # coast.json: land/sea samples per cell side; a cell with both is a coast cell
# coast.json reaches this far beyond the region, so a report near the region's edge still sees the coast just
# outside it (the app checks up to 2 km from the coast; 0.1 deg is >= 3.6 km even at 71 N)
COAST_PAD_DEG = 0.1

# --- External services ---------------------------------------------------------------
BW_TOKEN_URL = "https://id.barentswatch.no/connect/token"
BW_API_BASE = "https://www.barentswatch.no/bwapi"
BW_NOTREMOVED_PATH = "/v1/lostfishingfacility/notremoved"
BW_ANON_OLEX_PATH = "/v1/geodata/download/anonymouslostfishingfacility?format=OLEX"
BW_CLIENT_ID = os.getenv("BW_CLIENT_ID", "")
BW_CLIENT_SECRET = os.getenv("BW_CLIENT_SECRET", "")
RAW_CACHE_MAX_AGE_HOURS = 12
# "auto": BarentsWatch (authenticated if credentials exist, else anonymised OLEX); "mock": scripts/make_mock_gear.py
GEAR_SOURCE = _env_str("GEAR_SOURCE", "auto")
MOCK_GEAR_PATH = RAW_DIR / "mock_gear.csv"
HTTP_TIMEOUT_S = 60

# NorKyst v3 800 m "best estimate" aggregate: currents + atmospheric wind, 2024 -> ~now+4 days.
NORKYST_URL = "https://thredds.met.no/thredds/dodsC/fou-hi/norkystv3_800m_m00_be"
NORKYST_CURRENT_VARS = ("u_eastward", "v_northward")
NORKYST_WIND_VARS = ("Uwind_eastward", "Vwind_northward")
# THREDDS cost is ~1 s per variable per time step, so wind (smooth) is fetched at a coarser stride.
WIND_STRIDE_HOURS = 3
# Past days are cached forever; days touching the forecast are refetched after this many hours.
FORECAST_FORCING_MAX_AGE_HOURS = 12
# MEPS 2.5 km latest: higher-resolution wind for ~now -> now+61 h.
MEPS_URL = "https://thredds.met.no/thredds/dodsC/mepslatest/meps_lagged_6_h_latest_2_5km_latest.nc"

ATTRIBUTION = "Data: BarentsWatch, MET Norway. Drift model: OpenDrift."
