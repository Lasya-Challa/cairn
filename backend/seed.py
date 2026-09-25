"""Synthetic demo data. Every person and record here is fictional.

Generates one district with three schools, five staff accounts and about forty
students, with a full prior school year and the current year up to today:
attendance, incidents, nurse visits, grades, SEL check-ins, referrals, cases,
consents, PHQ-9 and GAD-7 assessments, treatment plans, sessions and notes.

Dates are generated relative to today, so the demo always looks current.
Run:  python -m seed          (drops and recreates all tables)
"""

import random
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app import clock
from app.clinical import INSTRUMENTS, school_year_bounds, school_year_of, severity_for
from app.config import get_settings
from app.db import Base, SessionLocal, engine
from app.models import (
    Assessment,
    AttendanceRecord,
    BehaviorIncident,
    Case,
    Consent,
    District,
    Goal,
    GradeRecord,
    NurseVisit,
    Referral,
    School,
    SELRating,
    Session,
    SessionNote,
    Student,
    TreatmentPlan,
    User,
)
from app.security import hash_password

PASSWORD = "demo1234"
rng = random.Random(20260925)
TZ = ZoneInfo(get_settings().district_timezone)
TODAY = clock.today()
NOW = clock.now()

FIRST_NAMES = [
    "Amara",
    "Mateo",
    "Lily",
    "Jayden",
    "Sofia",
    "Ethan",
    "Zoe",
    "Malik",
    "Isabella",
    "Noah",
    "Aaliyah",
    "Diego",
    "Harper",
    "Kai",
    "Nadia",
    "Owen",
    "Priya",
    "Elijah",
    "Camila",
    "Lucas",
    "Imani",
    "Ryan",
    "Mia",
    "Andre",
    "Leah",
    "Tariq",
    "Grace",
    "Jonah",
    "Valeria",
    "Caleb",
    "Hana",
    "Marcus",
    "Ruby",
    "Santiago",
    "Ava",
    "Darius",
    "Chloe",
    "Emeka",
    "Nora",
    "Luis",
    "Yara",
    "Gabriel",
    "Esme",
    "Theo",
]
LAST_NAMES = [
    "Nguyen",
    "Okafor",
    "Martinez",
    "Johnson",
    "Patel",
    "Williams",
    "Garcia",
    "Kim",
    "Brown",
    "Hernandez",
    "Davis",
    "Lopez",
    "Wilson",
    "Ahmed",
    "Taylor",
    "Rivera",
    "Thomas",
    "Moore",
    "Jackson",
    "Chen",
    "Lee",
    "Walker",
    "Scott",
    "Green",
    "Baker",
    "Adams",
    "Nelson",
    "Hill",
    "Campbell",
    "Mitchell",
    "Roberts",
    "Carter",
    "Phillips",
    "Evans",
    "Turner",
    "Torres",
    "Parker",
    "Collins",
    "Edwards",
    "Stewart",
    "Morris",
    "Murphy",
    "Cook",
    "Rogers",
]
TEACHERS = ["Ms. Albright", "Mr. Coleman", "Mrs. Duarte", "Mr. Fischer", "Ms. Haddad", "Mrs. Ingram", "Mr. Kowalski"]
LANGUAGES = ["Spanish", "Vietnamese", "Arabic", "Swahili", "Tagalog"]


# ---------- calendar ----------


def school_days(start: date, end: date) -> list[date]:
    """Weekdays between start and end, minus common breaks."""
    days = []
    d = start
    while d <= end:
        if d.weekday() < 5 and not _is_break(d):
            days.append(d)
        d += timedelta(days=1)
    return days


def _is_break(d: date) -> bool:
    y = d.year
    # Thanksgiving week: the week containing the 4th Thursday of November.
    if d.month == 11:
        nov1 = date(y, 11, 1)
        thanksgiving = nov1 + timedelta(days=(3 - nov1.weekday()) % 7 + 21)
        if thanksgiving - timedelta(days=3) <= d <= thanksgiving + timedelta(days=1):
            return True
    if (d.month == 12 and d.day >= 22) or (d.month == 1 and d.day <= 2):
        return True
    if d.month == 3 and 9 <= d.day <= 13:  # spring break
        return True
    if (d.month == 9 and d.day == 1 and d.weekday() == 0) or (d.month == 1 and 15 <= d.day <= 21 and d.weekday() == 0):
        return True  # Labor Day, MLK Day
    return False


def year_terms(label: str) -> tuple[date, date]:
    """First and last instructional day of a school year."""
    start, _ = school_year_bounds(label)
    first = start + timedelta(days=11)  # about Aug 12
    last = date(start.year + 1, 5, 22)
    return first, last


CURRENT_YEAR = school_year_of(TODAY)
PRIOR_YEAR = f"{int(CURRENT_YEAR[:4]) - 1}-{CURRENT_YEAR[2:4]}"
PRIOR_PRIOR_YEAR = f"{int(CURRENT_YEAR[:4]) - 2}-{str(int(CURRENT_YEAR[:4]) - 1)[2:4]}"
PRIOR_FIRST, PRIOR_LAST = year_terms(PRIOR_YEAR)
CUR_FIRST, CUR_LAST = year_terms(CURRENT_YEAR)
ALL_DAYS = school_days(PRIOR_FIRST, PRIOR_LAST) + school_days(CUR_FIRST, min(CUR_LAST, TODAY))
DAY_SET = set(ALL_DAYS)
# Generated school data kept in memory so goal baselines match the records.
ATTENDANCE: dict[int, dict[date, str]] = {}  # student_id -> day -> status
INCIDENT_DAYS: dict[int, list[date]] = {}
SEL_HISTORY: dict[int, list[tuple[date, str]]] = {}


def at_local(d: date, hh: int, mm: int) -> datetime:
    return clock.to_naive_utc(datetime.combine(d, time(hh, mm), tzinfo=TZ))


def next_school_day(d: date) -> date:
    while d.weekday() >= 5 or _is_break(d):
        d += timedelta(days=1)
    return d


# ---------- student profiles ----------


class Profile:
    """Latent trajectory that drives all of one student's generated data."""

    def __init__(self, level: str, concern: str, course: str, severity: float):
        self.level = level
        self.concern = concern  # depression | anxiety | behavior | attendance
        self.course = course  # improving | flat | worsening
        self.severity = severity  # 0..1 at case start

    def distress(self, progress: float) -> float:
        """Distress 0..1 given the fraction of the treatment period elapsed."""
        if self.course == "improving":
            value = self.severity * (1 - 0.6 * progress)
        elif self.course == "worsening":
            value = self.severity * (1 + 0.35 * progress)
        else:
            value = self.severity * (1 - 0.1 * progress)
        return max(0.05, min(1.0, value + rng.uniform(-0.06, 0.06)))


def item_responses(n_items: int, total: int, safety_index: int | None, safety: int) -> list[int]:
    """Spread a total across items, each 0..3."""
    responses = [0] * n_items
    remaining = total
    if safety_index is not None:
        responses[safety_index] = safety
        remaining -= safety
    order = [i for i in range(n_items) if i != safety_index]
    while remaining > 0:
        i = rng.choice(order)
        if responses[i] < 3:
            responses[i] += 1
            remaining -= 1
        if all(responses[j] == 3 for j in order):
            break
    return responses


# ---------- note text ----------

DATA_LINES = {
    "depression": [
        "Student reported low energy most mornings and said it has been hard to get started on assignments.",
        "Student described spending more time alone at lunch this week and skipping an after-school club meeting.",
        "Student shared that sleep has been irregular, often after midnight on school nights.",
        "Student reported a better week overall and named two moments that went well with friends.",
    ],
    "anxiety": [
        "Student reported worry before tests and described a racing heart during a quiz on Tuesday.",
        "Student said they avoided raising their hand in class because of fear of being wrong.",
        "Student described difficulty falling asleep while thinking about grades and upcoming deadlines.",
        "Student reported using the breathing exercise twice this week before presentations.",
    ],
    "behavior": [
        "Teacher report indicated two classroom disruptions this week, both during transitions.",
        "Student described feeling frustrated when redirected and said it happens most in afternoon classes.",
        "Student reported an argument with a peer at lunch that did not escalate.",
        "Student earned full points on the daily behavior card three of five days.",
    ],
    "attendance": [
        "Student missed two days this week and reported trouble getting up in the morning.",
        "Student said the first period class feels hardest to attend and described feeling behind.",
        "Guardian reported that transportation has been unreliable on some mornings.",
        "Student attended every day this week and arrived on time four of five days.",
    ],
}
ASSESSMENT_LINES = [
    "Presentation is consistent with current treatment goals; student engaged throughout the session.",
    "Student demonstrated partial use of coping strategies and was able to identify triggers with prompting.",
    "Progress is gradual. Student is more open about stressors than at intake.",
    "Student appeared tired but participated. Symptoms appear stable compared with last session.",
    "Student independently applied a skill from prior sessions, which indicates growing generalization.",
]
PLAN_LINES = [
    "Continue weekly sessions. Practice the thought record twice before next meeting.",
    "Coordinate with the classroom teacher on a signal for taking a short break.",
    "Review the morning routine plan with the guardian by phone this week.",
    "Readminister the screening measure at the next monthly check.",
    "Continue current plan; add a check-in with the student on Monday morning.",
]
INTERVENTIONS = {
    "depression": ["Behavioral activation", "Cognitive restructuring", "Mood monitoring"],
    "anxiety": ["Relaxation training", "Cognitive restructuring", "Graded exposure"],
    "behavior": ["Social skills practice", "Emotion regulation skills", "Positive reinforcement plan"],
    "attendance": ["Motivational interviewing", "Problem solving", "Family engagement"],
}
REFERRAL_REASONS = {
    "depression": "Student has seemed withdrawn for several weeks, is not completing work, and put their head down in class most days.",
    "anxiety": "Student becomes visibly distressed before tests and has asked to go to the nurse several times during assessments.",
    "behavior": "Repeated classroom disruptions and two conflicts with peers this month. Redirection is not working consistently.",
    "attendance": "Chronic absences this semester and several late arrivals. Student says they feel behind and overwhelmed.",
}
CONCERN_TAGS = {
    "depression": ["Low mood", "Withdrawal", "Declining grades"],
    "anxiety": ["Test anxiety", "Somatic complaints", "Avoidance"],
    "behavior": ["Disruption", "Peer conflict", "Emotional regulation"],
    "attendance": ["Chronic absence", "Tardiness", "Disengagement"],
}
APPROACH = {
    "depression": "Cognitive behavioral therapy",
    "anxiety": "Cognitive behavioral therapy",
    "behavior": "Skills-based counseling",
    "attendance": "Motivational interviewing",
}


def main() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    pw = hash_password(PASSWORD)

    district = District(name="Riverbend Unified School District", state="TX")
    db.add(district)
    db.flush()
    schools = {
        "elementary": School(district_id=district.id, name="Cedar Hollow Elementary", level="elementary"),
        "middle": School(district_id=district.id, name="Lakeside Middle School", level="middle"),
        "high": School(district_id=district.id, name="Northfield High School", level="high"),
    }
    db.add_all(schools.values())

    def staff(email, name, role, cred=None):
        u = User(district_id=district.id, email=email, full_name=name, role=role, credentials=cred, password_hash=pw)
        db.add(u)
        return u

    counselors = [
        staff("maya.okafor@riverbend.example", "Maya Okafor", "counselor", "LCSW"),
        staff("daniel.reyes@riverbend.example", "Daniel Reyes", "counselor", "LPC"),
        staff("hannah.brooks@riverbend.example", "Hannah Brooks", "counselor", "LSSP"),
    ]
    admin = staff("grace.whitfield@riverbend.example", "Grace Whitfield", "admin", "Director of Student Services")
    staff("tom.alvarez@riverbend.example", "Tom Alvarez", "billing", "Medicaid Billing Specialist")
    db.flush()

    # Which counselor covers which level. Maya: middle, Daniel: high, Hannah: elementary + overflow.
    coverage = {"middle": counselors[0], "high": counselors[1], "elementary": counselors[2]}

    # Student roster plan: (level, count with open cases, closed cases, referral-only)
    plan = [("middle", 11, 2, 3), ("high", 11, 2, 3), ("elementary", 7, 1, 2)]
    names = list(zip(rng.sample(FIRST_NAMES, len(FIRST_NAMES)), rng.sample(LAST_NAMES, len(LAST_NAMES))))
    sid_counter = 480210

    for level, n_open, n_closed, n_ref in plan:
        for kind, count in (("open", n_open), ("closed", n_closed), ("referral", n_ref)):
            for _ in range(count):
                first, last = names.pop()
                sid_counter += rng.randint(7, 61)
                make_student(
                    db,
                    district,
                    schools[level],
                    level,
                    kind,
                    first,
                    last,
                    str(sid_counter),
                    coverage[level],
                    counselors,
                    admin,
                )

    db.commit()
    db.close()
    print(f"Seeded demo data through {TODAY}. Sign in with any demo account; password: {PASSWORD}")


def make_student(db, district, school, level, kind, first, last, sid, counselor, counselors, admin):
    grade = {"elementary": rng.randint(2, 5), "middle": rng.randint(6, 8), "high": rng.randint(9, 12)}[level]
    age = grade + 5
    ell = rng.random() < 0.18
    iep = rng.random() < 0.25
    has_504 = (not iep) and rng.random() < 0.12
    guardian_first = rng.choice(
        ["Rosa", "James", "Adaeze", "Linh", "Carlos", "Monique", "Samir", "Beth", "Kwame", "Elena"]
    )
    student = Student(
        district_id=district.id,
        school_id=school.id,
        district_student_id=sid,
        first_name=first,
        last_name=last,
        preferred_name=None,
        grade=grade,
        date_of_birth=date(TODAY.year - age - (1 if TODAY.month < 9 else 0), rng.randint(1, 12), rng.randint(1, 28)),
        ell=ell,
        iep=iep,
        has_504=has_504,
        primary_language=rng.choice(LANGUAGES) if ell else "English",
        guardian_name=f"{guardian_first} {last}",
        guardian_relationship=rng.choice(["Mother", "Father", "Grandmother", "Aunt", "Guardian"]),
        guardian_phone=f"(713) 555-{rng.randint(1000, 9999)}",
        guardian_email=f"{guardian_first.lower()}.{last.lower()}@mail.example",
        medicaid_id=f"TX{rng.randint(10**8, 10**9 - 1)}" if rng.random() < 0.8 else None,
    )
    db.add(student)
    db.flush()

    concerns = (
        ["behavior", "attendance"] if level == "elementary" else ["depression", "anxiety", "behavior", "attendance"]
    )
    weights = [3, 2] if level == "elementary" else [3, 3, 2, 2]
    concern = rng.choices(concerns, weights)[0]
    course = rng.choices(["improving", "flat", "worsening"], [7, 2, 1])[0]
    profile = Profile(level, concern, course, rng.uniform(0.45, 0.9))

    # When services started. Continuing students began last year; new ones this fall.
    if kind == "open":
        continuing = rng.random() < 0.5 and (CUR_FIRST - PRIOR_FIRST).days > 0
        case_start = (
            next_school_day(PRIOR_FIRST + timedelta(days=rng.randint(40, 170)))
            if continuing
            else next_school_day(CUR_FIRST + timedelta(days=rng.randint(3, max(4, (TODAY - CUR_FIRST).days - 18))))
        )
        case_end = None
    elif kind == "closed":
        case_start = next_school_day(PRIOR_FIRST + timedelta(days=rng.randint(20, 90)))
        case_end = next_school_day(case_start + timedelta(days=rng.randint(90, 150)))
    else:
        case_start = None
        case_end = None

    generate_school_data(db, student, profile, case_start, case_end)

    if kind == "referral":
        make_pending_referral(db, student, profile, counselor, admin)
        return

    student.counselor_id = counselor.id if kind == "open" else None
    referral_day = case_start - timedelta(days=rng.randint(3, 8))
    referral = Referral(
        student_id=student.id,
        source=rng.choice(["teacher", "teacher", "parent", "screening", "staff"]),
        referred_by=rng.choice(TEACHERS),
        reason=REFERRAL_REASONS[profile.concern],
        concerns=rng.sample(CONCERN_TAGS[profile.concern], 2),
        urgency=rng.choices(["routine", "priority", "urgent"], [6, 3, 1])[0],
        status="accepted",
        assigned_counselor_id=counselor.id,
        decided_by_id=admin.id,
        decided_at=at_local(referral_day + timedelta(days=1), 15, 10),
        created_at=at_local(referral_day, 11, 40),
    )
    db.add(referral)
    db.flush()
    case = Case(
        student_id=student.id,
        counselor_id=counselor.id,
        referral_id=referral.id,
        status="open" if kind == "open" else "closed",
        opened_at=case_start,
        closed_at=case_end,
        discharge_reason=None if case_end is None else "Treatment goals met. Student and guardian agreed to discharge.",
    )
    db.add(case)
    db.flush()

    has_telehealth = make_consents(db, student, case_start, counselor, kind)
    make_clinical_record(db, student, profile, case, counselor, case_start, case_end, has_telehealth)


def generate_school_data(db, student, profile, case_start, case_end):
    """Attendance, incidents, nurse visits, grades and SEL ratings for both years."""
    base_attend = 0.955 if profile.concern != "attendance" else 0.86
    base_incidents = 0.4 if profile.concern != "behavior" else 3.2  # per month

    def distress_on(d: date) -> float:
        if case_start is None:
            return profile.severity * 0.7
        if d < case_start:
            return profile.severity
        span_end = case_end or TODAY
        span = max(30, (span_end - case_start).days)
        return profile.distress(min(1.0, (d - case_start).days / span))

    attendance = []
    for d in ALL_DAYS:
        stress = distress_on(d)
        p_absent = max(0.01, (1 - base_attend) * (0.6 + stress))
        r = rng.random()
        if r < p_absent:
            status = "excused" if rng.random() < 0.3 else "absent"
        elif r < p_absent + 0.04:
            status = "tardy"
        else:
            status = "present"
        attendance.append(AttendanceRecord(student_id=student.id, day=d, status=status))
    db.add_all(attendance)
    ATTENDANCE[student.id] = {r.day: r.status for r in attendance}

    # Incidents: monthly Poisson-like draw, spread over school days of that month.
    months: dict[date, list[date]] = {}
    for d in ALL_DAYS:
        months.setdefault(d.replace(day=1), []).append(d)
    INCIDENT_DAYS[student.id] = []
    SEL_HISTORY[student.id] = []
    categories = ["Classroom disruption", "Defiance", "Peer conflict", "Inappropriate language", "Leaving class"]
    for month, days in months.items():
        rate = base_incidents * (0.4 + distress_on(days[len(days) // 2]))
        count = sum(1 for _ in range(12) if rng.random() < rate / 12)
        for d in sorted(rng.sample(days, min(count, len(days)))):
            INCIDENT_DAYS[student.id].append(d)
            category = rng.choice(categories)
            db.add(
                BehaviorIncident(
                    student_id=student.id,
                    occurred_on=d,
                    category=category,
                    severity="major" if rng.random() < 0.15 else "minor",
                    description=f"{category} reported during {rng.choice(['math', 'ELA', 'science', 'lunch', 'PE', 'a transition'])}.",
                    reported_by=rng.choice(TEACHERS),
                )
            )

    reasons = ["Headache", "Stomachache", "Minor injury", "Feeling unwell", "Medication", "Fatigue"]
    somatic = 2.0 if profile.concern == "anxiety" else 0.8
    for month, days in months.items():
        count = sum(1 for _ in range(8) if rng.random() < somatic * distress_on(days[0]) / 8)
        for d in rng.sample(days, min(count, len(days))):
            db.add(
                NurseVisit(
                    student_id=student.id,
                    visited_on=d,
                    reason=rng.choice(reasons),
                    outcome=rng.choices(["returned_to_class", "parent_contacted", "sent_home"], [7, 2, 1])[0],
                )
            )

    # Grades: quarters and a final for each completed year, lower when distress is high.
    base_gpa = rng.uniform(2.6, 3.8)
    for label in (PRIOR_PRIOR_YEAR, PRIOR_YEAR, CURRENT_YEAR):
        first, last = year_terms(label)
        quarter_ends = [first + timedelta(days=int(i * (last - first).days / 4)) for i in range(1, 5)]
        gpas = []
        for q, end in enumerate(quarter_ends, start=1):
            if end > TODAY:
                break
            stress = distress_on(end) if label != PRIOR_PRIOR_YEAR else profile.severity * 0.6
            gpa = round(max(0.8, min(4.0, base_gpa - 1.1 * stress + rng.uniform(-0.2, 0.2))), 2)
            gpas.append(gpa)
            db.add(GradeRecord(student_id=student.id, school_year=label, term=f"Q{q}", gpa=gpa, recorded_on=end))
        if len(gpas) == 4:
            db.add(
                GradeRecord(
                    student_id=student.id,
                    school_year=label,
                    term="Final",
                    gpa=round(sum(gpas) / 4, 2),
                    recorded_on=last,
                )
            )

    # Monthly teacher SEL check-in (first school week of each month).
    for month, days in months.items():
        stress = distress_on(days[0])
        rating = "red" if stress > 0.62 else "yellow" if stress > 0.38 else "green"
        SEL_HISTORY[student.id].append((days[min(2, len(days) - 1)], rating))
        db.add(
            SELRating(
                student_id=student.id,
                rated_on=days[min(2, len(days) - 1)],
                rating=rating,
                rater=rng.choice(TEACHERS),
                comment={
                    "red": "Needs frequent support to stay engaged.",
                    "yellow": "Engaged some days; needs reminders.",
                    "green": "Participating and completing work.",
                }[rating],
            )
        )


def make_pending_referral(db, student, profile, counselor, admin):
    status = rng.choices(["new", "declined"], [4, 1])[0]
    created = TODAY - timedelta(days=rng.randint(0, 9))
    urgency = rng.choices(["routine", "priority", "urgent"], [5, 3, 1])[0]
    db.add(
        Referral(
            student_id=student.id,
            source=rng.choice(["teacher", "parent", "screening", "self"]),
            referred_by=rng.choice(TEACHERS) if rng.random() < 0.7 else student.guardian_name,
            reason=REFERRAL_REASONS[profile.concern],
            concerns=rng.sample(CONCERN_TAGS[profile.concern], 2),
            urgency=urgency,
            status=status,
            decision_note="Needs are being met through the existing 504 plan and classroom supports."
            if status == "declined"
            else None,
            decided_by_id=admin.id if status == "declined" else None,
            decided_at=at_local(created + timedelta(days=1), 10, 5) if status == "declined" else None,
            created_at=at_local(created, rng.randint(8, 14), rng.choice([5, 20, 35, 50])),
        )
    )


def make_consents(db, student, case_start, counselor, kind):
    signed = case_start - timedelta(days=rng.randint(0, 2))
    guardian = student.guardian_name
    relation = student.guardian_relationship

    def add(consent_type, expires=None):
        db.add(
            Consent(
                student_id=student.id,
                consent_type=consent_type,
                signer_name=guardian,
                signer_relationship=relation,
                method=rng.choice(["e_signature", "e_signature", "paper"]),
                signed_on=signed,
                expires_on=expires,
                recorded_by_id=counselor.id,
            )
        )

    # Services consent lasts one year; a few are about to expire to exercise alerts.
    expires = signed + timedelta(days=365)
    if kind == "open" and rng.random() < 0.15:
        expires = TODAY + timedelta(days=rng.randint(5, 25))
    add("services", expires)
    if rng.random() < 0.85:
        add("medicaid_billing", expires)
    telehealth = rng.random() < 0.3
    if telehealth:
        add("telehealth", expires)
    return telehealth


def assessment_dates(start: date, end: date) -> list[tuple[date, bool]]:
    """Roughly monthly school days from start to end. A new school year gets a fresh baseline."""
    out: list[tuple[date, bool]] = []
    d = next_school_day(start)
    baseline = True
    while d <= end:
        if PRIOR_LAST < d < CUR_FIRST:
            d = next_school_day(CUR_FIRST + timedelta(days=rng.randint(2, 6)))
            baseline = True
            continue
        out.append((d, baseline))
        baseline = False
        d = next_school_day(d + timedelta(days=rng.randint(26, 34)))
    return out


def make_clinical_record(db, student, profile, case, counselor, case_start, case_end, has_telehealth):
    uses_screeners = profile.level != "elementary"
    end = case_end or TODAY
    span = max(30, (end - case_start).days)

    def distress(d: date) -> float:
        return profile.distress(min(1.0, (d - case_start).days / span))

    # Assessments roughly monthly on school days.
    assessments = []
    if uses_screeners:
        instruments = ["PHQ9", "GAD7"] if profile.concern in ("depression", "anxiety") else ["PHQ9"]
        for d, first in assessment_dates(case_start, end):
            for code in instruments:
                spec = INSTRUMENTS[code]
                primary = (code == "PHQ9" and profile.concern == "depression") or (
                    code == "GAD7" and profile.concern == "anxiety"
                )
                scale = 1.0 if primary else 0.55
                total = round(spec["max"] * 0.75 * distress(d) * scale + rng.uniform(-1.5, 1.5))
                total = max(0, min(spec["max"], total))
                safety = 0
                if code == "PHQ9" and profile.course == "worsening" and d > end - timedelta(days=25) and total >= 12:
                    safety = 1
                responses = item_responses(len(spec["items"]), total, spec["safety_item"], safety)
                total = sum(responses)
                a = Assessment(
                    student_id=student.id,
                    instrument=code,
                    responses=responses,
                    total=total,
                    severity=severity_for(code, total),
                    safety_flag=bool(safety),
                    is_baseline=first,
                    administered_on=d,
                    administered_by_id=counselor.id,
                )
                db.add(a)
                assessments.append(a)
    db.flush()

    # Treatment plans: one per school year the case spans.
    plan_starts = [case_start]
    if case_start < CUR_FIRST and (case_end is None or case_end >= CUR_FIRST):
        plan_starts.append(next_school_day(CUR_FIRST + timedelta(days=5)))
    plans = []
    for i, start in enumerate(plan_starts):
        active = i == len(plan_starts) - 1 and case_end is None
        review = start + timedelta(days=90)
        if active and rng.random() < 0.15:
            review = TODAY - timedelta(days=rng.randint(2, 10))  # overdue review
        tp = TreatmentPlan(
            student_id=student.id,
            case_id=case.id,
            presenting_concerns=REFERRAL_REASONS[profile.concern],
            approach=APPROACH[profile.concern],
            service_frequency="Weekly, 30 minutes" if profile.level == "elementary" else "Weekly, 45 minutes",
            start_date=start,
            review_date=review,
            status="active" if active else "completed",
            created_by_id=counselor.id,
        )
        db.add(tp)
        db.flush()
        plans.append(tp)
        add_goals(db, student, profile, tp, start, assessments, uses_screeners)

    # Weekly sessions from intake until the case closes, plus two weeks ahead for open cases.
    horizon = case_end or (TODAY + timedelta(days=14))
    weekday = rng.randint(0, 4)
    slot = rng.choice([(8, 30), (9, 45), (10, 30), (11, 15), (13, 0), (13, 45), (14, 30)])
    minutes = 30 if profile.level == "elementary" else rng.choice([30, 45, 45])
    d = case_start
    first_session = True
    goal_ids = [g.id for tp in plans for g in tp.goals]
    while d <= horizon:
        if d.weekday() == weekday or first_session:
            day = next_school_day(d)
            if day > horizon or (day > PRIOR_LAST and day < CUR_FIRST):
                d = day + timedelta(days=1)
                continue
            start_dt = at_local(day, *slot)
            session_type = (
                "intake"
                if first_session
                else ("group" if rng.random() < 0.12 else "family" if rng.random() < 0.05 else "individual")
            )
            dur = 60 if session_type in ("intake", "family") else minutes
            modality = "telehealth" if has_telehealth and rng.random() < 0.3 else "in_person"
            if start_dt > NOW:
                status = "scheduled"
            else:
                status = rng.choices(["completed", "no_show", "cancelled"], [88, 7, 5])[0]
                if first_session:
                    status = "completed"
            s = Session(
                student_id=student.id,
                case_id=case.id,
                counselor_id=counselor.id,
                session_type=session_type,
                modality=modality,
                scheduled_start=start_dt,
                duration_minutes=dur,
                status=status,
                location="Video visit" if modality == "telehealth" else "Counseling office",
                billing_status="unbilled",
            )
            db.add(s)
            db.flush()
            if status == "completed":
                write_note(db, s, profile, counselor, goal_ids)
            first_session = False
            d = day + timedelta(days=1)
        else:
            d += timedelta(days=1)


def add_goals(db, student, profile, plan, start, assessments, uses_screeners):
    def baseline_assessment(code):
        candidates = [a for a in assessments if a.instrument == code and a.administered_on >= start]
        return candidates[0] if candidates else None

    def month_attendance(d):
        """Attendance rate over the 20 school days before d."""
        record = ATTENDANCE[student.id]
        days = [x for x in ALL_DAYS if x < d][-20:]
        statuses = [record[x] for x in days if x in record]
        if not statuses:
            return 90.0
        return round(100 * sum(st in ("present", "tardy") for st in statuses) / len(statuses), 1)

    def sel_baseline(d):
        history = SEL_HISTORY[student.id]
        before = [r for day, r in history if day <= d + timedelta(days=10)]
        return {"red": 1, "yellow": 2, "green": 3}[before[-1] if before else history[0][1]]

    def incidents_before(d):
        return float(sum(1 for x in INCIDENT_DAYS[student.id] if d - timedelta(days=30) < x <= d))

    goals = []
    if uses_screeners:
        code = "GAD7" if profile.concern == "anxiety" else "PHQ9"
        a = baseline_assessment(code)
        if a:
            label = "depressive" if code == "PHQ9" else "anxiety"
            description = (
                f"Reduce {label} symptoms to the mild range or below."
                if a.total >= 10
                else f"Keep {label} symptoms in the mild range or below."
            )
            goals.append(
                Goal(
                    domain="mental_health",
                    description=description,
                    metric=code.lower(),
                    comparator="lt",
                    target_value=10,
                    baseline_value=a.total,
                    baseline_date=a.administered_on,
                    tracking="monthly",
                )
            )
    goals.append(
        Goal(
            domain="academic_sel",
            description="Earn a green rating on the monthly teacher SEL check-in.",
            metric="sel_rating",
            comparator="gte",
            target_value=3,
            baseline_value=sel_baseline(start),
            baseline_date=start,
            tracking="monthly",
        )
    )
    if profile.concern == "behavior" or profile.level == "elementary":
        goals.append(
            Goal(
                domain="behavioral",
                description="Reduce behavior incidents to two or fewer per month.",
                metric="behavior_incidents",
                comparator="lte",
                target_value=2,
                baseline_value=incidents_before(start),
                baseline_date=start,
                tracking="daily",
            )
        )
    goals.append(
        Goal(
            domain="attendance",
            description="Maintain attendance at or above 90 percent.",
            metric="attendance_rate",
            comparator="gte",
            target_value=90,
            baseline_value=month_attendance(start),
            baseline_date=start,
            tracking="daily",
        )
    )
    for g in goals:
        g.plan_id = plan.id
        g.student_id = student.id
        db.add(g)
    db.flush()
    db.refresh(plan)


def write_note(db, session, profile, counselor, goal_ids):
    age_hours = (NOW - session.scheduled_start).total_seconds() / 3600
    # Recent sessions are left for the counselor to document.
    if age_hours < 72 and rng.random() < 0.7:
        if rng.random() < 0.5:
            return
        signed = False
    else:
        signed = rng.random() > 0.02
    risk = "none"
    if profile.course == "worsening" and age_hours < 24 * 21:
        risk = rng.choice(["low", "elevated"])
    db.add(
        SessionNote(
            session_id=session.id,
            data=rng.choice(DATA_LINES[profile.concern]),
            assessment=rng.choice(ASSESSMENT_LINES),
            plan=rng.choice(PLAN_LINES),
            interventions=rng.sample(INTERVENTIONS[profile.concern], 2),
            goal_ids=rng.sample(goal_ids, min(2, len(goal_ids))) if goal_ids else [],
            risk_level=risk,
            signed_at=session.scheduled_start + timedelta(hours=rng.randint(1, 20)) if signed else None,
            signed_by_id=counselor.id if signed else None,
        )
    )


if __name__ == "__main__":
    main()
