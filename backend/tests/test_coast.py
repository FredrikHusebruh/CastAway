from castaway import config
from castaway.aggregate import cell_size_deg
from castaway.coast import coast_cells

# Kristiansand harbour mouth: Odderøya (land) next to the fjord (sea)
HARBOUR = (7.99, 58.135)
OPEN_SEA = (7.6, 57.8)  # Skagerrak, ~30 km offshore


def _cell(lon: float, lat: float, cell_deg: tuple[float, float]) -> list[int]:
    return [int(lon // cell_deg[0]), int(lat // cell_deg[1])]


def test_coast_cells_trace_the_coast():
    bbox = config.BBox(7.5, 57.75, 8.2, 58.2)
    cell_deg = cell_size_deg(bbox.center[1])
    coast = coast_cells(bbox, cell_deg)
    cells = {tuple(c) for c in coast["cells"]}
    assert coast["cell_deg"] == list(cell_deg)
    i, j = _cell(*HARBOUR, cell_deg)
    assert any((i + di, j + dj) in cells for di in (-1, 0, 1) for dj in (-1, 0, 1))
    assert tuple(_cell(*OPEN_SEA, cell_deg)) not in cells
    assert 50 < len(cells) < 3000


def test_coast_cells_reach_beyond_the_region():
    # the region's west edge cuts through the coast: cells just outside it must be included
    bbox = config.BBox(8.0, 58.0, 8.2, 58.2)
    cell_deg = cell_size_deg(bbox.center[1])
    coast = coast_cells(bbox, cell_deg)
    assert coast["bbox"][0] < bbox.west
    assert any(i * cell_deg[0] < bbox.west for i, _ in coast["cells"])
