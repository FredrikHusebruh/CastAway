import json

import pytest
from fastapi.testclient import TestClient

from castaway import api, config

INDEX = {
    "dates": ["2026-10-09"],
    "bbox": [25.0, 69.6, 31.5, 71.3],
    "attribution": config.ATTRIBUTION,
    "drift_cell_deg": [0.05, 0.02],
}
DRIFT = {"weight": 0.3, "days": {"2026-10-09": [[600, 3500, 5]], "2026-10-10": [[601, 3500, 2]]}}
TRACK = [
    {"time": "2026-10-09T23:00:00+00:00", "lon": 30.0, "lat": 70.0},
    {"time": "2026-10-10T00:00:00+00:00", "lon": 30.1, "lat": 70.1},
]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(config, "TRACKS_DIR", tmp_path / "tracks")
    monkeypatch.setattr(config, "DRIFT_DIR", tmp_path / "drift")
    (tmp_path / "tracks").mkdir()
    (tmp_path / "drift").mkdir()
    (tmp_path / "drift" / "net-1.json").write_text(json.dumps(DRIFT))
    (tmp_path / "index.json").write_text(json.dumps(INDEX))
    (tmp_path / "lost_gear.geojson").write_text('{"type":"FeatureCollection","features":[]}')
    (tmp_path / "beaching_2026-10-09.geojson").write_text('{"type":"FeatureCollection","features":[]}')
    (tmp_path / "tracks" / "net-1.json").write_text(json.dumps(TRACK))
    return TestClient(api.app)


def test_dates(client):
    assert client.get("/api/dates").json()["dates"] == ["2026-10-09"]


def test_gear_and_beaching(client):
    assert client.get("/api/gear").json()["type"] == "FeatureCollection"
    assert client.get("/api/beaching", params={"date": "2026-10-09"}).status_code == 200
    assert client.get("/api/beaching", params={"date": "2026-10-20"}).status_code == 404
    assert client.get("/api/beaching", params={"date": "not-a-date"}).status_code == 422


def test_track_trimmed_to_date(client):
    assert len(client.get("/api/net/net-1/track").json()["track"]) == 2
    assert len(client.get("/api/net/net-1/track", params={"date": "2026-10-09"}).json()["track"]) == 1


def test_track_rejects_bad_ids(client):
    assert client.get("/api/net/..%2Fsecret/track").status_code in (400, 404)
    assert client.get("/api/net/missing/track").status_code == 404


def test_cors_allows_vite_dev_server(client):
    r = client.get("/api/dates", headers={"Origin": "http://localhost:5173"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_drift_heat_cells(client):
    body = client.get("/api/drift", params={"ids": "net-1", "date": "2026-10-09"}).json()
    assert body["cell_deg"] == [0.05, 0.02]
    assert body["cells"] == [[70.01, 30.025, 1.0]]
    assert len(client.get("/api/drift", params={"ids": "net-1"}).json()["cells"]) == 2


def test_drift_rejects_bad_ids_and_ignores_unknown(client):
    assert client.get("/api/drift", params={"ids": "../x"}).status_code == 400
    assert client.get("/api/drift", params={"ids": "missing"}).json()["cells"] == []


def test_paths_endpoint(client, monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PATHS_DIR", tmp_path / "paths")
    (tmp_path / "paths").mkdir()
    net = {
        "start": "2026-10-09T00:00:00+00:00",
        "particles": [{"wdf": 0.02, "first": 0, "stranded": True, "coords": [[30.0, 70.0], [30.1, 70.1]]}],
    }
    (tmp_path / "paths" / "net-1.json").write_text(json.dumps(net))
    body = client.get("/api/paths", params={"ids": "net-1", "date": "2026-10-09"}).json()
    assert body["paths"] == [{"id": "net-1", "wdf": 0.02, "stranded": True, "coords": [[70.0, 30.0], [70.1, 30.1]]}]
    assert client.get("/api/paths", params={"ids": "bad/id"}).status_code == 400
