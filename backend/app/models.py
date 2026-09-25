"""Database models.

Clinical and school data are kept in their source tables (assessments, attendance,
incidents, SEL ratings). Goal progress is computed from those tables rather than
copied into a separate measurements table, so there is one source of truth.
"""

from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class District(Base):
    __tablename__ = "districts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    state: Mapped[str] = mapped_column(String(2))


class School(Base):
    __tablename__ = "schools"
    id: Mapped[int] = mapped_column(primary_key=True)
    district_id: Mapped[int] = mapped_column(ForeignKey("districts.id"))
    name: Mapped[str] = mapped_column(String(160))
    level: Mapped[str] = mapped_column(String(20))  # elementary | middle | high


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    district_id: Mapped[int] = mapped_column(ForeignKey("districts.id"))
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(20))  # counselor | admin | billing
    credentials: Mapped[str | None] = mapped_column(String(40))
    password_hash: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Student(Base):
    __tablename__ = "students"
    id: Mapped[int] = mapped_column(primary_key=True)
    district_id: Mapped[int] = mapped_column(ForeignKey("districts.id"))
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    district_student_id: Mapped[str] = mapped_column(String(20), unique=True)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    preferred_name: Mapped[str | None] = mapped_column(String(80))
    grade: Mapped[int] = mapped_column(Integer)
    date_of_birth: Mapped[date] = mapped_column(Date)
    ell: Mapped[bool] = mapped_column(Boolean, default=False)
    iep: Mapped[bool] = mapped_column(Boolean, default=False)
    has_504: Mapped[bool] = mapped_column(Boolean, default=False)
    primary_language: Mapped[str] = mapped_column(String(40), default="English")
    guardian_name: Mapped[str] = mapped_column(String(160))
    guardian_relationship: Mapped[str] = mapped_column(String(40))
    guardian_phone: Mapped[str] = mapped_column(String(30))
    guardian_email: Mapped[str | None] = mapped_column(String(200))
    medicaid_id: Mapped[str | None] = mapped_column(String(20))
    counselor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    school: Mapped[School] = relationship()
    counselor: Mapped[User | None] = relationship()


class Referral(Base):
    __tablename__ = "referrals"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    source: Mapped[str] = mapped_column(String(20))  # teacher | parent | screening | self | staff
    referred_by: Mapped[str] = mapped_column(String(160))
    reason: Mapped[str] = mapped_column(Text)
    concerns: Mapped[list] = mapped_column(JSON, default=list)
    urgency: Mapped[str] = mapped_column(String(20), default="routine")  # routine | priority | urgent
    status: Mapped[str] = mapped_column(String(20), default="new")  # new | accepted | declined
    assigned_counselor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decision_note: Mapped[str | None] = mapped_column(Text)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    student: Mapped[Student] = relationship()


class Case(Base):
    __tablename__ = "cases"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    counselor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    referral_id: Mapped[int | None] = mapped_column(ForeignKey("referrals.id"))
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | closed
    opened_at: Mapped[date] = mapped_column(Date)
    closed_at: Mapped[date | None] = mapped_column(Date)
    discharge_reason: Mapped[str | None] = mapped_column(Text)


class Consent(Base):
    __tablename__ = "consents"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    consent_type: Mapped[str] = mapped_column(
        String(40)
    )  # services | telehealth | medicaid_billing | release_of_information
    signer_name: Mapped[str] = mapped_column(String(160))
    signer_relationship: Mapped[str] = mapped_column(String(40))
    method: Mapped[str] = mapped_column(String(20))  # e_signature | paper | verbal
    signed_on: Mapped[date] = mapped_column(Date)
    expires_on: Mapped[date | None] = mapped_column(Date)
    revoked_on: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    recorded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Assessment(Base):
    __tablename__ = "assessments"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    instrument: Mapped[str] = mapped_column(String(10))  # PHQ9 | GAD7
    responses: Mapped[list] = mapped_column(JSON)
    total: Mapped[int] = mapped_column(Integer)
    severity: Mapped[str] = mapped_column(String(30))
    safety_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False)
    administered_on: Mapped[date] = mapped_column(Date, index=True)
    administered_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    notes: Mapped[str | None] = mapped_column(Text)


class TreatmentPlan(Base):
    __tablename__ = "treatment_plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"))
    presenting_concerns: Mapped[str] = mapped_column(Text)
    approach: Mapped[str] = mapped_column(String(120))
    service_frequency: Mapped[str] = mapped_column(String(80))
    start_date: Mapped[date] = mapped_column(Date)
    review_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | completed
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    goals: Mapped[list["Goal"]] = relationship(back_populates="plan", order_by="Goal.id")


class Goal(Base):
    __tablename__ = "goals"
    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("treatment_plans.id"))
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    domain: Mapped[str] = mapped_column(String(20))  # mental_health | academic_sel | behavioral | attendance
    description: Mapped[str] = mapped_column(Text)
    metric: Mapped[str] = mapped_column(String(30))  # phq9 | gad7 | attendance_rate | behavior_incidents | sel_rating
    comparator: Mapped[str] = mapped_column(String(3))  # lt | lte | gt | gte
    target_value: Mapped[float] = mapped_column(Float)
    baseline_value: Mapped[float] = mapped_column(Float)
    baseline_date: Mapped[date] = mapped_column(Date)
    tracking: Mapped[str] = mapped_column(String(10))  # daily | weekly | monthly
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | met | discontinued

    plan: Mapped[TreatmentPlan] = relationship(back_populates="goals")


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"))
    counselor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    session_type: Mapped[str] = mapped_column(String(20))  # individual | group | family | crisis | intake
    modality: Mapped[str] = mapped_column(String(20))  # in_person | telehealth
    scheduled_start: Mapped[datetime] = mapped_column(DateTime, index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="scheduled")  # scheduled | completed | cancelled | no_show
    location: Mapped[str | None] = mapped_column(String(120))
    billing_status: Mapped[str] = mapped_column(String(20), default="unbilled")  # unbilled | exported
    billing_export_id: Mapped[int | None] = mapped_column(ForeignKey("billing_exports.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    student: Mapped[Student] = relationship()
    counselor: Mapped[User] = relationship()
    note: Mapped["SessionNote | None"] = relationship(back_populates="session", uselist=False)


class SessionNote(Base):
    """DAP note. Locked once signed; later changes go into addenda."""

    __tablename__ = "session_notes"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), unique=True)
    data: Mapped[str] = mapped_column(Text, default="")
    assessment: Mapped[str] = mapped_column(Text, default="")
    plan: Mapped[str] = mapped_column(Text, default="")
    interventions: Mapped[list] = mapped_column(JSON, default=list)
    goal_ids: Mapped[list] = mapped_column(JSON, default=list)
    risk_level: Mapped[str] = mapped_column(String(20), default="none")  # none | low | elevated
    signed_at: Mapped[datetime | None] = mapped_column(DateTime)
    signed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    session: Mapped[Session] = relationship(back_populates="note")
    addenda: Mapped[list["NoteAddendum"]] = relationship(order_by="NoteAddendum.created_at")


class NoteAddendum(Base):
    __tablename__ = "note_addenda"
    id: Mapped[int] = mapped_column(primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("session_notes.id"))
    text: Mapped[str] = mapped_column(Text)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AttendanceRecord(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("student_id", "day"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(10))  # present | absent | tardy | excused


class BehaviorIncident(Base):
    __tablename__ = "behavior_incidents"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    occurred_on: Mapped[date] = mapped_column(Date)
    category: Mapped[str] = mapped_column(String(60))
    severity: Mapped[str] = mapped_column(String(10))  # minor | major
    description: Mapped[str] = mapped_column(Text)
    reported_by: Mapped[str] = mapped_column(String(160))


class NurseVisit(Base):
    __tablename__ = "nurse_visits"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    visited_on: Mapped[date] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(String(120))
    outcome: Mapped[str] = mapped_column(String(40))  # returned_to_class | sent_home | parent_contacted


class GradeRecord(Base):
    __tablename__ = "grades"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    school_year: Mapped[str] = mapped_column(String(9))  # 2025-26
    term: Mapped[str] = mapped_column(String(20))  # Q1..Q4 | Final
    gpa: Mapped[float] = mapped_column(Float)
    recorded_on: Mapped[date] = mapped_column(Date)


class SELRating(Base):
    __tablename__ = "sel_ratings"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    rated_on: Mapped[date] = mapped_column(Date)
    rating: Mapped[str] = mapped_column(String(10))  # red | yellow | green
    rater: Mapped[str] = mapped_column(String(160))
    comment: Mapped[str | None] = mapped_column(Text)


class BillingExport(Base):
    __tablename__ = "billing_exports"
    id: Mapped[int] = mapped_column(primary_key=True)
    district_id: Mapped[int] = mapped_column(ForeignKey("districts.id"))
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    line_count: Mapped[int] = mapped_column(Integer)
    total_units: Mapped[int] = mapped_column(Integer)
    csv_content: Mapped[str] = mapped_column(Text)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(30))  # login | view | create | update | sign | export | revoke
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id"), index=True)
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    user: Mapped[User | None] = relationship()
