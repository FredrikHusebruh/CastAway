import numpy as np
import pandas as pd
import pytest

from castaway.aggregate import (
    _last_valid_index,
    _trajectory_net_ids,
    assign_cells,
    cell_polygon,
    cell_size_deg,
    cells_geojson,
    color_breaks,
    combine_drift,
    rolling_cells,
)

LAT0 = 70.0


def _strandings(rows):
    df = pd.DataFrame(rows, columns=["net_id", "lon", "lat", "time", "weight"])
    df["time"] = pd.to_datetime(df["time"], utc=True)
    return df


def test_cell_size_is_about_one_km():
    dlon, dlat = cell_size_deg(LAT0)
    assert dlat * 111.32 == pytest.approx(1.0)
    assert dlon * 111.32 * np.cos(np.radians(LAT0)) == pytest.approx(1.0)


def test_same_cell_for_close_points():
    df = _strandings(
        [("a", 30.0001, 70.0001, "2026-10-09T01:00", 0.1), ("b", 30.0002, 70.0002, "2026-10-09T02:00", 0.1)]
    )
    cells = assign_cells(df, LAT0)
    assert cells["cell_id"].nunique() == 1


def test_expected_nets():
    # net "a": 2 of 4 particles stranded with float_prob 0.3 -> 2 * 0.3/4 = 0.15 expected nets
    w = 0.3 / 4
    df = _strandings(
        [
            ("a", 30.0001, 70.0001, "2026-10-09T01:00", w),
            ("a", 30.0001, 70.0001, "2026-10-09T03:00", w),
            ("b", 30.0001, 70.0001, "2026-10-09T05:00", 0.5),
        ]
    )
    cells = rolling_cells(df, LAT0, ["2026-10-09"], 1)
    assert len(cells) == 1
    row = cells.iloc[0]
    assert row["expected_nets"] == pytest.approx(0.15 + 0.5)
    assert row["particle_count"] == 3
    assert row["contributing_net_ids"] == ["a", "b"]


def test_split_by_utc_day():
    df = _strandings([("a", 30.0, 70.0, "2026-10-09T23:30", 0.1), ("a", 30.0, 70.0, "2026-10-10T00:30", 0.1)])
    cells = rolling_cells(df, LAT0, ["2026-10-09", "2026-10-10"], 1)
    assert list(cells["date"]) == ["2026-10-09", "2026-10-10"]
    assert list(cells["particle_count"]) == [1, 1]


def test_rolling_window_includes_last_seven_days():
    df = _strandings([("a", 30.0, 70.0, "2026-10-03T12:00", 0.1), ("b", 30.0, 70.0, "2026-10-09T12:00", 0.2)])
    cells = rolling_cells(df, LAT0, ["2026-10-09", "2026-10-10"], 7)
    by_date = cells.set_index("date")["expected_nets"]
    assert by_date["2026-10-09"] == pytest.approx(0.3)  # 3..9 Oct inclusive
    assert by_date["2026-10-10"] == pytest.approx(0.2)  # 3 Oct has dropped out


def test_empty_strandings():
    assert rolling_cells(_strandings([]), LAT0, ["2026-10-09"], 7).empty


def test_polygon_closed_and_contains_point():
    df = assign_cells(_strandings([("a", 30.123, 70.456, "2026-10-09T01:00", 0.1)]), LAT0)
    ring = cell_polygon(int(df["i"][0]), int(df["j"][0]), LAT0)
    assert ring[0] == ring[-1]
    lons, lats = [p[0] for p in ring], [p[1] for p in ring]
    assert min(lons) <= 30.123 <= max(lons) and min(lats) <= 70.456 <= max(lats)


def test_geojson_properties():
    df = _strandings([("a", 30.0, 70.0, "2026-10-09T01:00", 0.25)])
    fc = cells_geojson(rolling_cells(df, LAT0, ["2026-10-09"], 7), LAT0)
    props = fc["features"][0]["properties"]
    assert props["expected_nets"] == 0.25 and props["n_nets"] == 1 and props["contributing_net_ids"] == ["a"]


def test_last_valid_index():
    lon = np.array([[1.0, 2.0, np.nan], [1.0, np.nan, np.nan], [np.nan, np.nan, np.nan]])
    assert list(_last_valid_index(lon)) == [1, 0, -1]


def test_trajectory_mapping():
    sidecar = {
        "nets": [{"id": "a", "first": 0, "count": 2, "weight": 0.1}, {"id": "b", "first": 2, "count": 1, "weight": 0.5}]
    }
    ids, weights = _trajectory_net_ids(sidecar, 3)
    assert list(ids) == ["a", "a", "b"]
    assert list(weights) == [0.1, 0.1, 0.5]


def test_color_breaks_are_log_spaced_and_ignore_zero():
    values = pd.Series([0.0, 0.00025, 0.00025, 0.0005, 0.001, 0.019])
    breaks = color_breaks(values, n_classes=5)
    assert breaks == [0.0006, 0.001, 0.003, 0.008]
    assert color_breaks(pd.Series([0.0, 0.0])) == []
    assert color_breaks(pd.Series([0.001, 0.001])) == []


def test_combine_drift_normalises_and_filters_by_date():
    nets = [
        {"weight": 0.3, "days": {"2026-10-08": [[0, 0, 3], [1, 0, 1]], "2026-10-09": [[2, 0, 4]]}},
        {"weight": 0.05, "days": {"2026-10-08": [[0, 0, 4]]}},
    ]
    cells = combine_drift(nets, "2026-10-08", (0.1, 0.05))
    assert len(cells) == 2  # the 9 Oct cell is excluded
    assert max(c[2] for c in cells) == 1.0
    top = cells[-1]  # sorted ascending by likelihood
    assert top[:2] == [pytest.approx(0.025), pytest.approx(0.05)]  # centre of cell (0, 0)
    assert len(combine_drift(nets, None, (0.1, 0.05))) == 3
    assert combine_drift([], None, (0.1, 0.05)) == []


def _paths_net():
    # output step 0 = 2026-10-08T22:00Z; particle 1 starts at step 0 and strands at step 3 (2026-10-09T01:00)
    coords = [[30.0, 70.0], [30.1, 70.1], [30.2, 70.2], [30.3, 70.3]]
    return {
        "start": "2026-10-08T22:00:00+00:00",
        "particles": [
            {"wdf": 0.0, "first": 0, "stranded": True, "coords": coords},
            {"wdf": 0.0, "first": 0, "stranded": False, "coords": coords[:2]},
            {"wdf": 0.03, "first": 1, "stranded": False, "coords": coords[1:]},
        ],
    }


def test_trim_paths_cuts_at_date_and_marks_stranding():
    from castaway.aggregate import trim_paths

    by_8th = trim_paths({"n": _paths_net()}, "2026-10-08", per_factor=10, step=1)
    assert [len(p["coords"]) for p in by_8th] == [2, 2]  # steps 0-1 only; the 3rd path has < 2 points by then
    assert not any(p["stranded"] for p in by_8th)
    full = trim_paths({"n": _paths_net()}, None, per_factor=10, step=1)
    assert full[0]["stranded"] and full[0]["coords"][0] == [70.0, 30.0]  # [lat, lon]


def test_trim_paths_thins_particles_and_steps():
    from castaway.aggregate import trim_paths

    paths = trim_paths({"n": _paths_net()}, None, per_factor=1, step=2)
    assert [p["wdf"] for p in paths] == [0.0, 0.03]  # one per wind drift factor
    assert paths[0]["coords"] == [[70.0, 30.0], [70.2, 30.2], [70.3, 30.3]]  # every 2nd step + last


def test_trim_paths_uses_output_step_length():
    from castaway.aggregate import trim_paths

    net = {**_paths_net(), "start": "2026-10-08T23:00:00+00:00", "step_minutes": 15}
    # 15-min steps from 23:00: steps 0-3 fall on 8 Oct, so all 4 points of the first path are kept
    by_8th = trim_paths({"n": net}, "2026-10-08", per_factor=10, step=1)
    assert len(by_8th[0]["coords"]) == 4


def test_item_strandings_groups_per_item_and_keeps_weights():
    from castaway.aggregate import item_strandings

    strandings = _strandings(
        [("a", 30.0, 70.0, "2026-10-09T01:00", 0.0015), ("a", 30.1, 70.1, "2026-10-09T02:00", 0.0015)]
    )
    gear = pd.DataFrame({"id": ["a", "b"], "float_prob": [0.3, 0.05]})
    items = item_strandings(strandings, gear)
    assert items["a"]["float_prob"] == 0.3
    assert [s[3] for s in items["a"]["strandings"]] == [0.0015, 0.0015]
    assert items["b"] == {"float_prob": 0.05, "strandings": []}
