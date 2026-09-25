from datetime import date

import pytest

from app.clinical import ScoringError, meets, progress_fraction, school_year_of, score


@pytest.mark.parametrize(
    "total,label",
    [
        (0, "Minimal"),
        (4, "Minimal"),
        (5, "Mild"),
        (9, "Mild"),
        (10, "Moderate"),
        (14, "Moderate"),
        (15, "Moderately severe"),
        (19, "Moderately severe"),
        (20, "Severe"),
        (27, "Severe"),
    ],
)
def test_phq9_bands(total, label):
    responses = [0] * 9
    remaining = total
    for i in range(8):  # keep item 9 at zero
        responses[i] = min(3, remaining)
        remaining -= responses[i]
    if remaining:
        responses[8] = remaining
    assert score("PHQ9", responses)["severity"] == label


def test_gad7_bands():
    assert score("GAD7", [2, 2, 2, 2, 2, 2, 2])["severity"] == "Moderate"
    assert score("GAD7", [3, 3, 3, 3, 3, 0, 0])["severity"] == "Severe"


def test_item_nine_sets_safety_flag():
    assert score("PHQ9", [0, 0, 0, 0, 0, 0, 0, 0, 1])["safety_flag"] is True
    assert score("PHQ9", [3, 3, 3, 3, 3, 3, 3, 3, 0])["safety_flag"] is False
    assert score("GAD7", [3] * 7)["safety_flag"] is False


@pytest.mark.parametrize("responses", [[0] * 8, [0] * 10, [0, 0, 0, 0, 0, 0, 0, 0, 4], [-1] + [0] * 8])
def test_invalid_responses(responses):
    with pytest.raises(ScoringError):
        score("PHQ9", responses)


def test_progress_decreasing_goal():
    # PHQ-9 from 16 toward "below 10": halfway at 13, met at 9.
    assert progress_fraction(16, 13, 10, "lt") == pytest.approx(0.5)
    assert progress_fraction(16, 9, 10, "lt") == 1.0
    assert progress_fraction(16, 18, 10, "lt") == 0.0


def test_progress_increasing_goal():
    assert progress_fraction(80, 85, 90, "gte") == pytest.approx(0.5)
    assert progress_fraction(80, 90, 90, "gte") == 1.0


def test_progress_when_baseline_already_met():
    assert progress_fraction(95, 92, 90, "gte") == 1.0
    assert progress_fraction(95, 88, 90, "gte") == 0.0


def test_comparators():
    assert meets("lt", 9, 10) and not meets("lt", 10, 10)
    assert meets("lte", 2, 2) and meets("gte", 90, 90)


def test_school_year():
    assert school_year_of(date(2026, 9, 25)) == "2026-27"
    assert school_year_of(date(2027, 3, 1)) == "2026-27"
    assert school_year_of(date(2026, 7, 31)) == "2025-26"
