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


def test_normalise_notremoved_record_shape():
    """Shape verified against a real /notremoved response on 2026-10-09 (personal fields blanked)."""
    from castaway.barentswatch import normalise_api_records

    record = {
        "lostMessageId": "11111111-2222-3333-4444-555555555555",
        "toolId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "isRemoved": False,
        "toolTypeCode": "CRABPOT",
        "lostTime": "2026-10-08T09:37:00+02:00",
        "geometry": {"type": "LineString", "coordinates": [[9.0, 63.0], [9.2, 63.0]]},
        "vesselName": "x",
        "contactEmail": "x",
        "contactPhone": "x",
        "mmsi": 1,
    }
    removed = {**record, "lostMessageId": "removed", "isRemoved": True}
    df = normalise_api_records([record, removed])
    assert list(df.columns) == ["id", "lon", "lat", "lost_time", "gear_type", "float_prob"]
    assert len(df) == 1
    row = df.iloc[0]
    assert row["gear_type"] == "crab_pot"
    assert row["lon"] == pytest.approx(9.1) and row["lat"] == pytest.approx(63.0)
    assert row["lost_time"] == datetime(2026, 10, 8, 7, 37, tzinfo=UTC)


def test_fetch_notremoved_never_writes_personal_data(tmp_path, monkeypatch):
    import json as _json

    from castaway import barentswatch

    record = {
        "lostMessageId": "11111111-2222-3333-4444-555555555555",
        "toolId": "t",
        "isRemoved": False,
        "toolTypeCode": "NETS",
        "lostTime": "2026-10-08T09:37:00+02:00",
        "geometry": {"type": "Point", "coordinates": [9.0, 63.0]},
        "vesselName": "Secret Vessel",
        "contactEmail": "skipper@example.no",
        "contactPhone": "+47 99999999",
        "mmsi": 257000000,
        "ircs": "LABC",
        "regNum": "F-1-V",
        "comment": "call me",
    }

    class Resp:
        text = _json.dumps([record])

        def raise_for_status(self):
            pass

        def json(self):
            return [record]

    monkeypatch.setattr(config, "RAW_DIR", tmp_path)
    monkeypatch.setattr(barentswatch, "get_token", lambda: "token")
    monkeypatch.setattr(barentswatch.requests, "get", lambda *a, **k: Resp())
    records = barentswatch.fetch_notremoved(force=True)
    on_disk = (tmp_path / "notremoved.json").read_text(encoding="utf-8")
    for secret in ("Secret Vessel", "skipper@example.no", "99999999", "257000000", "LABC", "F-1-V", "call me"):
        assert secret not in on_disk
    assert set(records[0]) == set(barentswatch.NOTREMOVED_FIELDS)
    assert len(barentswatch.normalise_api_records(records)) == 1
