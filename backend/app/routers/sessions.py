from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import clock
from ..db import get_db
from ..models import NoteAddendum, SessionNote, Student, User
from ..models import Session as ClinicalSession
from ..queries import open_case
from ..schemas import AddendumIn, NoteIn, SessionIn, SessionUpdate
from ..security import CLINICAL_ROLES, audit, get_student_for_user, require_roles

router = APIRouter(prefix="/api", tags=["sessions"])
clinical_user = require_roles(*CLINICAL_ROLES)


def session_dict(s: ClinicalSession, include_note: bool = False) -> dict:
    out = {
        "id": s.id,
        "student_id": s.student_id,
        "student_name": f"{s.student.preferred_name or s.student.first_name} {s.student.last_name}",
        "grade": s.student.grade,
        "counselor_id": s.counselor_id,
        "counselor_name": s.counselor.full_name,
        "session_type": s.session_type,
        "modality": s.modality,
        "scheduled_start": s.scheduled_start,
        "duration_minutes": s.duration_minutes,
        "status": s.status,
        "location": s.location,
        "billing_status": s.billing_status,
        "note_status": "none" if s.note is None else ("signed" if s.note.signed_at else "draft"),
    }
    if include_note:
        out["note"] = (
            None
            if s.note is None
            else {
                "id": s.note.id,
                "data": s.note.data,
                "assessment": s.note.assessment,
                "plan": s.note.plan,
                "interventions": s.note.interventions,
                "goal_ids": s.note.goal_ids,
                "risk_level": s.note.risk_level,
                "signed_at": s.note.signed_at,
                "updated_at": s.note.updated_at,
                "addenda": [{"id": a.id, "text": a.text, "created_at": a.created_at} for a in s.note.addenda],
            }
        )
    return out


def _load(db: Session, session_id: int, user: User) -> ClinicalSession:
    s = db.scalar(
        select(ClinicalSession)
        .where(ClinicalSession.id == session_id)
        .options(
            selectinload(ClinicalSession.student),
            selectinload(ClinicalSession.counselor),
            selectinload(ClinicalSession.note).selectinload(SessionNote.addenda),
        )
    )
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")
    get_student_for_user(db, s.student_id, user)
    return s


def _require_author(s: ClinicalSession, user: User) -> None:
    if s.counselor_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the counselor who held this session can document it.")


@router.get("/sessions")
def list_sessions(
    start: date = Query(...),
    end: date = Query(...),
    counselor_id: int | None = None,
    needs_note: bool = False,
    user: User = Depends(clinical_user),
    db: Session = Depends(get_db),
):
    query = (
        select(ClinicalSession)
        .join(Student, ClinicalSession.student_id == Student.id)
        .where(
            Student.district_id == user.district_id,
            ClinicalSession.scheduled_start >= clock.local_day_start(start),
            ClinicalSession.scheduled_start < clock.local_day_start(end + timedelta(days=1)),
        )
        .options(
            selectinload(ClinicalSession.student),
            selectinload(ClinicalSession.counselor),
            selectinload(ClinicalSession.note),
        )
        .order_by(ClinicalSession.scheduled_start)
    )
    if user.role == "counselor":
        query = query.where(ClinicalSession.counselor_id == user.id)
    elif counselor_id:
        query = query.where(ClinicalSession.counselor_id == counselor_id)
    rows = db.scalars(query).all()
    if needs_note:
        rows = [s for s in rows if s.status == "completed" and (s.note is None or s.note.signed_at is None)]
    return [session_dict(s) for s in rows]


@router.get("/students/{student_id}/sessions")
def student_sessions(student_id: int, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    student = get_student_for_user(db, student_id, user)
    rows = db.scalars(
        select(ClinicalSession)
        .where(ClinicalSession.student_id == student.id)
        .options(
            selectinload(ClinicalSession.student),
            selectinload(ClinicalSession.counselor),
            selectinload(ClinicalSession.note),
        )
        .order_by(ClinicalSession.scheduled_start.desc())
    ).all()
    return [session_dict(s) for s in rows]


@router.post("/sessions", status_code=201)
def create_session(body: SessionIn, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    student = get_student_for_user(db, body.student_id, user)
    counselor_id = user.id if user.role == "counselor" else student.counselor_id
    if counselor_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Assign a counselor to this student before scheduling.")
    case = open_case(db, student.id)
    if case is None and body.session_type != "intake":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only an intake can be scheduled before a case is opened.")
    s = ClinicalSession(
        student_id=student.id,
        case_id=case.id if case else None,
        counselor_id=counselor_id,
        **body.model_dump(exclude={"student_id"}),
    )
    db.add(s)
    db.flush()
    audit(db, user, "create", "session", s.id, student.id)
    db.commit()
    return session_dict(_load(db, s.id, user))


@router.get("/sessions/{session_id}")
def get_session(session_id: int, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    s = _load(db, session_id, user)
    audit(db, user, "view", "session_note", s.id, s.student_id)
    db.commit()
    return session_dict(s, include_note=True)


@router.patch("/sessions/{session_id}")
def update_session(
    session_id: int, body: SessionUpdate, user: User = Depends(clinical_user), db: Session = Depends(get_db)
):
    s = _load(db, session_id, user)
    changes = body.model_dump(exclude_unset=True)
    if s.billing_status == "exported":
        raise HTTPException(status.HTTP_409_CONFLICT, "This session has been exported for billing and is locked.")
    if changes.get("status") == "completed" and s.scheduled_start > clock.now():
        raise HTTPException(status.HTTP_409_CONFLICT, "A session cannot be completed before it starts.")
    if s.note and s.note.signed_at and {"duration_minutes", "modality", "scheduled_start"} & changes.keys():
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The note is signed. Add an addendum instead of editing the session."
        )
    for key, value in changes.items():
        setattr(s, key, value)
    audit(db, user, "update", "session", s.id, s.student_id, ", ".join(f"{k}={v}" for k, v in changes.items()))
    db.commit()
    return session_dict(_load(db, s.id, user), include_note=True)


@router.put("/sessions/{session_id}/note")
def save_note(session_id: int, body: NoteIn, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    s = _load(db, session_id, user)
    _require_author(s, user)
    if s.status != "completed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Mark the session completed before writing its note.")
    if s.note and s.note.signed_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "This note is signed and locked. Add an addendum instead.")
    note = s.note or SessionNote(session_id=s.id)
    for key, value in body.model_dump().items():
        setattr(note, key, value)
    db.add(note)
    db.flush()
    audit(db, user, "update", "session_note", note.id, s.student_id)
    db.commit()
    return session_dict(_load(db, s.id, user), include_note=True)


@router.post("/sessions/{session_id}/note/sign")
def sign_note(session_id: int, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    s = _load(db, session_id, user)
    _require_author(s, user)
    if s.note is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Write the note before signing it.")
    if s.note.signed_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "This note is already signed.")
    missing = [f for f in ("data", "assessment", "plan") if not getattr(s.note, f).strip()]
    if missing:
        raise HTTPException(422, f"Complete these sections before signing: {', '.join(missing)}.")
    s.note.signed_at = clock.now()
    s.note.signed_by_id = user.id
    audit(db, user, "sign", "session_note", s.note.id, s.student_id)
    db.commit()
    return session_dict(_load(db, s.id, user), include_note=True)


@router.post("/sessions/{session_id}/note/addenda", status_code=201)
def add_addendum(session_id: int, body: AddendumIn, user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    s = _load(db, session_id, user)
    _require_author(s, user)
    if s.note is None or s.note.signed_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Addenda are for signed notes. Edit the draft directly.")
    db.add(NoteAddendum(note_id=s.note.id, text=body.text, author_id=user.id))
    audit(db, user, "create", "note_addendum", s.note.id, s.student_id)
    db.commit()
    db.expire_all()
    return session_dict(_load(db, s.id, user), include_note=True)


@router.get("/dashboard")
def dashboard(user: User = Depends(clinical_user), db: Session = Depends(get_db)):
    """Home screen for the signed-in counselor (or the whole district for admins)."""
    now = clock.now()
    day_start = clock.local_day_start(clock.today())
    base = (
        select(ClinicalSession)
        .join(Student, ClinicalSession.student_id == Student.id)
        .where(Student.district_id == user.district_id)
        .options(
            selectinload(ClinicalSession.student),
            selectinload(ClinicalSession.counselor),
            selectinload(ClinicalSession.note),
        )
    )
    if user.role == "counselor":
        base = base.where(ClinicalSession.counselor_id == user.id)

    today_sessions = db.scalars(
        base.where(
            ClinicalSession.scheduled_start >= day_start,
            ClinicalSession.scheduled_start < clock.local_day_start(clock.today() + timedelta(days=1)),
        ).order_by(ClinicalSession.scheduled_start)
    ).all()
    week_sessions = db.scalars(
        base.where(
            ClinicalSession.scheduled_start >= clock.local_day_start(clock.today() + timedelta(days=1)),
            ClinicalSession.scheduled_start < clock.local_day_start(clock.today() + timedelta(days=8)),
            ClinicalSession.status == "scheduled",
        ).order_by(ClinicalSession.scheduled_start)
    ).all()
    unsigned = [
        s
        for s in db.scalars(
            base.where(ClinicalSession.status == "completed", ClinicalSession.scheduled_start < now).order_by(
                ClinicalSession.scheduled_start
            )
        ).all()
        if s.note is None or s.note.signed_at is None
    ]
    return {
        "today": [session_dict(s) for s in today_sessions],
        "upcoming": [session_dict(s) for s in week_sessions],
        "notes_to_sign": [session_dict(s) for s in unsigned],
    }
