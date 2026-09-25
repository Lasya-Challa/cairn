import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Video } from 'lucide-react'
import { api } from '../api'
import { useUser } from '../auth'
import { SESSION_TYPE_LABEL, fmt, relativeDay } from '../format'
import { Empty, Loading } from '../ui'
import type { Counselor, Referral, SessionItem, StudentSummary } from '../types'

export function useOpenSession() {
  const [params, setParams] = useSearchParams()
  return (id: number) => {
    const next = new URLSearchParams(params)
    next.set('session', String(id))
    setParams(next)
  }
}

export function SessionStatus({ s }: { s: SessionItem }) {
  if (s.status === 'scheduled') return <span className="chip outline">Scheduled</span>
  if (s.status === 'no_show') return <span className="chip watch">No show</span>
  if (s.status === 'cancelled') return <span className="chip">Cancelled</span>
  if (s.note_status === 'signed') return <span className="chip good">Signed</span>
  if (s.note_status === 'draft') return <span className="chip watch">Draft note</span>
  return <span className="chip concern">Needs note</span>
}

export default function Home() {
  const user = useUser()
  return user.role === 'admin' ? <DistrictHome /> : <CounselorHome />
}

function CounselorHome() {
  const open = useOpenSession()
  const dash = useQuery({
    queryKey: ['dashboard'],
    queryFn: () =>
      api.get<{ today: SessionItem[]; upcoming: SessionItem[]; notes_to_sign: SessionItem[] }>('/api/dashboard'),
  })
  const students = useQuery({ queryKey: ['students'], queryFn: () => api.get<StudentSummary[]>('/api/students') })

  if (dash.isLoading) return <Loading />
  const d = dash.data!
  const attention = (students.data ?? []).filter((s) => s.alerts.length)
  const remaining = d.today.filter((s) => s.status === 'scheduled').length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{fmt.weekday(new Date())}</h1>
          <p>
            {d.today.length === 0
              ? 'No sessions scheduled today.'
              : `${d.today.length} sessions today, ${remaining} still ahead.`}{' '}
            {d.notes_to_sign.length > 0 && `${d.notes_to_sign.length} notes need your signature.`}
          </p>
        </div>
        <div className="page-actions">
          <Link className="btn" to="/schedule">
            Open schedule
          </Link>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Today</h2>
          </div>
          {d.today.length === 0 ? (
            <Empty title="Nothing on the calendar today">Use the time for documentation or outreach.</Empty>
          ) : (
            <ul className="list">
              {d.today.map((s) => (
                <li key={s.id} className="clickable" onClick={() => open(s.id)}>
                  <span className="time">{fmt.time(s.scheduled_start)}</span>
                  <div className="grow">
                    <div className="strong">{s.student_name}</div>
                    <div className="xs muted row" style={{ gap: 6 }}>
                      {SESSION_TYPE_LABEL[s.session_type]}, {s.duration_minutes} min
                      {s.modality === 'telehealth' && (
                        <>
                          <Video size={13} /> Telehealth
                        </>
                      )}
                    </div>
                  </div>
                  <SessionStatus s={s} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Notes to sign</h2>
            <span className="faint small num">{d.notes_to_sign.length}</span>
          </div>
          {d.notes_to_sign.length === 0 ? (
            <Empty title="All notes are signed" />
          ) : (
            <ul className="list">
              {d.notes_to_sign.slice(0, 8).map((s) => (
                <li key={s.id} className="clickable" onClick={() => open(s.id)}>
                  <div className="grow">
                    <div className="strong small">{s.student_name}</div>
                    <div className="xs muted">
                      {SESSION_TYPE_LABEL[s.session_type]} on {fmt.stampDay(s.scheduled_start)}
                    </div>
                  </div>
                  <span className={`chip ${s.note_status === 'draft' ? 'watch' : 'concern'}`}>
                    {s.note_status === 'draft' ? 'Draft' : 'Not started'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="panel">
          <div className="panel-head">
            <h2>Next 7 days</h2>
          </div>
          {d.upcoming.length === 0 ? (
            <Empty title="No sessions scheduled in the next week" />
          ) : (
            <ul className="list">
              {d.upcoming.slice(0, 10).map((s) => (
                <li key={s.id} className="clickable" onClick={() => open(s.id)}>
                  <span className="small muted" style={{ width: 150, flex: 'none' }}>
                    {relativeDay(s.scheduled_start)}
                  </span>
                  <div className="grow strong small">{s.student_name}</div>
                  <span className="xs muted">{SESSION_TYPE_LABEL[s.session_type]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Needs attention</h2>
          </div>
          {attention.length === 0 ? (
            <Empty title="No open alerts on your caseload" />
          ) : (
            <ul className="list">
              {attention.map((s) => (
                <li key={s.id}>
                  <AlertTriangle
                    size={17}
                    color={s.alerts.some((a) => a.level === 'high') ? 'var(--concern)' : 'var(--watch)'}
                  />
                  <div className="grow">
                    <Link className="strong small" to={`/students/${s.id}`}>
                      {s.preferred_name ?? s.first_name} {s.last_name}
                    </Link>
                    {s.alerts.map((a) => (
                      <div key={a.text} className="xs muted">
                        {a.text}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}

function DistrictHome() {
  const summary = useQuery({
    queryKey: ['admin-summary'],
    queryFn: () =>
      api.get<{
        new_referrals: number
        urgent_referrals: number
        students_served: number
        sessions_this_month: { completed: number; no_show: number; cancelled: number }
      }>('/api/admin/summary'),
  })
  const counselors = useQuery({ queryKey: ['counselors'], queryFn: () => api.get<Counselor[]>('/api/counselors') })
  const referrals = useQuery({ queryKey: ['referrals', 'new'], queryFn: () => api.get<Referral[]>('/api/referrals?status=new') })
  const students = useQuery({ queryKey: ['students'], queryFn: () => api.get<StudentSummary[]>('/api/students') })

  if (summary.isLoading) return <Loading />
  const s = summary.data!
  const held = s.sessions_this_month.completed
  const scheduledPast = held + s.sessions_this_month.no_show
  const safety = (students.data ?? []).filter((st) => st.alerts.some((a) => a.kind === 'safety'))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>District overview</h1>
          <p>Student Services, {fmt.weekday(new Date())}</p>
        </div>
        <div className="page-actions">
          <Link className="btn primary" to="/referrals">
            Review referrals
          </Link>
        </div>
      </div>

      <section className="panel">
        <div className="stat-row">
          <div className="stat">
            <div className="k">Referrals waiting</div>
            <div className="v">{s.new_referrals}</div>
            <div className="d">{s.urgent_referrals ? `${s.urgent_referrals} marked urgent` : 'None marked urgent'}</div>
          </div>
          <div className="stat">
            <div className="k">Students on a caseload</div>
            <div className="v">{s.students_served}</div>
            <div className="d">Across {counselors.data?.length ?? 0} counselors</div>
          </div>
          <div className="stat">
            <div className="k">Sessions held this month</div>
            <div className="v">{held}</div>
            <div className="d">{s.sessions_this_month.cancelled} cancelled</div>
          </div>
          <div className="stat">
            <div className="k">Attendance at sessions</div>
            <div className="v">{scheduledPast ? `${Math.round((100 * held) / scheduledPast)}%` : 'None yet'}</div>
            <div className="d">{s.sessions_this_month.no_show} no shows this month</div>
          </div>
        </div>
      </section>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="panel">
          <div className="panel-head">
            <h2>Waiting for triage</h2>
            <Link className="small" to="/referrals">
              All referrals
            </Link>
          </div>
          {referrals.data?.length ? (
            <ul className="list">
              {referrals.data.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <span className={`chip ${r.urgency === 'urgent' ? 'concern' : r.urgency === 'priority' ? 'watch' : 'outline'}`}>
                    {r.urgency[0].toUpperCase() + r.urgency.slice(1)}
                  </span>
                  <div className="grow">
                    <div className="strong small">{r.student.name}</div>
                    <div className="xs muted">
                      Grade {r.student.grade}, {r.student.school}. From {r.referred_by}
                    </div>
                  </div>
                  <span className="xs faint">{fmt.stampDay(r.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No referrals waiting" />
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Caseloads</h2>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Counselor</th>
                <th className="right">Students</th>
              </tr>
            </thead>
            <tbody>
              {counselors.data?.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="strong">{c.full_name}</div>
                    <div className="xs faint">{c.credentials}</div>
                  </td>
                  <td className="right num strong">{c.caseload}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {safety.length > 0 && (
        <section className="panel" style={{ marginTop: 20 }}>
          <div className="panel-head">
            <h2>Safety follow-up</h2>
          </div>
          <ul className="list">
            {safety.map((st) => (
              <li key={st.id}>
                <AlertTriangle size={17} color="var(--concern)" />
                <div className="grow">
                  <Link className="strong small" to={`/students/${st.id}`}>
                    {st.preferred_name ?? st.first_name} {st.last_name}
                  </Link>
                  <div className="xs muted">
                    {st.school.name}. Counselor: {st.counselor?.full_name ?? 'Unassigned'}
                  </div>
                </div>
                <div className="xs muted" style={{ maxWidth: 360 }}>
                  {st.alerts.filter((a) => a.kind === 'safety').map((a) => a.text).join(' ')}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
