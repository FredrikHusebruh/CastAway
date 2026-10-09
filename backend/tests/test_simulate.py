from datetime import UTC, datetime

import pandas as pd

from castaway.simulate import gear_fingerprint, run_dir_for

NOW = datetime(2026, 10, 9, 8, tzinfo=UTC)


def _gear(lon: float = 8.0) -> pd.DataFrame:
    df = pd.DataFrame(
        {
            "id": ["mock-0000"],
            "lon": [lon],
            "lat": [58.1],
            "lost_time": [pd.Timestamp("2026-10-05T12:00Z")],
            "gear_type": ["nets"],
            "float_prob": [0.3],
        }
    )
    df.attrs["source"] = "mock"
    return df


def test_same_ids_different_input_get_different_run_dirs():
    assert gear_fingerprint(_gear(8.0)) != gear_fingerprint(_gear(8.5))
    assert run_dir_for(NOW, _gear(8.0), "kristiansand") != run_dir_for(NOW, _gear(8.5), "kristiansand")


def test_run_dir_separates_regions_and_is_stable():
    a = run_dir_for(NOW, _gear(), "kristiansand")
    assert a == run_dir_for(NOW, _gear(), "kristiansand")  # restartable
    assert a != run_dir_for(NOW, _gear(), "finnmark_east")
    assert a.name.startswith("mock_kristiansand_20261009T08_")
