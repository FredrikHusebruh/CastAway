"""Generate synthetic lost-gear reports (random time, gear type, near-coast sea position) for demos.

Writes data/raw/mock_gear.csv; use it with: python scripts/run_forecast.py --mock

Usage: python scripts/make_mock_gear.py [--n 60] [--region finnmark_east] [--days N] [--seed 42] [--near-coast-km 10]
"""

from __future__ import annotations

import argparse
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from castaway import config  # noqa: E402
from castaway.mock_gear import make_mock_gear  # noqa: E402


def main() -> None:
    window = config.run_window()
    default_days = (window.forecast_start - window.first_day).total_seconds() / 86400
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=60, help="number of lost items")
    parser.add_argument("--region", default=config.REGION, choices=config.REGIONS)
    parser.add_argument(
        "--days",
        type=float,
        default=default_days,
        help=f"lost within the last N days (default {default_days:.1f}: after the model's spin-up, so every "
        "item drifts from its own loss time)",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--near-coast-km", type=float, default=10.0, help="max distance from land")
    args = parser.parse_args()

    end = window.forecast_start
    gear = make_mock_gear(
        args.n,
        config.region_bbox(args.region),
        start=end - timedelta(days=args.days),
        end=end,
        seed=args.seed,
        near_coast_km=args.near_coast_km,
    )
    config.MOCK_GEAR_PATH.parent.mkdir(parents=True, exist_ok=True)
    gear.to_csv(config.MOCK_GEAR_PATH, index=False)
    print(gear.head().to_string())
    print("\n" + gear["gear_type"].value_counts().to_string())
    print(f"\n{len(gear)} mock items lost {gear['lost_time'].min()} .. {gear['lost_time'].max()}")
    print(f"-> {config.MOCK_GEAR_PATH}\nnext: python scripts/run_forecast.py --mock")


if __name__ == "__main__":
    main()
