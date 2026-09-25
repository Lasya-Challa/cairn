from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from .. import clock
from ..clinical import (
    METRICS,
    SEL_LABEL,
    attendance_by_month,
    evaluate_goal,
    metric_series,
    school_year_bounds,
    school_year_of,
    severity_for,
)
from ..db import get_db
from ..models import (
    Assessment,
    BehaviorIncident,
    Case,
    Consent,
    GradeRecord,
    NurseVisit,
    Referral,
    SELRating,
    Student,
    TreatmentPlan,
    User,
)
from ..models import (
    Session as ClinicalSession,
)
from ..queries import active_plan, latest_assessment, open_case, student_alerts
from ..schemas import SchoolOut, StudentDetail, StudentSummary, UserOut
from ..security import CLINICAL_ROLES, audit, get_student_for_user, require_roles

router = APIRouter(prefix="/api/students", tags=["students"])
clinical_user = require_roles(*CLINICAL_ROLES)


def _assessment_brief(a: Assessment | None) -> dict | None:
    if a is None:
        return None
    return {"total": a.total, "severity": a.severity, "date": a.administered_on, "safety_flag": a.safety_flag}


@router.get("", response_model=list[StudentSummary])
def list_students(
    q: str | None = None,
    school_id: int | None = None,
    flag: str | None = Query(None, pattern="^(iep|ell|504)$"),
    user: User = Depends(clinical_user),
    db: Session = Depends(get_db),
):
    query = (
        select(Student)
        .where(Student.district_id == user.district_id)
        .options(selectinload(Student.school), selectinload(Student.counselor))
        .order_by(Student.last_name, Student.first_name)
    )
    if user.role == "counselor":
        query = query.where(Student.counselor_id == user.id)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            or_(
                Student.first_name.ilike(like),
                Student.last_name.ilike(like),
                Student.preferred_name.ilike(like),
                Student.district_student_id.ilike(like),
            )
        )
    if school_id:
        query = query.where(Student.school_id == school_id)
    if flag == "iep":
        query = query.where(Student.iep.is_(True))
    elif flag == "ell":
        query = query.where(Student.ell.is_(True))
    elif flag == "504":
        query = query.where(Student.has_504.is_(True))

    today, now = clock.today(), clock.now()
    out = []
    for s in db.scalars(query):
        case = open_case(db, s.id)
        next_session = db.scalar(
            select(ClinicalSession.scheduled_start)
            .where(
                ClinicalSession.student_id == s.id,
                ClinicalSession.status == "scheduled",
                ClinicalSession.scheduled_start >= now,
            )
            .order_by(ClinicalSession.scheduled_start)
        )
        out.append(
            StudentSummary(
                id=s.id,
                district_student_id=s.district_student_id,
                first_name=s.first_name,
                last_name=s.last_name,
                preferred_name=s.preferred_name,
                grade=s.grade,
                school=SchoolOut.model_validate(s.school),
                ell=s.ell,
                iep=s.iep,
                has_504=s.has_504,
                counselor=UserOut.model_validate(s.counselor) if s.counselor else None,
                case_status=case.status if case else None,
                latest_phq9=_assessment_brief(latest_assessment(db, s.id, "PHQ9")),
                latest_gad7=_assessment_brief(latest_assessment(db, s.id, "GAD7")),
                next_session=next_session,
                alerts=[a["text"] for a in student_alerts(db, s, today, now)],
            )
        )
    return out


@router.get("/{student_id}")
def get_student(student_id: int, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    student = get_student_for_user(db, student_id, user)
    case = open_case(db, student.id)
    audit(db, user, "view", "student", student.id, student.id)
    db.commit()
    return {
        "student": StudentDetail.model_validate(student),
        "case": None
        if case is None
        else {
            "id": case.id,
            "status": case.status,
            "opened_at": case.opened_at,
            "counselor_id": case.counselor_id,
        },
    }


@router.get("/{student_id}/overview")
def overview(
    student_id: int,
    year: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    user: User = Depends(clinical_user),
    db: Session = Depends(get_db),
):
    """The Student 360 view: baselines for the school year, goal progress, alerts."""
    student = get_student_for_user(db, student_id, user)
    today, now = clock.today(), clock.now()
    label = year or school_year_of(today)
    start, end = school_year_bounds(label)
    end = min(end, today)

    def baseline_assessment(instrument: str) -> dict | None:
        rows = db.scalars(
            select(Assessment)
            .where(
                Assessment.student_id == student.id,
                Assessment.instrument == instrument,
                Assessment.administered_on.between(start, end),
            )
            .order_by(Assessment.is_baseline.desc(), Assessment.administered_on)
        ).first()
        return _assessment_brief(rows)

    prior_label = f"{int(label[:4]) - 1}-{label[2:4]}"
    prior_gpa = db.scalar(
        select(GradeRecord).where(
            GradeRecord.student_id == student.id, GradeRecord.school_year == prior_label, GradeRecord.term == "Final"
        )
    )
    first_sel = db.scalar(
        select(SELRating)
        .where(SELRating.student_id == student.id, SELRating.rated_on.between(start, end))
        .order_by(SELRating.rated_on)
    )
    attendance = metric_series(db, student.id, "attendance_rate", start)
    incidents = metric_series(db, student.id, "behavior_incidents", start)
    nurse_count = len(
        db.scalars(
            select(NurseVisit.id).where(NurseVisit.student_id == student.id, NurseVisit.visited_on.between(start, end))
        ).all()
    )
    first_school_day = attendance[0]["date"] if attendance else None

    baseline = {
        "phq9": baseline_assessment("PHQ9"),
        "gad7": baseline_assessment("GAD7"),
        "prior_gpa": None if prior_gpa is None else {"value": prior_gpa.gpa, "school_year": prior_label},
        "sel_rating": None if first_sel is None else {"value": first_sel.rating, "date": first_sel.rated_on},
        "behavior": None if not incidents else {"value": incidents[0]["value"], "month": incidents[0]["date"]},
        "attendance": None if not attendance else {"value": attendance[0]["value"], "month": attendance[0]["date"]},
        "nurse_visits": {"value": nurse_count, "from": first_school_day or start, "to": end},
    }

    plan = active_plan(db, student.id)
    goals = []
    if plan:
        for g in plan.goals:
            if g.status == "discontinued":
                continue
            result = evaluate_goal(db, g, today)
            goals.append(
                {
                    "id": g.id,
                    "domain": g.domain,
                    "description": g.description,
                    "metric": g.metric,
                    "metric_label": METRICS[g.metric]["label"],
                    "direction": METRICS[g.metric]["direction"],
                    "comparator": g.comparator,
                    "target_value": g.target_value,
                    "baseline_value": g.baseline_value,
                    "baseline_date": g.baseline_date,
                    "tracking": g.tracking,
                    "status": g.status,
                    **result,
                }
            )

    upcoming = db.scalars(
        select(ClinicalSession)
        .where(
            ClinicalSession.student_id == student.id,
            ClinicalSession.status == "scheduled",
            ClinicalSession.scheduled_start >= now,
        )
        .order_by(ClinicalSession.scheduled_start)
        .limit(4)
    ).all()

    latest_gpa = db.scalar(
        select(GradeRecord)
        .where(GradeRecord.student_id == student.id, GradeRecord.school_year == label)
        .order_by(GradeRecord.recorded_on.desc())
    )

    audit(db, user, "view", "student_overview", student.id, student.id)
    db.commit()
    return {
        "school_year": label,
        "baseline": baseline,
        "latest_gpa": None if latest_gpa is None else {"value": latest_gpa.gpa, "term": latest_gpa.term},
        "plan": None
        if plan is None
        else {
            "id": plan.id,
            "approach": plan.approach,
            "service_frequency": plan.service_frequency,
            "start_date": plan.start_date,
            "review_date": plan.review_date,
            "presenting_concerns": plan.presenting_concerns,
        },
        "goals": goals,
        "upcoming_sessions": [
            {
                "id": s.id,
                "scheduled_start": s.scheduled_start,
                "session_type": s.session_type,
                "modality": s.modality,
                "duration_minutes": s.duration_minutes,
            }
            for s in upcoming
        ],
        "alerts": student_alerts(db, student, today, now),
    }


@router.get("/{student_id}/trends")
def trends(student_id: int, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    """Twelve months of each tracked measure, for the domain tabs."""
    student = get_student_for_user(db, student_id, user)
    since = clock.today() - timedelta(days=365)
    series = {m: metric_series(db, student.id, m, since) for m in METRICS}
    for point in series["phq9"]:
        point["label"] = severity_for("PHQ9", point["value"])
    for point in series["gad7"]:
        point["label"] = severity_for("GAD7", point["value"])
    for point in series["sel_rating"]:
        point["label"] = SEL_LABEL[int(point["value"])]
    return series


@router.get("/{student_id}/school-data")
def school_data(student_id: int, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    student = get_student_for_user(db, student_id, user)
    since = clock.today() - timedelta(days=365)
    months = attendance_by_month(db, student.id, since)
    incidents = db.scalars(
        select(BehaviorIncident)
        .where(BehaviorIncident.student_id == student.id, BehaviorIncident.occurred_on >= since)
        .order_by(BehaviorIncident.occurred_on.desc())
    ).all()
    visits = db.scalars(
        select(NurseVisit)
        .where(NurseVisit.student_id == student.id, NurseVisit.visited_on >= since)
        .order_by(NurseVisit.visited_on.desc())
    ).all()
    grades = db.scalars(
        select(GradeRecord).where(GradeRecord.student_id == student.id).order_by(GradeRecord.recorded_on)
    ).all()
    sel = db.scalars(
        select(SELRating)
        .where(SELRating.student_id == student.id, SELRating.rated_on >= since)
        .order_by(SELRating.rated_on.desc())
    ).all()
    audit(db, user, "view", "school_data", student.id, student.id)
    db.commit()
    return {
        "attendance": [
            {"month": m, "present": p, "days": t, "rate": round(100 * p / t, 1)} for m, (p, t) in months.items()
        ],
        "incidents": [
            {
                "id": i.id,
                "date": i.occurred_on,
                "category": i.category,
                "severity": i.severity,
                "description": i.description,
                "reported_by": i.reported_by,
            }
            for i in incidents
        ],
        "nurse_visits": [{"id": v.id, "date": v.visited_on, "reason": v.reason, "outcome": v.outcome} for v in visits],
        "grades": [{"school_year": g.school_year, "term": g.term, "gpa": g.gpa, "date": g.recorded_on} for g in grades],
        "sel_ratings": [
            {"id": r.id, "date": r.rated_on, "rating": r.rating, "rater": r.rater, "comment": r.comment} for r in sel
        ],
    }


@router.get("/{student_id}/timeline")
def timeline(student_id: int, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    """Every support event for the student, newest first."""
    student = get_student_for_user(db, student_id, user)
    sid = student.id
    events: list[dict] = []

    for r in db.scalars(select(Referral).where(Referral.student_id == sid)):
        events.append(
            {
                "date": clock.local_date(r.created_at),
                "kind": "referral",
                "title": f"Referred by {r.referred_by} ({r.source})",
                "detail": r.reason,
                "status": r.status,
            }
        )
    for c in db.scalars(select(Case).where(Case.student_id == sid)):
        events.append({"date": c.opened_at, "kind": "case", "title": "Case opened", "detail": None})
        if c.closed_at:
            events.append({"date": c.closed_at, "kind": "case", "title": "Case closed", "detail": c.discharge_reason})
    for p in db.scalars(select(TreatmentPlan).where(TreatmentPlan.student_id == sid)):
        events.append(
            {
                "date": p.start_date,
                "kind": "plan",
                "title": f"Treatment plan started: {p.approach}",
                "detail": p.service_frequency,
            }
        )
    for a in db.scalars(select(Assessment).where(Assessment.student_id == sid)):
        name = "PHQ-9" if a.instrument == "PHQ9" else "GAD-7"
        events.append(
            {
                "date": a.administered_on,
                "kind": "assessment",
                "title": f"{name} score {a.total}, {a.severity.lower()}",
                "detail": "Item 9 endorsed" if a.safety_flag else None,
                "flag": a.safety_flag,
            }
        )
    for s in db.scalars(
        select(ClinicalSession)
        .where(ClinicalSession.student_id == sid, ClinicalSession.status.in_(("completed", "no_show", "cancelled")))
        .options(selectinload(ClinicalSession.note))
    ):
        title = {
            "completed": f"{s.session_type.capitalize()} session, {s.duration_minutes} min",
            "no_show": "Missed session (no show)",
            "cancelled": "Session cancelled",
        }[s.status]
        events.append(
            {
                "date": clock.local_date(s.scheduled_start),
                "kind": "session",
                "title": title,
                "detail": "Telehealth" if s.modality == "telehealth" else None,
                "session_id": s.id,
                "status": s.status,
                "signed": bool(s.note and s.note.signed_at),
            }
        )
    for c in db.scalars(select(Consent).where(Consent.student_id == sid)):
        label = c.consent_type.replace("_", " ")
        events.append(
            {
                "date": c.signed_on,
                "kind": "consent",
                "title": f"Consent signed: {label}",
                "detail": f"{c.signer_name} ({c.signer_relationship})",
            }
        )
        if c.revoked_on:
            events.append(
                {"date": c.revoked_on, "kind": "consent", "title": f"Consent revoked: {label}", "detail": None}
            )
    for i in db.scalars(select(BehaviorIncident).where(BehaviorIncident.student_id == sid)):
        events.append(
            {
                "date": i.occurred_on,
                "kind": "incident",
                "title": f"Behavior incident: {i.category}",
                "detail": i.description,
                "severity": i.severity,
            }
        )
    for v in db.scalars(select(NurseVisit).where(NurseVisit.student_id == sid)):
        events.append(
            {
                "date": v.visited_on,
                "kind": "nurse",
                "title": f"Nurse visit: {v.reason}",
                "detail": v.outcome.replace("_", " "),
            }
        )

    events.sort(key=lambda e: e["date"], reverse=True)
    audit(db, user, "view", "timeline", sid, sid)
    db.commit()
    return events
