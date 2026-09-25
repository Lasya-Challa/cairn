from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .clinical import school_year_bounds, school_year_of
from .models import (
    Assessment,
    Case,
    Consent,
    SessionNote,
    Student,
    TreatmentPlan,
)
from .models import (
    Session as ClinicalSession,
)


def short_date(d: date) -> str:
    """Portable "Sep 4" formatting (strftime %-d is not available on Windows)."""
    return f"{d:%b} {d.day}"


CONSENT_LABELS = {
    "services": "services",
    "telehealth": "telehealth",
    "medicaid_billing": "Medicaid billing",
    "release_of_information": "release of information",
}


def open_case(db: Session, student_id: int) -> Case | None:
    return db.scalar(
        select(Case).where(Case.student_id == student_id, Case.status == "open").order_by(Case.opened_at.desc())
    )


def active_plan(db: Session, student_id: int) -> TreatmentPlan | None:
    return db.scalar(
        select(TreatmentPlan)
        .where(TreatmentPlan.student_id == student_id, TreatmentPlan.status == "active")
        .order_by(TreatmentPlan.start_date.desc())
    )


def latest_assessment(db: Session, student_id: int, instrument: str) -> Assessment | None:
    return db.scalar(
        select(Assessment)
        .where(Assessment.student_id == student_id, Assessment.instrument == instrument)
        .order_by(Assessment.administered_on.desc(), Assessment.id.desc())
    )


def student_alerts(db: Session, student: Student, today: date, now: datetime) -> list[dict]:
    alerts: list[dict] = []
    phq = latest_assessment(db, student.id, "PHQ9")
    if phq and phq.safety_flag:
        alerts.append(
            {
                "kind": "safety",
                "level": "high",
                "text": f"PHQ-9 item 9 was endorsed on {short_date(phq.administered_on)}. Follow the district risk protocol.",
            }
        )

    elevated = db.scalar(
        select(SessionNote)
        .join(ClinicalSession, SessionNote.session_id == ClinicalSession.id)
        .where(ClinicalSession.student_id == student.id, ClinicalSession.status == "completed")
        .order_by(ClinicalSession.scheduled_start.desc())
    )
    if elevated and elevated.risk_level == "elevated":
        alerts.append({"kind": "safety", "level": "high", "text": "Most recent session note records elevated risk."})

    unsigned = db.scalar(
        select(func.count(ClinicalSession.id))
        .outerjoin(SessionNote, SessionNote.session_id == ClinicalSession.id)
        .where(
            ClinicalSession.student_id == student.id,
            ClinicalSession.status == "completed",
            ClinicalSession.scheduled_start < now - timedelta(hours=48),
            SessionNote.signed_at.is_(None),
        )
    )
    if unsigned:
        noun = "note is" if unsigned == 1 else "notes are"
        alerts.append(
            {"kind": "documentation", "level": "medium", "text": f"{unsigned} session {noun} unsigned after 48 hours."}
        )

    case = open_case(db, student.id)
    if case:
        consents = db.scalars(select(Consent).where(Consent.student_id == student.id)).all()
        active = [
            c
            for c in consents
            if c.signed_on <= today and not c.revoked_on and (c.expires_on is None or c.expires_on >= today)
        ]
        if not any(c.consent_type == "services" for c in active):
            alerts.append({"kind": "consent", "level": "high", "text": "No active consent for services."})
        for c in active:
            if c.expires_on and c.expires_on <= today + timedelta(days=30):
                alerts.append(
                    {
                        "kind": "consent",
                        "level": "medium",
                        "text": f"Consent for {CONSENT_LABELS[c.consent_type]} expires {short_date(c.expires_on)}.",
                    }
                )
        plan = active_plan(db, student.id)
        if plan is None:
            alerts.append({"kind": "plan", "level": "medium", "text": "Open case has no active treatment plan."})
        elif plan.review_date < today:
            alerts.append(
                {
                    "kind": "plan",
                    "level": "medium",
                    "text": f"Treatment plan review was due {short_date(plan.review_date)}.",
                }
            )
    return alerts


def current_school_year(today: date) -> tuple[str, date, date]:
    label = school_year_of(today)
    start, end = school_year_bounds(label)
    return label, start, end
