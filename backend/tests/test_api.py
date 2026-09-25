from datetime import timedelta

from sqlalchemy import select

from app import clock
from app.db import SessionLocal
from app.models import Session as ClinicalSession
from app.models import Student, User


def _db():
    return SessionLocal()


def _student_of(email: str) -> int:
    with _db() as db:
        uid = db.scalar(select(User.id).where(User.email == email))
        return db.scalar(select(Student.id).where(Student.counselor_id == uid))


def test_login_rejects_bad_password(client):
    r = client.post("/api/auth/login", json={"email": "maya.okafor@riverbend.example", "password": "wrong"})
    assert r.status_code == 401


def test_requires_auth(client):
    assert client.get("/api/students").status_code == 401


def test_counselor_sees_only_own_caseload(client, tokens):
    r = client.get("/api/students", headers=tokens["maya"])
    assert r.status_code == 200
    names = {s["counselor"]["full_name"] for s in r.json()}
    assert names == {"Maya Okafor"}

    other = _student_of("daniel.reyes@riverbend.example")
    assert client.get(f"/api/students/{other}", headers=tokens["maya"]).status_code == 403


def test_billing_cannot_read_clinical_records(client, tokens):
    sid = _student_of("maya.okafor@riverbend.example")
    assert client.get(f"/api/students/{sid}", headers=tokens["billing"]).status_code == 403
    assert client.get(f"/api/students/{sid}/assessments", headers=tokens["billing"]).status_code == 403


def test_counselor_cannot_open_billing(client, tokens):
    today = clock.today()
    r = client.get(f"/api/billing/lines?start={today - timedelta(days=30)}&end={today}", headers=tokens["maya"])
    assert r.status_code == 403


def test_overview_shape(client, tokens):
    sid = _student_of("maya.okafor@riverbend.example")
    r = client.get(f"/api/students/{sid}/overview", headers=tokens["maya"])
    assert r.status_code == 200
    body = r.json()
    assert {"baseline", "goals", "alerts", "upcoming_sessions", "school_year"} <= body.keys()
    for goal in body["goals"]:
        assert goal["progress"] is None or 0 <= goal["progress"] <= 1


def test_create_assessment_scores_and_flags(client, tokens):
    sid = _student_of("maya.okafor@riverbend.example")
    r = client.post(
        f"/api/students/{sid}/assessments",
        headers=tokens["maya"],
        json={"instrument": "PHQ9", "responses": [2, 2, 1, 1, 1, 1, 1, 1, 1], "administered_on": str(clock.today())},
    )
    assert r.status_code == 201, r.text
    assert r.json()["total"] == 11
    assert r.json()["severity"] == "Moderate"
    assert r.json()["safety_flag"] is True
    alerts = client.get(f"/api/students/{sid}/overview", headers=tokens["maya"]).json()["alerts"]
    assert any(a["kind"] == "safety" for a in alerts)


def test_note_lifecycle(client, tokens):
    sid = _student_of("maya.okafor@riverbend.example")
    start = clock.now() - timedelta(hours=2)
    r = client.post(
        "/api/sessions",
        headers=tokens["maya"],
        json={
            "student_id": sid,
            "session_type": "individual",
            "scheduled_start": start.isoformat() + "Z",
            "duration_minutes": 45,
        },
    )
    assert r.status_code == 201, r.text
    session_id = r.json()["id"]

    # Cannot document before the session is completed.
    note = {"data": "Student discussed test anxiety.", "assessment": "Engaged.", "plan": "Continue weekly."}
    assert client.put(f"/api/sessions/{session_id}/note", headers=tokens["maya"], json=note).status_code == 409
    assert (
        client.patch(f"/api/sessions/{session_id}", headers=tokens["maya"], json={"status": "completed"}).status_code
        == 200
    )

    # Signing an incomplete note is rejected.
    client.put(f"/api/sessions/{session_id}/note", headers=tokens["maya"], json={**note, "plan": ""})
    assert client.post(f"/api/sessions/{session_id}/note/sign", headers=tokens["maya"]).status_code == 422

    client.put(f"/api/sessions/{session_id}/note", headers=tokens["maya"], json=note)
    r = client.post(f"/api/sessions/{session_id}/note/sign", headers=tokens["maya"])
    assert r.status_code == 200 and r.json()["note"]["signed_at"]

    # Signed notes are locked; addenda are allowed.
    assert client.put(f"/api/sessions/{session_id}/note", headers=tokens["maya"], json=note).status_code == 409
    r = client.post(
        f"/api/sessions/{session_id}/note/addenda", headers=tokens["maya"], json={"text": "Guardian called."}
    )
    assert r.status_code == 201 and len(r.json()["note"]["addenda"]) == 1


def test_admin_cannot_write_counselor_note(client, tokens):
    with _db() as db:
        s = db.scalar(select(ClinicalSession).where(ClinicalSession.status == "completed"))
    r = client.put(f"/api/sessions/{s.id}/note", headers=tokens["admin"], json={"data": "x"})
    assert r.status_code == 403


def test_referral_accept_assigns_and_opens_case(client, tokens):
    refs = client.get("/api/referrals?status=new", headers=tokens["admin"]).json()
    assert refs, "seed should include new referrals"
    ref = refs[0]
    counselors = client.get("/api/counselors", headers=tokens["admin"]).json()
    maya = next(c for c in counselors if c["full_name"] == "Maya Okafor")

    bad = client.post(f"/api/referrals/{ref['id']}/decision", headers=tokens["admin"], json={"action": "accept"})
    assert bad.status_code == 422

    r = client.post(
        f"/api/referrals/{ref['id']}/decision",
        headers=tokens["admin"],
        json={"action": "accept", "counselor_id": maya["id"]},
    )
    assert r.status_code == 200 and r.json()["status"] == "accepted"
    detail = client.get(f"/api/students/{ref['student']['id']}", headers=tokens["maya"]).json()
    assert detail["case"]["status"] == "open"

    again = client.post(
        f"/api/referrals/{ref['id']}/decision", headers=tokens["admin"], json={"action": "decline", "note": "x"}
    )
    assert again.status_code == 409


def test_decline_requires_reason(client, tokens):
    ref = client.get("/api/referrals?status=new", headers=tokens["admin"]).json()[0]
    r = client.post(f"/api/referrals/{ref['id']}/decision", headers=tokens["admin"], json={"action": "decline"})
    assert r.status_code == 422


def test_billing_export_only_ready_lines(client, tokens):
    today = clock.today()
    start, end = today - timedelta(days=120), today
    body = client.get(f"/api/billing/lines?start={start}&end={end}", headers=tokens["billing"]).json()
    ready = [line["session_id"] for line in body["lines"] if line["state"] == "ready"]
    blocked = [line["session_id"] for line in body["lines"] if line["state"] == "blocked"]
    assert ready and blocked, "seed should produce both ready and blocked lines"

    r = client.post(
        "/api/billing/exports",
        headers=tokens["billing"],
        json={"period_start": str(start), "period_end": str(end), "session_ids": blocked[:1]},
    )
    assert r.status_code == 409

    r = client.post(
        "/api/billing/exports",
        headers=tokens["billing"],
        json={"period_start": str(start), "period_end": str(end), "session_ids": ready[:5]},
    )
    assert r.status_code == 201, r.text
    export_id = r.json()["id"]
    csv_text = client.get(f"/api/billing/exports/{export_id}/csv", headers=tokens["billing"]).text
    assert csv_text.splitlines()[0].startswith("service_date,medicaid_id")
    assert len(csv_text.strip().splitlines()) == 6

    # Exported sessions are locked.
    locked = client.patch(f"/api/sessions/{ready[0]}", headers=tokens["admin"], json={"status": "cancelled"})
    assert locked.status_code == 409


def test_audit_log_records_views(client, tokens):
    sid = _student_of("maya.okafor@riverbend.example")
    client.get(f"/api/students/{sid}", headers=tokens["maya"])
    events = client.get(f"/api/admin/audit?student_id={sid}", headers=tokens["admin"]).json()
    assert any(e["action"] == "view" and e["user"] == "Maya Okafor" for e in events)
    assert client.get("/api/admin/audit", headers=tokens["maya"]).status_code == 403
