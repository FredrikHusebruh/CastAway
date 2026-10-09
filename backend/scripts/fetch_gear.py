"""Fetch lost gear once, print a sample and per-region counts, and cache it to data/raw/.

Usage: python scripts/fetch_gear.py [--region NAME] [--force] [--inspect]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from castaway import barentswatch, config  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default=config.REGION, choices=config.REGIONS)
    parser.add_argument("--force", action="store_true", help="ignore the raw cache")
    parser.add_argument("--inspect", action="store_true", help="print raw API records (needs credentials)")
    args = parser.parse_args()

    now = config.utc_now()
    if args.inspect and barentswatch.has_credentials():
        records = barentswatch.fetch_notremoved(args.force)
        print(f"{len(records)} raw notremoved records; first 2:")
        print(json.dumps(records[:2], indent=2, ensure_ascii=False)[:3000])

    all_gear, source = barentswatch.load_all_gear(args.force)
    print(f"source: {source}  records: {len(all_gear)}")
    print(all_gear.head().to_string())
    print("\ngear types:\n" + all_gear["gear_type"].value_counts().to_string())

    print("\nper region (valid, lost within MAX_NET_AGE_DAYS):")
    for name, bbox in config.REGIONS.items():
        print(f"  {name:14s} {len(barentswatch.filter_gear(all_gear, bbox, now)):4d}")

    gear = barentswatch.load_gear(config.region_bbox(args.region), now, args.force)
    print(f"\n{args.region}: {len(gear)} items -> {config.RAW_DIR / 'gear_normalised.csv'}")
    print(gear["gear_type"].value_counts().to_string())


if __name__ == "__main__":
    main()
