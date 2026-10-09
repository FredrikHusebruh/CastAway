from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from castaway import barentswatch, config
from castaway.mock_gear import _is_land, make_mock_gear

BBOX = config.REGIONS["finnmark_east"]
END = datetime(2026, 10, 8, 21, tzinfo=UTC)
START = END - timedelta(days=5)


@pytest.fixture(scope="module")
def mock():
    return make_mock_gear(30, BBOX, START, END, seed=1)


def test_schema_matches_real_gear(mock):
    assert list(mock.columns) == barentswatch.GEAR_COLUMNS
    assert mock["id"].is_unique


def test_positions_inside_bbox_and_at_sea(mock):
    assert mock["lon"].between(BBOX.west, BBOX.east).all()
    assert mock["lat"].between(BBOX.south, BBOX.north).all()
    assert not _is_land(mock["lon"].to_numpy(), mock["lat"].to_numpy()).any()


def test_times_and_gear_types(mock):
    assert (mock["lost_time"] >= START).all() and (mock["lost_time"] <= END).all()
    assert set(mock["gear_type"]) <= set(config.GEAR_FLOAT_PROB)
    assert np.allclose(mock["float_prob"], mock["gear_type"].map(config.GEAR_FLOAT_PROB))


def test_deterministic_for_same_seed(mock):
    again = make_mock_gear(30, BBOX, START, END, seed=1)
    assert again.equals(mock)


def test_mock_source_round_trips_through_loader(mock, tmp_path, monkeypatch):
    path = tmp_path / "mock_gear.csv"
    mock.to_csv(path, index=False)
    monkeypatch.setattr(config, "MOCK_GEAR_PATH", path)
    gear = barentswatch.load_gear(BBOX, END, source="mock")
    assert gear.attrs["source"] == "mock"
    assert len(gear) == len(mock)
