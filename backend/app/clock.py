from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from .config import get_settings


def now() -> datetime:
    """Naive UTC now. All stored timestamps are naive UTC."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def today() -> date:
    """Today's date in the district's time zone."""
    return datetime.now(ZoneInfo(get_settings().district_timezone)).date()


def to_naive_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def tz() -> ZoneInfo:
    return ZoneInfo(get_settings().district_timezone)


def local_day_start(d: date) -> datetime:
    """Midnight at the start of district-local day d, as naive UTC."""
    return to_naive_utc(datetime.combine(d, datetime.min.time(), tzinfo=tz()))


def local_date(utc_naive: datetime) -> date:
    """District-local calendar date of a stored naive-UTC timestamp."""
    return utc_naive.replace(tzinfo=timezone.utc).astimezone(tz()).date()
