from datetime import UTC, datetime, timedelta

from castaway import config


def _window(start: datetime) -> config.Window:
    return config.Window(start=start, forecast_start=start + timedelta(days=7), end=start + timedelta(days=10))


def test_first_day_is_next_midnight_after_spinup(monkeypatch):
    monkeypatch.setattr(config, "SPINUP_HOURS", 24)
    w = _window(datetime(2026, 10, 1, 21, tzinfo=UTC))
    assert w.first_day == datetime(2026, 10, 3, tzinfo=UTC)


def test_first_day_when_spinup_ends_at_midnight(monkeypatch):
    monkeypatch.setattr(config, "SPINUP_HOURS", 24)
    w = _window(datetime(2026, 10, 1, 0, tzinfo=UTC))
    assert w.first_day == datetime(2026, 10, 2, tzinfo=UTC)


def test_run_window_spans_hindcast_and_forecast():
    now = datetime(2026, 10, 8, 21, tzinfo=UTC)
    w = config.run_window(now)
    assert w.end - w.start == timedelta(days=config.HINDCAST_DAYS + config.FORECAST_DAYS)
    assert w.forecast_start == now
