# Cairn: how it works and how to test it

This guide has four parts. Follow them in order the first time.

1. How Cairn works (what the pieces are and how they talk to each other)
2. Run it on your computer
3. Run the automated tests
4. Test it by hand, role by role

A troubleshooting section and a map of which code does what are at the end.

---

## Part 1. How Cairn works

### The big picture

Cairn is two programs that run at the same time, plus a database file.

```
 Your browser
     │  you click and type
     ▼
 Frontend  (React, runs at http://localhost:5173)
     │  sends requests like "GET /api/students"
     ▼
 Backend API  (FastAPI, runs at http://localhost:8000)
     │  checks who you are, applies the rules, reads and writes data
     ▼
 Database  (SQLite file backend/cairn.db, or PostgreSQL with Docker)
```

- The **frontend** is only the screens. It holds no data of its own. Every number you see comes from the API.
- The **backend API** is where all the rules live: who can see what, how PHQ-9 scores are calculated, when a note is locked, when a billing line is ready.
- The **database** stores students, sessions, notes and everything else. The seed script fills it with fictional demo data.

### What happens when you click something

Example: Maya opens a student's record.

1. The browser asks the API for `/api/students/7`, sending Maya's sign-in token.
2. The API checks the token and finds out who Maya is and what her role is.
3. It checks access: is student 7 on Maya's caseload? If not, it refuses (403).
4. It reads the student from the database.
5. It writes an access-log entry: "Maya viewed student 7 at 2:31 PM".
6. It sends the student back as JSON, and the frontend draws the page.

Every screen works this way.

### The three roles

| Role | Demo account | Can do |
| --- | --- | --- |
| Counselor | Maya Okafor (middle school), Daniel Reyes (high school) | Their own caseload only: screenings, plans, sessions, notes, consents |
| Administrator | Grace Whitfield | Everything in the district, assigns referrals, sees the access log |
| Billing | Tom Alvarez | Billing lines and exports only, never clinical notes or scores |

Password for all demo accounts: `demo1234`.

### The care workflow the app follows

```
Referral → Administrator accepts → Case opens → Guardian consent → Screening (PHQ-9/GAD-7)
   → Treatment plan with goals → Weekly sessions → Signed notes → Progress on goals
   → Medicaid billing export
```

### The ideas worth understanding (and explaining in interviews)

1. **Progress is calculated, not typed in.** A goal like "attendance at least 90%" has no stored progress number. Each time you look, the API calculates it from the attendance records. There is one source of truth, so nothing can drift out of sync.
2. **Signed notes are locked.** Once signed, a note cannot be edited. Corrections go into a dated addendum, as in real clinical records.
3. **Safety is always visible.** If PHQ-9 question 9 (thoughts of self-harm) is answered above zero, a red alert appears everywhere that student is shown.
4. **Minimum necessary access.** Billing staff see service dates and codes but never note text or scores.
5. **Everything is logged.** Every view and change of a student record goes into the access log.

---

## Part 2. Run it on your computer

### Step 1. Install the tools (once)

You need:

- **Python 3.11 or newer** (python.org). On Windows, tick "Add Python to PATH" during install.
- **Node.js 20 or newer** (nodejs.org, the LTS version).

Check in a terminal (Windows: PowerShell; Mac: Terminal):

```bash
python --version
node --version
```

On a Mac, if `python` is not found, use `python3` everywhere below.

### Step 2. Unzip the project

Unzip `cairn.zip`, for example into `Documents`. You should see:

```
cairn/
  backend/     the API (Python)
  frontend/    the screens (React)
  docs/        screenshots and this guide
  README.md
  docker-compose.yml
```

### Step 3. Start the backend (terminal 1)

```bash
cd Documents/cairn/backend
python -m venv .venv
```

Activate the virtual environment:

```bash
# Mac/Linux
source .venv/bin/activate
# Windows PowerShell
.venv\Scripts\Activate.ps1
```

You should now see `(.venv)` at the start of the prompt. Then:

```bash
pip install -r requirements.txt
python -m seed
uvicorn app.main:app --reload
```

What each command does:

| Command | What it does |
| --- | --- |
| `python -m venv .venv` | Creates a private Python environment for this project |
| `pip install -r requirements.txt` | Installs FastAPI, SQLAlchemy and the rest |
| `python -m seed` | Creates `cairn.db` and fills it with the fictional district. Expected output: `Seeded demo data through {today}. Sign in with any demo account; password: demo1234` |
| `uvicorn app.main:app --reload` | Starts the API on port 8000 and restarts it when code changes |

**Check:** open http://localhost:8000/api/health. You should see `{"status":"ok"}`. Then open http://localhost:8000/docs to see every API endpoint listed.

Leave this terminal running.

### Step 4. Start the frontend (terminal 2)

Open a second terminal:

```bash
cd Documents/cairn/frontend
npm install
npm run dev
```

`npm install` downloads the React libraries (a minute or two the first time). `npm run dev` starts the screens on port 5173.

**Check:** open http://localhost:5173. You should see the Cairn sign-in page with four demo accounts.

### Step 5. Stop and restart later

- Stop either program with `Ctrl + C` in its terminal.
- Next time, you only need to activate `.venv` and run `uvicorn app.main:app --reload` (terminal 1), then `npm run dev` (terminal 2).
- To reset all data to the fresh demo state, stop the backend, run `python -m seed` again, and start it.

---

## Part 3. Run the automated tests

In terminal 1, stop the API with `Ctrl + C` (or open a third terminal and activate `.venv` there), then:

```bash
cd Documents/cairn/backend
pytest
```

**Expected:** `35 passed`. A warning about `httpx` comes from a library and is harmless.

The tests use their own temporary database, so they never touch your demo data.

| Test file | What it checks |
| --- | --- |
| `tests/test_clinical.py` | PHQ-9 and GAD-7 severity bands at every boundary, the question 9 safety flag, invalid answers rejected, the progress formula, the comparison rules, the trend rule, school-year dates |
| `tests/test_api.py` | Sign-in, 401 without a token, counselors limited to their caseload, billing blocked from student records, counselors blocked from billing, a new screening creating a safety alert, the full note lifecycle (complete, sign, locked, addendum), only the author writes a note, referral accept and decline rules, billing exports only ready lines and locks them, the access log recording views |

To check code style as well:

```bash
pip install ruff
ruff check .
```

---

## Part 4. Test it by hand

Do these in order. Each step says what to do and what you should see. Tick each box as you go. Use the one-click demo accounts on the sign-in page.

### A. Counselor: Maya Okafor

**A1. Home page (Today)**
- [ ] The title is today's date.
- [ ] "Today" lists sessions (on weekdays). "Notes to sign" lists sessions with Draft or Not started tags.
- [ ] The number next to "Today" in the left menu equals the count in "Notes to sign".
- [ ] "Needs attention" lists students with alerts.

**A2. Caseload**
- [ ] Click **My caseload**. About 11 students, all at Lakeside Middle School.
- [ ] Type part of a name in the search box: the list narrows.
- [ ] Click **With alerts**, then **IEP**: each filter narrows the list.

**A3. Student 360 (Overview tab)**
- [ ] Click a student. The header shows name, grade, school, ID, counselor and guardian phone.
- [ ] "Start of the school year" shows seven boxes (PHQ-9, GAD-7, GPA, SEL rating, behavior, attendance, nurse visits).
- [ ] "Progress toward goals" shows each goal with Start, Now, and the trail (hollow circle = start, solid dot = now, green area = goal).
- [ ] "Last 12 months" shows six charts.

**A4. Record a screening (and see the safety alert)**
- [ ] Open the **Assessments** tab and click **Record an assessment**.
- [ ] With PHQ-9 selected, answer every question with 1. The total at the bottom counts up to 9, and "Mild" appears once all are answered.
- [ ] Question 9 turns red and a warning about the risk protocol appears **before** you save.
- [ ] Click **Save assessment**. The toast says "PHQ-9 saved: 9, mild".
- [ ] Go back to **Overview**: a red alert "PHQ-9 item 9 was endorsed..." appears at the top.
- [ ] Record another PHQ-9 with question 9 at 0. The red alert disappears.

**A5. Treatment plan**
- [ ] Open **Plan and goals**. The current plan and its goals are listed.
- [ ] Change a goal's status to Discontinued. The toast says "Goal updated", and that goal disappears from the Overview progress table.
- [ ] Change it back to Active.

**A6. Schedule, complete and sign a session**
- [ ] Open **Sessions** and click **Schedule a session**. Set today's date and a time 2 minutes from now, then save.
- [ ] Wait until that time passes, then open the session. Click **Mark completed**.
- [ ] Try **Sign note** with empty fields: the button is disabled and the hint says all three sections are required.
- [ ] Fill in Data, Assessment and Plan, tick one intervention, and click **Sign note**. A green "Signed... The note is locked" banner appears.
- [ ] The fields are no longer editable. Add an addendum; it appears with a date.

**A7. Consent**
- [ ] Open **Consents** and click **Record consent**. Choose Telehealth and save. It shows as Active.
- [ ] Click **Revoke** and confirm. The row shows "Revoked" with today's date. It is not deleted.

**A8. Timeline and profile**
- [ ] **Support timeline** shows everything newest first, grouped by month. The filters work. Clicking a session opens it.
- [ ] **Profile and school data** shows grades, attendance by month, incidents, check-ins and nurse visits.

**A9. Access limits (important)**
- [ ] Copy the address of one of Maya's students, for example `/students/7`, and change the number until you reach a high school student (Daniel's). The page says "This student is not on your caseload".
- [ ] Maya's menu has no Medicaid billing or Access log. Typing `/billing` in the address bar sends her back home.

Sign out.

### B. Administrator: Grace Whitfield

**B1. District overview**
- [ ] Four figures: referrals waiting, students on a caseload, sessions this month, attendance at sessions.
- [ ] "Waiting for triage", "Caseloads" and "Safety follow-up" panels. The student from step A4 appears in Safety follow-up only if you left question 9 endorsed.

**B2. Referrals**
- [ ] Click **Referrals**. Urgent cards come first, then priority, then routine.
- [ ] Click **Accept and assign** on one, pick Maya, and confirm. The toast says the student was assigned.
- [ ] Click **Decline** on another. The button stays disabled until you type a reason.
- [ ] Click **New referral**, search a student by name, fill in the reason, and submit. It appears under Waiting.
- [ ] Choosing Urgent shows the crisis protocol warning.

**B3. All students and schedule**
- [ ] **Students** shows all 42, with a school filter and a Counselor column.
- [ ] **Schedule**: the week arrows work, and the "All counselors" filter narrows the list.
- [ ] Open one of Maya's unsigned sessions: Grace can read it but cannot write or sign ("Only the counselor who held the session...").

**B4. Access log**
- [ ] Click **Access log**. You see Maya's views, the assessment you created, the note you signed, the consent you revoked, and your referral decisions, each with time and user.
- [ ] Filter by **Sign**: only signatures remain.

Sign out.

### C. Billing: Tom Alvarez

**C1. Billing lines**
- [ ] Tom lands directly on **Medicaid billing**. His menu has no students or referrals.
- [ ] Four figures: Ready, Blocked, Already exported, Not Medicaid-enrolled.
- [ ] "What is blocking lines" lists reasons such as an unsigned note or missing Medicaid consent.
- [ ] The **Blocked** tab shows each blocked line with its reasons in red.

**C2. Export**
- [ ] On **Ready**, tick three lines and click **Export 3 lines as CSV**. A CSV file downloads.
- [ ] Open the CSV. The columns start with `service_date,medicaid_id,...`, and there is one row per line.
- [ ] The three lines move to **Exported**. **Export history** lists the export and can download it again.

**C3. Access limits**
- [ ] Typing `/students` in the address bar sends Tom back to billing.

### D. The connection between features (the best end-to-end check)

This proves the pieces work together.

1. As **Maya**, find a completed session with a Draft or Not started note (Home, Notes to sign) and note the student's name and date.
2. As **Tom**, find that session under **Blocked** with "Session note is not signed".
3. As **Maya**, sign that note.
4. As **Tom**, refresh. The line has moved to **Ready**.
5. Export it. The line moves to **Exported** and appears in **Export history**. From now on the API refuses any change to that session (this lock is covered by the automated tests).

If all of Part 4 passes, the project works end to end.

### E. Phone size check (optional)

In Chrome, press F12, click the phone icon, and choose a width of about 390 px. The menu turns into icons at the top, and no page scrolls sideways.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `python` not found | Use `python3` (Mac), or reinstall Python with "Add to PATH" ticked (Windows) |
| PowerShell says scripts are disabled when activating `.venv` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer Y, then activate again |
| Sign-in page loads but sign-in fails, or pages stay on Loading | The backend is not running. Check terminal 1 and http://localhost:8000/api/health |
| "Address already in use" / port 8000 or 5173 busy | Another copy is still running. Close the old terminal, or use `uvicorn app.main:app --reload --port 8001` and start the frontend with `VITE_API_TARGET=http://localhost:8001 npm run dev` (Mac/Linux) |
| Today shows no sessions | It is a weekend, or the demo was seeded on another day. Run `python -m seed` again |
| Data looks messy after testing | Stop the backend, run `python -m seed`, and start it again |
| `pytest` says "No module named seed" | Run it from inside `backend/`. The included `pyproject.toml` sets the path |

---

## Map: which code does what

### Backend (`backend/`)

| File | Responsibility |
| --- | --- |
| `app/main.py` | Starts the API, adds CORS, connects all routers |
| `app/config.py` | Settings (database, secret key, time zone) from the environment |
| `app/db.py` | Database connection |
| `app/models.py` | Every table: students, sessions, notes, consents, audit events and the rest |
| `app/schemas.py` | Shapes and validation of API input and output |
| `app/security.py` | Password hashing, sign-in tokens, role checks, caseload access, the audit helper |
| `app/clock.py` | Time handling: UTC storage, district-local days |
| `app/clinical.py` | PHQ-9 and GAD-7 scoring, school years, goal progress and trend |
| `app/billing.py` | Service codes, billing readiness checks, CSV export |
| `app/queries.py` | Shared lookups and the student alert rules |
| `app/routers/auth.py` | Sign-in |
| `app/routers/students.py` | Caseload list, record, Student 360, trends, school data, timeline |
| `app/routers/clinical.py` | Screenings, plans, goals, consents |
| `app/routers/sessions.py` | Sessions, notes, signing, addenda, home dashboard |
| `app/routers/referrals.py` | Referrals and decisions |
| `app/routers/admin.py` | Schools, counselors, billing, administrator summary, access log |
| `seed.py` | Generates the fictional district |
| `tests/` | Automated tests |

### Frontend (`frontend/src/`)

| File | Responsibility |
| --- | --- |
| `main.tsx`, `App.tsx` | Startup, routes, the side menu, role guards |
| `api.ts` | Talks to the backend, adds the sign-in token, handles errors and downloads |
| `auth.tsx` | Sign-in state |
| `format.ts` | Dates, times and labels |
| `ui.tsx` | Shared pieces: drawer, dialog, toast, chips, loading and empty states |
| `charts.tsx` | The goal trail and the charts |
| `index.css` | All styling: colors, fonts, layout |
| `pages/Login.tsx` | Sign-in page |
| `pages/Home.tsx` | Counselor home and administrator overview |
| `pages/Students.tsx` | Caseload list |
| `pages/StudentRecord.tsx` | Student header and tabs |
| `pages/student/*.tsx` | Overview, Assessments, Plan, Sessions, Timeline, Consents, Profile tabs |
| `pages/SessionDrawer.tsx` | The session and note panel |
| `pages/Referrals.tsx`, `Schedule.tsx`, `Billing.tsx`, `Audit.tsx` | Those pages |
