"""Sanity check: simulate one net end to end and plot it (data/output/one_net.png).

Usage: python scripts/plot_one_net.py [--net-id ID] [--hours-back 24] [--hours-forward 24]
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from castaway import barentswatch, config, forcing, simulate  # noqa: E402
from castaway.aggregate import batch_strandings  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--net-id", help="default: the most recently lost net in the region")
    parser.add_argument("--hours-back", type=int, default=24)
    parser.add_argument("--hours-forward", type=int, default=24)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    now = config.utc_now()
    window = config.Window(
        start=now - timedelta(hours=args.hours_back),
        forecast_start=now,
        end=now + timedelta(hours=args.hours_forward),
    )
    gear = barentswatch.load_gear(config.region_bbox(), now)
    net = gear[gear["id"] == args.net_id] if args.net_id else gear.tail(1)
    print(net.to_string())

    files = forcing.ensure_forcing(config.REGION, config.region_bbox(), window.start, window.end)
    readers = simulate.make_readers(files)
    out_dir = config.OUTPUT_DIR / "one_net"
    out_dir.mkdir(parents=True, exist_ok=True)
    nc_path = simulate.simulate_batch(net, readers, window, out_dir)

    strandings = batch_strandings(nc_path)
    print(f"stranded particles: {len(strandings)}")
    print(strandings.head().to_string())

    from opendrift.models.oceandrift import OceanDrift

    o = OceanDrift(loglevel=50)
    o.io_import_file(str(nc_path))
    png = config.OUTPUT_DIR / "one_net.png"
    o.plot(filename=str(png), fast=True, buffer=0.2)
    print(f"plot -> {png}")


if __name__ == "__main__":
    main()
