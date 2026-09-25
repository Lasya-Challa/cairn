from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .clock import to_naive_utc

Role = Literal["counselor", "admin", "billing"]
ReferralSource = Literal["teacher", "parent", "screening", "self", "staff"]
Urgency = Literal["routine", "priority", "urgent"]
SessionType = Literal["individual", "group", "family", "crisis", "intake"]
Modality = Literal["in_person", "telehealth"]
SessionStatus = Literal["scheduled", "completed", "cancelled", "no_show"]
ConsentType = Literal["services", "telehealth", "medicaid_billing", "release_of_information"]
Metric = Literal["phq9", "gad7", "attendance_rate", "behavior_incidents", "sel_rating"]
Domain = Literal["mental_health", "academic_sel", "behavioral", "attendance"]
Comparator = Literal["lt", "lte", "gt", "gte"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth ----------


class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(ORM):
    id: int
    email: str
    full_name: str
    role: Role
    credentials: str | None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- students ----------


class SchoolOut(ORM):
    id: int
    name: str
    level: str


class StudentSummary(BaseModel):
    id: int
    district_student_id: str
    first_name: str
    last_name: str
    preferred_name: str | None
    grade: int
    school: SchoolOut
    ell: bool
    iep: bool
    has_504: bool
    counselor: UserOut | None
    case_status: str | None
    latest_phq9: dict | None
    latest_gad7: dict | None
    next_session: datetime | None
    alerts: list[str]


class StudentDetail(ORM):
    id: int
    district_student_id: str
    first_name: str
    last_name: str
    preferred_name: str | None
    grade: int
    date_of_birth: date
    school: SchoolOut
    ell: bool
    iep: bool
    has_504: bool
    primary_language: str
    guardian_name: str
    guardian_relationship: str
    guardian_phone: str
    guardian_email: str | None
    medicaid_id: str | None
    counselor: UserOut | None


# ---------- referrals ----------


class ReferralIn(BaseModel):
    student_id: int
    source: ReferralSource
    referred_by: str = Field(min_length=2, max_length=160)
    reason: str = Field(min_length=10)
    concerns: list[str] = []
    urgency: Urgency = "routine"


class ReferralDecision(BaseModel):
    action: Literal["accept", "decline"]
    counselor_id: int | None = None
    note: str | None = None


# ---------- assessments ----------


class AssessmentIn(BaseModel):
    instrument: Literal["PHQ9", "GAD7"]
    responses: list[int]
    administered_on: date
    is_baseline: bool = False
    notes: str | None = None


class AssessmentOut(ORM):
    id: int
    instrument: str
    responses: list[int]
    total: int
    severity: str
    safety_flag: bool
    is_baseline: bool
    administered_on: date
    notes: str | None


# ---------- plans and goals ----------


class GoalIn(BaseModel):
    domain: Domain
    description: str = Field(min_length=5)
    metric: Metric
    comparator: Comparator
    target_value: float
    baseline_value: float
    baseline_date: date
    tracking: Literal["daily", "weekly", "monthly"]


class GoalUpdate(BaseModel):
    description: str | None = None
    comparator: Comparator | None = None
    target_value: float | None = None
    status: Literal["active", "met", "discontinued"] | None = None


class PlanIn(BaseModel):
    presenting_concerns: str = Field(min_length=10)
    approach: str
    service_frequency: str
    start_date: date
    review_date: date
    goals: list[GoalIn] = []

    @field_validator("review_date")
    @classmethod
    def review_after_start(cls, v: date, info):
        start = info.data.get("start_date")
        if start and v <= start:
            raise ValueError("Review date must be after the start date.")
        return v


# ---------- consents ----------


class ConsentIn(BaseModel):
    consent_type: ConsentType
    signer_name: str = Field(min_length=2)
    signer_relationship: str
    method: Literal["e_signature", "paper", "verbal"]
    signed_on: date
    expires_on: date | None = None
    notes: str | None = None


class ConsentOut(ORM):
    id: int
    consent_type: str
    signer_name: str
    signer_relationship: str
    method: str
    signed_on: date
    expires_on: date | None
    revoked_on: date | None
    notes: str | None


# ---------- sessions and notes ----------


class SessionIn(BaseModel):
    student_id: int
    session_type: SessionType
    modality: Modality = "in_person"
    scheduled_start: datetime
    duration_minutes: int = Field(ge=5, le=180)
    location: str | None = None

    _utc = field_validator("scheduled_start")(classmethod(lambda cls, v: to_naive_utc(v)))


class SessionUpdate(BaseModel):
    status: SessionStatus | None = None
    scheduled_start: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=180)
    modality: Modality | None = None
    location: str | None = None

    _utc = field_validator("scheduled_start")(classmethod(lambda cls, v: v and to_naive_utc(v)))


class NoteIn(BaseModel):
    data: str = ""
    assessment: str = ""
    plan: str = ""
    interventions: list[str] = []
    goal_ids: list[int] = []
    risk_level: Literal["none", "low", "elevated"] = "none"


class AddendumIn(BaseModel):
    text: str = Field(min_length=3)


# ---------- billing ----------


class ExportIn(BaseModel):
    period_start: date
    period_end: date
    session_ids: list[int] = Field(min_length=1)
