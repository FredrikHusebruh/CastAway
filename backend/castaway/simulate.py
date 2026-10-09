"""OpenDrift (OceanDrift) runs: nets are simulated in batches; each batch is one NetCDF + JSON sidecar.

Particles are seeded in net order, so trajectory indices [first, first+count) belong to one net;
the sidecar records that mapping plus each net's particle weight.
Runs live in ``runs/<forecast_start>/`` and a manifest lets reruns skip nets already simulated.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd

from castaway import config
from castaway.forcing import ForcingFiles

log = logging.getLogger(__name__)
# Give OpenDrift its own handler: by default it installs coloredlogs on the root logger
# at its own level, which silences our INFO logs.
_OPENDRIFT_HANDLER = logging.StreamHandler()


@dataclass(frozen=True)
class Readers:
    currents: Any
    wind: Any
    extra: tuple[Any, ...] = ()

    @property
    def all(self) -> list[Any]:
        return [*self.extra, self.currents, self.wind]

    @property
    def end_time(self) -> datetime:
        """Last time covered by both readers (aware UTC; OpenDrift itself uses naive UTC)."""
        return min(self.currents.end_time, self.wind.end_time).replace(tzinfo=UTC)


def make_readers(forcing: ForcingFiles) -> Readers:
    """Readers for the cached daily NorKyst files (+ optional MEPS forecast wind, read remotely)."""
    from opendrift.readers import reader_netCDF_CF_generic as generic

    currents = generic.Reader([str(p) for p in forcing.currents], name="norkyst_currents")
    wind = generic.Reader([str(p) for p in forcing.wind], name="norkyst_wind")
    extra: tuple[Any, ...] = ()
    if config.USE_MEPS_FORECAST_WIND:
        extra = (generic.Reader(config.MEPS_URL, name="meps_wind"),)
    return Readers(currents=currents, wind=wind, extra=extra)


def gear_fingerprint(gear: pd.DataFrame) -> str:
    """Short hash of the simulated input (ids, positions, loss times, gear types).

    Mock ids repeat across regenerations (mock-0000, ...), so ids alone cannot tell old and new input apart.
    """
    cols = ["id", "lon", "lat", "lost_time", "gear_type"]
    rows = gear[cols].sort_values("id").astype(str).agg("|".join, axis=1)
    return hashlib.sha1(";".join(rows).encode()).hexdigest()[:8]


def run_dir_for(forecast_start: datetime, gear: pd.DataFrame, region: str) -> Path:
    """One run directory per (source, region, forecast hour, gear input), so changed input never reuses old runs."""
    source = gear.attrs.get("source", "real")
    prefix = "mock" if source == "mock" else "real"
    return config.RUNS_DIR / f"{prefix}_{region}_{forecast_start:%Y%m%dT%H}_{gear_fingerprint(gear)}"


def naive_utc(t: datetime) -> datetime:
    """OpenDrift compares against naive UTC reader times."""
    return t.astimezone(UTC).replace(tzinfo=None)


def seed_time_for(lost_time: pd.Timestamp, window_start: datetime) -> datetime:
    """Seed at the loss time, but never before the hindcast cap."""
    return max(lost_time.to_pydatetime(), window_start)


def _batch_key(net_ids: list[str]) -> str:
    return hashlib.sha1(",".join(sorted(net_ids)).encode()).hexdigest()[:10]


def _new_model(readers: Readers) -> Any:
    from opendrift.models.oceandrift import OceanDrift

    o = OceanDrift(loglevel=config.OPENDRIFT_LOGLEVEL, logfile=[_OPENDRIFT_HANDLER])
    logging.getLogger("opendrift").propagate = False
    o.add_reader(readers.all)
    o.set_config("general:coastline_action", "stranding")
    o.set_config("environment:constant:horizontal_diffusivity", config.HORIZONTAL_DIFFUSIVITY)
    o.set_config("drift:max_speed", config.MAX_SPEED_MS)
    return o


def _seed_nets(o: Any, nets: pd.DataFrame, window_start: datetime) -> list[dict[str, Any]]:
    """Seed each net's particles split across wind drift factors; return the trajectory→net mapping."""
    per_factor = max(config.PARTICLES_PER_NET // len(config.WIND_DRIFT_FACTORS), 1)
    mapping, first = [], 0
    for net in nets.itertuples():
        seed_time = seed_time_for(net.lost_time, window_start)
        for factor in config.WIND_DRIFT_FACTORS:
            o.seed_elements(
                lon=net.lon,
                lat=net.lat,
                time=naive_utc(seed_time),
                number=per_factor,
                radius=config.SEED_RADIUS_M,
                wind_drift_factor=factor,
            )
        count = per_factor * len(config.WIND_DRIFT_FACTORS)
        mapping.append(
            {
                "id": net.id,
                "first": first,
                "count": count,
                "weight": float(net.float_prob) / count,
                "seed_time": seed_time.isoformat(),
            }
        )
        first += count
    return mapping


def _status_counts(o: Any) -> dict[str, int]:
    """Final status of all particles, e.g. {"active": 120, "stranded": 80}."""
    counts: dict[str, int] = {"active": int(o.num_elements_active())}
    for code in o.elements_deactivated.status:
        name = o.status_categories[int(code)]
        counts[name] = counts.get(name, 0) + 1
    return counts


def simulate_batch(nets: pd.DataFrame, readers: Readers, window: config.Window, out_dir: Path) -> Path:
    """One OceanDrift run for a batch of nets. Returns the NetCDF path (sidecar is <same>.json)."""
    key = _batch_key(list(nets["id"]))
    nc_path = out_dir / f"batch_{key}.nc"
    end = min(window.end, readers.end_time)
    t = time.perf_counter()
    o = _new_model(readers)
    mapping = _seed_nets(o, nets, window.start)
    o.run(
        end_time=naive_utc(end),
        time_step=timedelta(minutes=config.TIME_STEP_MINUTES),
        time_step_output=timedelta(minutes=config.OUTPUT_STEP_MINUTES),
        outfile=str(nc_path),
        export_variables=["lon", "lat", "status", "wind_drift_factor"],
    )
    status_counts = _status_counts(o)
    sidecar = {"nets": mapping, "end_time": end.isoformat(), "status_counts": status_counts}
    nc_path.with_suffix(".json").write_text(json.dumps(sidecar, indent=1), encoding="utf-8")
    log.info("batch %s: %d nets, %d particles, %.0fs, %s", key, len(nets), sum(m["count"] for m in mapping),
             time.perf_counter() - t, status_counts)
    return nc_path


def _load_manifest(out_dir: Path) -> dict[str, str]:
    path = out_dir / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _save_manifest(out_dir: Path, manifest: dict[str, str]) -> None:
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")


def simulate_all(
    gear: pd.DataFrame, readers: Readers, window: config.Window, region: str, force: bool = False
) -> Path:
    """Simulate every net not yet in this run's manifest. Returns the run directory."""
    out_dir = run_dir_for(window.forecast_start, gear, region)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {} if force else _load_manifest(out_dir)
    todo = gear[~gear["id"].isin(manifest)]
    log.info("%d nets total, %d already simulated, %d to run", len(gear), len(gear) - len(todo), len(todo))
    for i in range(0, len(todo), config.NETS_PER_RUN):
        batch = todo.iloc[i : i + config.NETS_PER_RUN]
        nc_path = simulate_batch(batch, readers, window, out_dir)
        manifest.update({net_id: nc_path.name for net_id in batch["id"]})
        _save_manifest(out_dir, manifest)
    return out_dir
