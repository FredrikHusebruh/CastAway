from datetime import UTC, datetime
from pathlib import Path

import pytest

from castaway import config
from castaway.barentswatch import canonical_gear, filter_gear, parse_olex

FIXTURE = Path(__file__).parent / "fixtures" / "sample_olex.txt"
NOW = datetime(2026, 10, 8, 18, tzinfo=UTC)


@pytest.fixture
def gear():
    return parse_olex(FIXTURE.read_text(encoding="utf-8"))


def test_parse_olex_rows(gear):
    assert len(gear) == 3
    nets = gear.iloc[0]
    assert nets["id"] == "c02b296d-4c83-444e-a026-f21246405d16"
    assert nets["gear_type"] == "nets"
    assert nets["lat"] == pytest.approx(3909.3044 / 60, abs=1e-4)  # centroid of 3 points
    assert nets["lost_time"] == datetime.fromtimestamp(1790865000, UTC)
    assert nets["float_prob"] == config.GEAR_FLOAT_PROB["nets"]


def test_empty_tool_id_gets_synthetic_id(gear):
    crab = gear.iloc[1]
    assert crab["id"].startswith("olex-")
    assert crab["gear_type"] == "crab_pot"


def test_filter_drops_invalid_and_outside(gear):
    world = config.BBox(-180, -90, 180, 90)
    assert len(filter_gear(gear, world, NOW)) == 2  # the 180/90 placeholder is dropped
    finnmark = config.REGIONS["finnmark_east"]
    kept = filter_gear(gear, finnmark, NOW)
    assert list(kept["gear_type"]) == ["crab_pot"]


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Crab pot", "crab_pot"),
        ("Fish pot", "fish_pot"),
        ("Nets", "nets"),
        ("NETS", "nets"),
        ("Long line", "longline"),
        ("LONGLINE", "longline"),
        ("Danish- / Purse- Seine", "seine"),
        ("Sensor / Cable", "sensor_cable"),
        ("Generic", "generic"),
        (None, "unknown"),
    ],
)
def test_canonical_gear(raw, expected):
    assert canonical_gear(raw) == expected
