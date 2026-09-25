"""Instrument scoring, school-year helpers and goal progress.

Scoring bands follow the published PHQ-9 and GAD-7 scoring guides (both
instruments are free to reproduce). Goal progress is derived from source data.
"""

from collections import OrderedDict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Assessment, AttendanceRecord, BehaviorIncident, Goal, SELRating

RESPONSE_OPTIONS = [
    {"value": 0, "label": "Not at all"},
    {"value": 1, "label": "Several days"},
    {"value": 2, "label": "More than half the days"},
    {"value": 3, "label": "Nearly every day"},
]

INSTRUMENTS = {
    "PHQ9": {
        "code": "PHQ9",
        "name": "PHQ-9",
        "measures": "Depression",
        "stem": "Over the last 2 weeks, how often have you been bothered by any of the following problems?",
        "items": [
            "Little interest or pleasure in doing things",
            "Feeling down, depressed, or hopeless",
            "Trouble falling or staying asleep, or sleeping too much",
            "Feeling tired or having little energy",
            "Poor appetite or overeating",
            "Feeling bad about yourself, or that you are a failure or have let yourself or your family down",
            "Trouble concentrating on things, such as reading or watching television",
            "Moving or speaking so slowly that other people could have noticed, or the opposite: being so fidgety or restless that you have been moving around a lot more than usual",
            "Thoughts that you would be better off dead, or of hurting yourself in some way",
        ],
        "bands": [
            (0, 4, "Minimal"),
            (5, 9, "Mild"),
            (10, 14, "Moderate"),
            (15, 19, "Moderately severe"),
            (20, 27, "Severe"),
        ],
        "max": 27,
        "safety_item": 8,  # zero-based index of item 9
    },
    "GAD7": {
        "code": "GAD7",
        "name": "GAD-7",
        "measures": "Anxiety",
        "stem": "Over the last 2 weeks, how often have you been bothered by the following problems?",
        "items": [
            "Feeling nervous, anxious, or on edge",
            "Not being able to stop or control worrying",
            "Worrying too much about different things",
            "Trouble relaxing",
            "Being so restless that it is hard to sit still",
            "Becoming easily annoyed or irritable",
            "Feeling afraid, as if something awful might happen",
        ],
        "bands": [
            (0, 4, "Minimal"),
            (5, 9, "Mild"),
            (10, 14, "Moderate"),
            (15, 21, "Severe"),
        ],
        "max": 21,
        "safety_item": None,
    },
}


class ScoringError(ValueError):
    pass


def score(instrument: str, responses: list[int]) -> dict:
    spec = INSTRUMENTS.get(instrument)
    if spec is None:
        raise ScoringError(f"Unknown instrument {instrument}.")
    if len(responses) != len(spec["items"]):
        raise ScoringError(f"{spec['name']} needs {len(spec['items'])} responses, got {len(responses)}.")
    if any(r not in (0, 1, 2, 3) for r in responses):
        raise ScoringError("Each response must be 0, 1, 2 or 3.")
    total = sum(responses)
    severity = next(label for lo, hi, label in spec["bands"] if lo <= total <= hi)
    safety_idx = spec["safety_item"]
    safety_flag = safety_idx is not None and responses[safety_idx] > 0
    return {"total": total, "severity": severity, "safety_flag": safety_flag}


def severity_for(instrument: str, total: float) -> str:
    for lo, hi, label in INSTRUMENTS[instrument]["bands"]:
        if lo <= total <= hi:
            return label
    return ""


# ---------- school year ----------


def school_year_of(d: date) -> str:
    start = d.year if d.month >= 8 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def school_year_bounds(label: str) -> tuple[date, date]:
    start = int(label[:4])
    return date(start, 8, 1), date(start + 1, 7, 31)


# ---------- metrics ----------

METRICS = {
    "phq9": {"label": "PHQ-9", "unit": "score", "direction": "down"},
    "gad7": {"label": "GAD-7", "unit": "score", "direction": "down"},
    "attendance_rate": {"label": "Attendance", "unit": "%", "direction": "up"},
    "behavior_incidents": {"label": "Behavior incidents", "unit": "per month", "direction": "down"},
    "sel_rating": {"label": "Academic/SEL rating", "unit": "rating", "direction": "up"},
}

SEL_VALUE = {"red": 1, "yellow": 2, "green": 3}
SEL_LABEL = {1: "red", 2: "yellow", 3: "green"}
PRESENT = ("present", "tardy")


def _month_key(d: date) -> date:
    return d.replace(day=1)


def attendance_by_month(db: Session, student_id: int, since: date) -> "OrderedDict[date, tuple[int, int]]":
    rows = db.execute(
        select(AttendanceRecord.day, AttendanceRecord.status)
        .where(AttendanceRecord.student_id == student_id, AttendanceRecord.day >= since)
        .order_by(AttendanceRecord.day)
    ).all()
    months: OrderedDict[date, list[int]] = OrderedDict()
    for day, status in rows:
        bucket = months.setdefault(_month_key(day), [0, 0])
        bucket[1] += 1
        if status in PRESENT:
            bucket[0] += 1
    return OrderedDict((k, (v[0], v[1])) for k, v in months.items())


def metric_series(db: Session, student_id: int, metric: str, since: date) -> list[dict]:
    """Time series for a metric: [{date, value}] ordered by date."""
    if metric in ("phq9", "gad7"):
        rows = db.execute(
            select(Assessment.administered_on, Assessment.total)
            .where(
                Assessment.student_id == student_id,
                Assessment.instrument == metric.upper(),
                Assessment.administered_on >= since,
            )
            .order_by(Assessment.administered_on)
        ).all()
        return [{"date": d, "value": float(t)} for d, t in rows]

    if metric == "attendance_rate":
        return [
            {"date": month, "value": round(100 * present / total, 1)}
            for month, (present, total) in attendance_by_month(db, student_id, since).items()
            if total
        ]

    if metric == "behavior_incidents":
        school_months = attendance_by_month(db, student_id, since).keys()
        counts = {m: 0 for m in school_months}
        for (d,) in db.execute(
            select(BehaviorIncident.occurred_on).where(
                BehaviorIncident.student_id == student_id, BehaviorIncident.occurred_on >= since
            )
        ):
            counts[_month_key(d)] = counts.get(_month_key(d), 0) + 1
        return [{"date": m, "value": float(c)} for m, c in sorted(counts.items())]

    if metric == "sel_rating":
        rows = db.execute(
            select(SELRating.rated_on, SELRating.rating)
            .where(SELRating.student_id == student_id, SELRating.rated_on >= since)
            .order_by(SELRating.rated_on)
        ).all()
        return [{"date": d, "value": float(SEL_VALUE[r])} for d, r in rows]

    raise ValueError(f"Unknown metric {metric}")


def current_value(db: Session, student_id: int, metric: str, today: date) -> tuple[float | None, date | None]:
    """The value a goal is judged against right now."""
    if metric in ("phq9", "gad7", "sel_rating"):
        series = metric_series(db, student_id, metric, today - timedelta(days=400))
        if not series:
            return None, None
        return series[-1]["value"], series[-1]["date"]

    if metric == "attendance_rate":
        # Rate over the most recent 20 recorded school days.
        rows = db.execute(
            select(AttendanceRecord.day, AttendanceRecord.status)
            .where(AttendanceRecord.student_id == student_id, AttendanceRecord.day <= today)
            .order_by(AttendanceRecord.day.desc())
            .limit(20)
        ).all()
        if not rows:
            return None, None
        present = sum(1 for _, s in rows if s in PRESENT)
        return round(100 * present / len(rows), 1), rows[0][0]

    if metric == "behavior_incidents":
        # Incidents in the last 30 calendar days.
        since = today - timedelta(days=30)
        count = len(
            db.execute(
                select(BehaviorIncident.id).where(
                    BehaviorIncident.student_id == student_id,
                    BehaviorIncident.occurred_on > since,
                    BehaviorIncident.occurred_on <= today,
                )
            ).all()
        )
        return float(count), today

    raise ValueError(f"Unknown metric {metric}")


def meets(comparator: str, value: float, target: float) -> bool:
    return {
        "lt": value < target,
        "lte": value <= target,
        "gt": value > target,
        "gte": value >= target,
    }[comparator]


def progress_fraction(baseline: float, current: float, target: float, comparator: str) -> float:
    """Share of the distance from baseline to target that has been covered, 0 to 1.

    A goal that is met counts as 1. If the baseline already met the target there is
    no distance to cover, so the result is 1 when still met and 0 otherwise.
    """
    if meets(comparator, current, target):
        return 1.0
    distance = target - baseline
    if distance == 0 or meets(comparator, baseline, target):
        return 0.0
    covered = (current - baseline) / distance
    return max(0.0, min(1.0, covered))


def goal_target_text(goal: Goal) -> str:
    symbol = {"lt": "below", "lte": "at most", "gt": "above", "gte": "at least"}[goal.comparator]
    t = goal.target_value
    if goal.metric == "sel_rating":
        return f"{symbol} {SEL_LABEL.get(int(t), t)}"
    if goal.metric == "attendance_rate":
        return f"{symbol} {t:g}%"
    if goal.metric == "behavior_incidents":
        return f"{symbol} {t:g} per month"
    return f"{symbol} {t:g}"


def evaluate_goal(db: Session, goal: Goal, today: date) -> dict:
    value, as_of = current_value(db, goal.student_id, goal.metric, today)
    series = metric_series(db, goal.student_id, goal.metric, goal.baseline_date)
    direction = METRICS[goal.metric]["direction"]

    # Trend compares the latest measure with the one before it. With a single
    # measure since the plan started, the comparison point is the baseline.
    trend = "no_data"
    if value is not None:
        previous = series[-2]["value"] if len(series) >= 2 else goal.baseline_value
        latest = series[-1]["value"] if series else value
        delta = latest - previous
        if abs(delta) < 1e-9:
            trend = "steady"
        elif (delta < 0) == (direction == "down"):
            trend = "improving"
        else:
            trend = "worsening"

    fraction = (
        None if value is None else progress_fraction(goal.baseline_value, value, goal.target_value, goal.comparator)
    )
    return {
        "current_value": value,
        "as_of": as_of,
        "met": value is not None and meets(goal.comparator, value, goal.target_value),
        "progress": None if fraction is None else round(fraction, 3),
        "trend": trend,
        "target_text": goal_target_text(goal),
        "series": series,
    }
