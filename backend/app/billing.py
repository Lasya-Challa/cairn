"""Medicaid billing readiness.

Each completed session becomes a billing line. A line is ready to export only when
the documentation behind it is complete. The checks mirror what school-based
Medicaid audits look for; exact rules and codes vary by state, so treat the code
table as a configurable default rather than a statement of any state's policy.
"""

import csv
import io
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DB
from sqlalchemy.orm import selectinload

from . import clock
from .models import Consent, Session, Student

# session_type -> (code, description, minimum minutes)
SERVICE_CODES = {
    "intake": ("90791", "Psychiatric diagnostic evaluation", 16),
    "individual": (None, "Individual psychotherapy", 16),  # resolved by duration
    "family": ("90847", "Family psychotherapy with student present", 26),
    "group": ("90853", "Group psychotherapy", 16),
    "crisis": ("90839", "Psychotherapy for crisis", 30),
}


def individual_code(minutes: int) -> str:
    if minutes >= 53:
        return "90837"
    if minutes >= 38:
        return "90834"
    return "90832"


def service_code(session: Session) -> tuple[str | None, str]:
    code, description, _ = SERVICE_CODES.get(session.session_type, (None, "Not billable", 0))
    if session.session_type == "individual":
        code = individual_code(session.duration_minutes)
    return code, description


def place_of_service(session: Session) -> str:
    # 03 = school, 02 = telehealth outside the student's home
    return "02" if session.modality == "telehealth" else "03"


def consent_active(consents: list[Consent], consent_type: str, on: date) -> bool:
    for c in consents:
        if c.consent_type != consent_type:
            continue
        if c.signed_on > on:
            continue
        if c.expires_on and on > c.expires_on:
            continue
        if c.revoked_on and on >= c.revoked_on:
            continue
        return True
    return False


def line_issues(session: Session, student: Student, consents: list[Consent]) -> list[str]:
    issues: list[str] = []
    on = clock.local_date(session.scheduled_start)
    _, _, minimum = SERVICE_CODES.get(session.session_type, (None, "", 0))

    if session.session_type not in SERVICE_CODES:
        issues.append("Session type is not billable")
    if session.note is None or session.note.signed_at is None:
        issues.append("Session note is not signed")
    if not consent_active(consents, "services", on):
        issues.append("No active consent for services on the session date")
    if not consent_active(consents, "medicaid_billing", on):
        issues.append("No active consent to bill Medicaid on the session date")
    if session.modality == "telehealth" and not consent_active(consents, "telehealth", on):
        issues.append("No active telehealth consent on the session date")
    if minimum and session.duration_minutes < minimum:
        issues.append(f"Duration under the {minimum}-minute minimum for this service")
    return issues


def billing_lines(db: DB, district_id: int, start: date, end: date, school_id: int | None = None) -> list[dict]:
    query = (
        select(Session)
        .join(Student, Session.student_id == Student.id)
        .where(
            Student.district_id == district_id,
            Session.status == "completed",
            Session.scheduled_start >= clock.local_day_start(start),
            Session.scheduled_start < clock.local_day_start(end + timedelta(days=1)),
        )
        .options(
            selectinload(Session.note),
            selectinload(Session.student).selectinload(Student.school),
            selectinload(Session.counselor),
        )
        .order_by(Session.scheduled_start)
    )
    if school_id:
        query = query.where(Student.school_id == school_id)
    sessions = db.scalars(query).all()

    student_ids = {s.student_id for s in sessions}
    consents_by_student: dict[int, list[Consent]] = {sid: [] for sid in student_ids}
    if student_ids:
        for c in db.scalars(select(Consent).where(Consent.student_id.in_(student_ids))):
            consents_by_student[c.student_id].append(c)

    lines = []
    for s in sessions:
        code, description = service_code(s)
        issues = line_issues(s, s.student, consents_by_student.get(s.student_id, []))
        if s.billing_status == "exported":
            state = "exported"
        elif not s.student.medicaid_id:
            # Only Medicaid-enrolled students are billed; others are listed for completeness.
            state = "not_eligible"
            issues = []
        else:
            state = "blocked" if issues else "ready"
        lines.append(
            {
                "session_id": s.id,
                "service_date": clock.local_date(s.scheduled_start),
                "student_id": s.student_id,
                "student_name": f"{s.student.last_name}, {s.student.first_name}",
                "district_student_id": s.student.district_student_id,
                "medicaid_id": s.student.medicaid_id,
                "school": s.student.school.name,
                "provider": s.counselor.full_name,
                "provider_credentials": s.counselor.credentials,
                "session_type": s.session_type,
                "modality": s.modality,
                "duration_minutes": s.duration_minutes,
                "service_code": code,
                "service_description": description,
                "modifier": "95" if s.modality == "telehealth" else None,
                "place_of_service": place_of_service(s),
                "units": 1,
                "state": state,
                "issues": issues,
                "billing_export_id": s.billing_export_id,
            }
        )
    return lines


CSV_COLUMNS = [
    "service_date",
    "medicaid_id",
    "district_student_id",
    "student_name",
    "school",
    "provider",
    "provider_credentials",
    "service_code",
    "modifier",
    "place_of_service",
    "units",
    "duration_minutes",
    "session_id",
]


def to_csv(lines: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for line in lines:
        writer.writerow({**line, "service_date": line["service_date"].isoformat()})
    return buf.getvalue()
