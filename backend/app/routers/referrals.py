from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from .. import clock
from ..db import get_db
from ..models import Case, Referral, Student, User
from ..queries import open_case
from ..schemas import ReferralDecision, ReferralIn
from ..security import CLINICAL_ROLES, audit, require_roles

router = APIRouter(prefix="/api/referrals", tags=["referrals"])
clinical_user = require_roles(*CLINICAL_ROLES)
admin_user = require_roles("admin")

URGENCY_ORDER = {"urgent": 0, "priority": 1, "routine": 2}


def referral_dict(r: Referral, counselors: dict[int, str]) -> dict:
    s = r.student
    return {
        "id": r.id,
        "student": {
            "id": s.id,
            "name": f"{s.preferred_name or s.first_name} {s.last_name}",
            "grade": s.grade,
            "school": s.school.name,
            "district_student_id": s.district_student_id,
            "iep": s.iep,
            "ell": s.ell,
            "has_504": s.has_504,
            "current_counselor": counselors.get(s.counselor_id) if s.counselor_id else None,
        },
        "source": r.source,
        "referred_by": r.referred_by,
        "reason": r.reason,
        "concerns": r.concerns,
        "urgency": r.urgency,
        "status": r.status,
        "assigned_counselor": counselors.get(r.assigned_counselor_id) if r.assigned_counselor_id else None,
        "decision_note": r.decision_note,
        "decided_at": r.decided_at,
        "created_at": r.created_at,
    }


def _counselor_names(db: Session, district_id: int) -> dict[int, str]:
    return {
        u.id: u.full_name
        for u in db.scalars(select(User).where(User.district_id == district_id, User.role == "counselor"))
    }


@router.get("")
def list_referrals(
    status_filter: str = Query("new", alias="status", pattern="^(new|accepted|declined|all)$"),
    user: User = Depends(clinical_user),
    db: Session = Depends(get_db),
):
    query = (
        select(Referral)
        .join(Student, Referral.student_id == Student.id)
        .where(Student.district_id == user.district_id)
        .options(selectinload(Referral.student).selectinload(Student.school))
    )
    if status_filter != "all":
        query = query.where(Referral.status == status_filter)
    if user.role == "counselor":
        # Counselors see referrals routed to them and referrals for their own students.
        query = query.where(or_(Referral.assigned_counselor_id == user.id, Student.counselor_id == user.id))
    rows = db.scalars(query).all()
    rows.sort(key=lambda r: (URGENCY_ORDER.get(r.urgency, 9), r.created_at))
    if status_filter != "new":
        rows.sort(key=lambda r: r.decided_at or r.created_at, reverse=True)
    names = _counselor_names(db, user.district_id)
    return [referral_dict(r, names) for r in rows]


@router.get("/student-lookup")
def student_lookup(q: str = Query(min_length=2), user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    """Minimal directory search so staff can refer a student who is not on their caseload."""
    like = f"%{q.strip()}%"
    rows = db.scalars(
        select(Student)
        .where(
            Student.district_id == user.district_id,
            or_(
                Student.first_name.ilike(like),
                Student.last_name.ilike(like),
                Student.preferred_name.ilike(like),
                Student.district_student_id.ilike(like),
            ),
        )
        .options(selectinload(Student.school))
        .order_by(Student.last_name)
        .limit(8)
    ).all()
    return [
        {
            "id": s.id,
            "name": f"{s.preferred_name or s.first_name} {s.last_name}",
            "grade": s.grade,
            "school": s.school.name,
            "district_student_id": s.district_student_id,
        }
        for s in rows
    ]


@router.post("", status_code=201)
def create_referral(body: ReferralIn, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    student = db.get(Student, body.student_id)
    if student is None or student.district_id != user.district_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")
    r = Referral(**body.model_dump())
    db.add(r)
    db.flush()
    audit(db, user, "create", "referral", r.id, student.id, body.urgency)
    db.commit()
    db.refresh(r)
    return referral_dict(r, _counselor_names(db, user.district_id))


@router.post("/{referral_id}/decision")
def decide(referral_id: int, body: ReferralDecision, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    r = db.get(Referral, referral_id)
    if r is None or r.student.district_id != user.district_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Referral not found.")
    if r.status != "new":
        raise HTTPException(status.HTTP_409_CONFLICT, "This referral has already been decided.")

    if body.action == "accept":
        counselor = db.get(User, body.counselor_id) if body.counselor_id else None
        if counselor is None or counselor.role != "counselor" or counselor.district_id != user.district_id:
            raise HTTPException(422, "Choose a counselor to assign.")
        student = r.student
        student.counselor_id = counselor.id
        case = open_case(db, student.id)
        if case is None:
            case = Case(student_id=student.id, counselor_id=counselor.id, referral_id=r.id, opened_at=clock.today())
            db.add(case)
        else:
            case.counselor_id = counselor.id
        r.status = "accepted"
        r.assigned_counselor_id = counselor.id
    else:
        if not (body.note and body.note.strip()):
            raise HTTPException(422, "Add a reason when declining a referral.")
        r.status = "declined"

    r.decision_note = body.note
    r.decided_by_id = user.id
    r.decided_at = clock.now()
    audit(db, user, "update", "referral", r.id, r.student_id, body.action)
    db.commit()
    db.refresh(r)
    return referral_dict(r, _counselor_names(db, user.district_id))
