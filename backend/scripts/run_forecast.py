"""Full pipeline: fetch lost gear -> forcing -> OpenDrift -> aggregate to GeoJSON in data/output/.

Usage: python scripts/run_forecast.py [--region finnmark_east] [--max-nets N] [--force] [--refetch] [--mock]
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from castaway import aggregate, barentswatch, config, forcing, simulate  # noqa: E402

log = logging.getLogger("run_forecast")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default=config.REGION, choices=config.REGIONS)
    parser.add_argument("--max-nets", type=int, help="simulate only the N most recently lost items (quick tests)")
    parser.add_argument("--force", action="store_true", help="re-simulate nets already in this forecast's manifest")
    parser.add_argument("--refetch", action="store_true", help="ignore the cached BarentsWatch download")
    parser.add_argument("--mock", action="store_true", help="use data/raw/mock_gear.csv (scripts/make_mock_gear.py)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    warnings.filterwarnings("ignore", category=FutureWarning)

    timings: dict[str, float] = {}
    bbox = config.region_bbox(args.region)
    window = config.run_window()
    log.info("region %s %s, window %s -> %s", args.region, bbox.as_list(), window.start, window.end)

    t = time.perf_counter()
    requested = "mock" if args.mock else config.GEAR_SOURCE
    gear = barentswatch.load_gear(bbox, window.forecast_start, args.refetch, requested)
    source = gear.attrs.get("source", "unknown")
    if args.max_nets:
        gear = gear.tail(args.max_nets).reset_index(drop=True)
    timings["fetch"] = time.perf_counter() - t
    log.info("%d lost items from %s", len(gear), source)

    t = time.perf_counter()
    files = forcing.ensure_forcing(args.region, bbox, window.start, window.end)
    timings["forcing"] = time.perf_counter() - t

    t = time.perf_counter()
    readers = simulate.make_readers(files)
    run_dir = simulate.simulate_all(gear, readers, window, args.region, args.force)
    timings["simulate"] = time.perf_counter() - t

    t = time.perf_counter()
    index = aggregate.write_outputs(gear, run_dir, window, args.region, source)
    timings["aggregate"] = time.perf_counter() - t

    log.info("timings (s): %s", {k: round(v) for k, v in timings.items()})
    log.info("expected nets per date: %s", index["expected_nets_per_date"])
    log.info("outputs in %s", config.OUTPUT_DIR)


if __name__ == "__main__":
    main()
