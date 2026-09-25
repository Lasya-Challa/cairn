from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import clock
from ..clinical import INSTRUMENTS, METRICS, RESPONSE_OPTIONS, ScoringError, score
from ..db import get_db
from ..models import Assessment, Consent, Goal, TreatmentPlan, User
from ..queries import open_case
from ..schemas import AssessmentIn, AssessmentOut, ConsentIn, ConsentOut, GoalIn, GoalUpdate, PlanIn
from ..security import CLINICAL_ROLES, audit, get_student_for_user, require_roles

router = APIRouter(prefix="/api", tags=["clinical"])
clinical_user = require_roles(*CLINICAL_ROLES)


# ---------- instruments and assessments ----------


@router.get("/instruments")
def instruments(_: User = Depends(clinical_user)):
    return {
        "options": RESPONSE_OPTIONS,
        "instruments": [
            {
                "code": spec["code"],
                "name": spec["name"],
                "measures": spec["measures"],
                "stem": spec["stem"],
                "items": spec["items"],
                "max": spec["max"],
                "bands": [{"min": lo, "max": hi, "label": label} for lo, hi, label in spec["bands"]],
                "safety_item": spec["safety_item"],
            }
            for spec in INSTRUMENTS.values()
        ],
    }


@router.get("/students/{student_id}/assessments", response_model=list[AssessmentOut])
def list_assessments(student_id: int, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    student = get_student_for_user(db, student_id, user)
    audit(db, user, "view", "assessments", None, student.id)
    db.commit()
    return db.scalars(
        select(Assessment)
        .where(Assessment.student_id == student.id)
        .order_by(Assessment.administered_on.desc(), Assessment.id.desc())
    ).all()


@router.post("/students/{student_id}/assessments", response_model=AssessmentOut, status_code=201)
def create_assessment(
    student_id: int, body: AssessmentIn, user: User = Depends(clinical_user), db: Session = Depends(get_db)
):
    student = get_student_for_user(db, student_id, user)
    if body.administered_on > clock.today():
        raise HTTPException(422, "Assessment date cannot be in the future.")
    try:
        result = score(body.instrument, body.responses)
    except ScoringError as e:
        raise HTTPException(422, str(e))
    a = Assessment(
        student_id=student.id,
        instrument=body.instrument,
        responses=body.responses,
        administered_on=body.administered_on,
        is_baseline=body.is_baseline,
        notes=body.notes,
        administered_by_id=user.id,
        **result,
    )
    db.add(a)
    db.flush()
    detail = f"{body.instrument} total {result['total']}"
    if result["safety_flag"]:
        detail += "; item 9 endorsed"
    audit(db, user, "create", "assessment", a.id, student.id, detail)
    db.commit()
    return a


# ---------- treatment plans and goals ----------


def _plan_dict(plan: TreatmentPlan) -> dict:
    return {
        "id": plan.id,
        "presenting_concerns": plan.presenting_concerns,
        "approach": plan.approach,
        "service_frequency": plan.service_frequency,
        "start_date": plan.start_date,
        "review_date": plan.review_date,
        "status": plan.status,
        "goals": [
            {
                "id": g.id,
                "domain": g.domain,
                "description": g.description,
                "metric": g.metric,
                "metric_label": METRICS[g.metric]["label"],
                "comparator": g.comparator,
                "target_value": g.target_value,
                "baseline_value": g.baseline_value,
                "baseline_date": g.baseline_date,
                "tracking": g.tracking,
                "status": g.status,
            }
            for g in plan.goals
        ],
    }


@router.get("/students/{student_id}/plans")
def list_plans(student_id: int, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    student = get_student_for_user(db, student_id, user)
    plans = db.scalars(
        select(TreatmentPlan).where(TreatmentPlan.student_id == student.id).order_by(TreatmentPlan.start_date.desc())
    ).all()
    return [_plan_dict(p) for p in plans]


@router.post("/students/{student_id}/plans", status_code=201)
def create_plan(student_id: int, body: PlanIn, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    student = get_student_for_user(db, student_id, user)
    case = open_case(db, student.id)
    if case is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Open a case for this student before creating a plan.")
    # A student has one active plan at a time; the previous one is completed.
    for old in db.scalars(
        select(TreatmentPlan).where(TreatmentPlan.student_id == student.id, TreatmentPlan.status == "active")
    ):
        old.status = "completed"
    plan = TreatmentPlan(
        student_id=student.id,
        case_id=case.id,
        presenting_concerns=body.presenting_concerns,
        approach=body.approach,
        service_frequency=body.service_frequency,
        start_date=body.start_date,
        review_date=body.review_date,
        created_by_id=user.id,
    )
    db.add(plan)
    db.flush()
    for g in body.goals:
        db.add(Goal(plan_id=plan.id, student_id=student.id, **g.model_dump()))
    audit(db, user, "create", "treatment_plan", plan.id, student.id)
    db.commit()
    db.refresh(plan)
    return _plan_dict(plan)


@router.post("/plans/{plan_id}/goals", status_code=201)
def add_goal(plan_id: int, body: GoalIn, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    plan = db.get(TreatmentPlan, plan_id)
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found.")
    get_student_for_user(db, plan.student_id, user)
    goal = Goal(plan_id=plan.id, student_id=plan.student_id, **body.model_dump())
    db.add(goal)
    db.flush()
    audit(db, user, "create", "goal", goal.id, plan.student_id)
    db.commit()
    db.refresh(plan)
    return _plan_dict(plan)


@router.patch("/goals/{goal_id}")
def update_goal(goal_id: int, body: GoalUpdate, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    goal = db.get(Goal, goal_id)
    if goal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found.")
    get_student_for_user(db, goal.student_id, user)
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(goal, key, value)
    audit(db, user, "update", "goal", goal.id, goal.student_id, ", ".join(changes))
    db.commit()
    return _plan_dict(goal.plan)


# ---------- consents ----------


@router.get("/students/{student_id}/consents", response_model=list[ConsentOut])
def list_consents(student_id: int, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    student = get_student_for_user(db, student_id, user)
    return db.scalars(select(Consent).where(Consent.student_id == student.id).order_by(Consent.signed_on.desc())).all()


@router.post("/students/{student_id}/consents", response_model=ConsentOut, status_code=201)
def create_consent(
    student_id: int, body: ConsentIn, user: User = Depends(clinical_user), db: Session = Depends(get_db)
):
    student = get_student_for_user(db, student_id, user)
    if body.expires_on and body.expires_on <= body.signed_on:
        raise HTTPException(422, "Expiration must be after the signing date.")
    consent = Consent(student_id=student.id, recorded_by_id=user.id, **body.model_dump())
    db.add(consent)
    db.flush()
    audit(db, user, "create", "consent", consent.id, student.id, body.consent_type)
    db.commit()
    return consent


@router.post("/consents/{consent_id}/revoke", response_model=ConsentOut)
def revoke_consent(consent_id: int, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    consent = db.get(Consent, consent_id)
    if consent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Consent not found.")
    get_student_for_user(db, consent.student_id, user)
    if consent.revoked_on:
        raise HTTPException(status.HTTP_409_CONFLICT, "This consent is already revoked.")
    consent.revoked_on = clock.today()
    audit(db, user, "revoke", "consent", consent.id, consent.student_id, consent.consent_type)
    db.commit()
    return consent
