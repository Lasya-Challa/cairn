from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import clock
from ..billing import billing_lines, to_csv
from ..db import get_db
from ..models import (
    AuditEvent,
    BillingExport,
    Referral,
    School,
    Student,
    User,
)
from ..models import (
    Session as ClinicalSession,
)
from ..schemas import ExportIn, SchoolOut, UserOut
from ..security import audit, get_current_user, require_roles

router = APIRouter(prefix="/api", tags=["billing", "admin"])
billing_user = require_roles("billing", "admin")
admin_user = require_roles("admin")


# ---------- reference data ----------


@router.get("/schools", response_model=list[SchoolOut])
def schools(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.scalars(select(School).where(School.district_id == user.district_id).order_by(School.name)).all()


@router.get("/counselors")
def counselors(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(User, func.count(Student.id))
        .outerjoin(Student, Student.counselor_id == User.id)
        .where(User.district_id == user.district_id, User.role == "counselor", User.is_active.is_(True))
        .group_by(User.id)
        .order_by(User.full_name)
    ).all()
    return [{**UserOut.model_validate(u).model_dump(), "caseload": n} for u, n in rows]


# ---------- billing ----------


@router.get("/billing/lines")
def get_lines(
    start: date,
    end: date,
    school_id: int | None = None,
    user: User = Depends(billing_user),
    db: Session = Depends(get_db),
):
    if end < start:
        raise HTTPException(422, "End date must be on or after the start date.")
    lines = billing_lines(db, user.district_id, start, end, school_id)
    summary = {
        "ready": sum(1 for line in lines if line["state"] == "ready"),
        "blocked": sum(1 for line in lines if line["state"] == "blocked"),
        "exported": sum(1 for line in lines if line["state"] == "exported"),
        "not_eligible": sum(1 for line in lines if line["state"] == "not_eligible"),
    }
    issue_counts: dict[str, int] = {}
    for line in lines:
        for issue in line["issues"]:
            if line["state"] == "blocked":
                issue_counts[issue] = issue_counts.get(issue, 0) + 1
    return {
        "lines": lines,
        "summary": summary,
        "issues": sorted(({"issue": k, "count": v} for k, v in issue_counts.items()), key=lambda x: -x["count"]),
    }


@router.post("/billing/exports", status_code=201)
def create_export(body: ExportIn, user: User = Depends(billing_user), db: Session = Depends(get_db)):
    lines = billing_lines(db, user.district_id, body.period_start, body.period_end)
    wanted = set(body.session_ids)
    selected = [line for line in lines if line["session_id"] in wanted]
    if len(selected) != len(wanted):
        raise HTTPException(422, "Some sessions are outside the selected period.")
    not_ready = [line["session_id"] for line in selected if line["state"] != "ready"]
    if not_ready:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{len(not_ready)} selected lines are not ready to export. Refresh and try again."
        )
    csv_text = to_csv(selected)
    export = BillingExport(
        district_id=user.district_id,
        created_by_id=user.id,
        period_start=body.period_start,
        period_end=body.period_end,
        line_count=len(selected),
        total_units=sum(line["units"] for line in selected),
        csv_content=csv_text,
    )
    db.add(export)
    db.flush()
    for s in db.scalars(select(ClinicalSession).where(ClinicalSession.id.in_(wanted))):
        s.billing_status = "exported"
        s.billing_export_id = export.id
    audit(db, user, "export", "billing_export", export.id, None, f"{len(selected)} lines")
    db.commit()
    return _export_dict(export, user)


def _export_dict(e: BillingExport, creator: User | None) -> dict:
    return {
        "id": e.id,
        "created_at": e.created_at,
        "created_by": creator.full_name if creator else None,
        "period_start": e.period_start,
        "period_end": e.period_end,
        "line_count": e.line_count,
        "total_units": e.total_units,
    }


@router.get("/billing/exports")
def list_exports(user: User = Depends(billing_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(BillingExport, User)
        .join(User, BillingExport.created_by_id == User.id)
        .where(BillingExport.district_id == user.district_id)
        .order_by(BillingExport.created_at.desc())
    ).all()
    return [_export_dict(e, u) for e, u in rows]


@router.get("/billing/exports/{export_id}/csv")
def download_export(export_id: int, user: User = Depends(billing_user), db: Session = Depends(get_db)):
    e = db.get(BillingExport, export_id)
    if e is None or e.district_id != user.district_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Export not found.")
    audit(db, user, "export", "billing_export_download", e.id)
    db.commit()
    filename = f"medicaid-services-{e.period_start}-to-{e.period_end}-{e.id}.csv"
    return Response(
        e.csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- admin ----------


@router.get("/admin/summary")
def admin_summary(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    today = clock.today()
    month_start = today.replace(day=1)
    in_district = Student.district_id == user.district_id

    new_referrals = db.scalar(
        select(func.count(Referral.id)).join(Student).where(in_district, Referral.status == "new")
    )
    urgent_referrals = db.scalar(
        select(func.count(Referral.id))
        .join(Student)
        .where(in_district, Referral.status == "new", Referral.urgency == "urgent")
    )
    sessions_month = db.execute(
        select(ClinicalSession.status, func.count(ClinicalSession.id))
        .join(Student)
        .where(
            in_district,
            ClinicalSession.scheduled_start >= clock.local_day_start(month_start),
            ClinicalSession.scheduled_start < clock.local_day_start(today + timedelta(days=1)),
        )
        .group_by(ClinicalSession.status)
    ).all()
    by_status = {s: n for s, n in sessions_month}
    held = by_status.get("completed", 0)
    missed = by_status.get("no_show", 0)

    return {
        "new_referrals": new_referrals,
        "urgent_referrals": urgent_referrals,
        "students_served": db.scalar(
            select(func.count(Student.id)).where(in_district, Student.counselor_id.isnot(None))
        ),
        "sessions_this_month": {"completed": held, "no_show": missed, "cancelled": by_status.get("cancelled", 0)},
        "month_start": month_start,
    }


@router.get("/admin/audit")
def audit_log(
    limit: int = Query(100, le=500),
    student_id: int | None = None,
    user_id: int | None = None,
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    query = (
        select(AuditEvent)
        .join(User, AuditEvent.user_id == User.id)
        .where(User.district_id == user.district_id)
        .options(selectinload(AuditEvent.user))
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .limit(limit)
    )
    if student_id:
        query = query.where(AuditEvent.student_id == student_id)
    if user_id:
        query = query.where(AuditEvent.user_id == user_id)
    events = db.scalars(query).all()
    student_names = {
        s.id: f"{s.first_name} {s.last_name}"
        for s in db.scalars(select(Student).where(Student.id.in_({e.student_id for e in events if e.student_id})))
    }
    return [
        {
            "id": e.id,
            "created_at": e.created_at,
            "user": e.user.full_name if e.user else None,
            "role": e.user.role if e.user else None,
            "action": e.action,
            "entity_type": e.entity_type,
            "entity_id": e.entity_id,
            "student_id": e.student_id,
            "student_name": student_names.get(e.student_id),
            "detail": e.detail,
        }
        for e in events
    ]
