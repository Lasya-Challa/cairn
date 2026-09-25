import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Video } from 'lucide-react'
import { api } from '../api'
import { useUser } from '../auth'
import { SESSION_TYPE_LABEL, addDays, fmt, isoDay, parseUTC } from '../format'
import { Loading } from '../ui'
import type { Counselor, SessionItem, StudentSummary } from '../types'
import { SessionStatus, useOpenSession } from './Home'
import { ScheduleSessionModal } from './student/Sessions'

function mondayOf(d: Date) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = out.getDay()
  out.setDate(out.getDate() - ((day + 6) % 7))
  return out
}

export default function Schedule() {
  const user = useUser()
  const open = useOpenSession()
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [counselorId, setCounselorId] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [studentId, setStudentId] = useState('')

  const start = isoDay(weekStart)
  const end = isoDay(addDays(weekStart, 4))
  const sessions = useQuery({
    queryKey: ['sessions', start, end, counselorId],
    queryFn: () =>
      api.get<SessionItem[]>(`/api/sessions?start=${start}&end=${end}${counselorId ? `&counselor_id=${counselorId}` : ''}`),
  })
  const counselors = useQuery({
    queryKey: ['counselors'],
    queryFn: () => api.get<Counselor[]>('/api/counselors'),
    enabled: user.role === 'admin',
  })
  const students = useQuery({ queryKey: ['students'], queryFn: () => api.get<StudentSummary[]>('/api/students') })

  const days = useMemo(() => [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i)), [weekStart])
  const byDay = useMemo(() => {
    const map = new Map<string, SessionItem[]>()
    for (const s of sessions.data ?? []) {
      const key = isoDay(parseUTC(s.scheduled_start))
      map.set(key, [...(map.get(key) ?? []), s])
    }
    return map
  }, [sessions.data])

  const todayKey = isoDay(new Date())
  const total = sessions.data?.filter((s) => s.status !== 'cancelled').length ?? 0
  const selected = students.data?.find((s) => String(s.id) === studentId)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Schedule</h1>
          <p>
            Week of {fmt.day(start)}. {total} sessions.
          </p>
        </div>
        <div className="page-actions">
          {user.role === 'admin' && (
            <select className="select" style={{ width: 'auto' }} value={counselorId} onChange={(e) => setCounselorId(e.target.value)} aria-label="Counselor">
              <option value="">All counselors</option>
              {counselors.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          )}
          <div className="row" style={{ gap: 4 }}>
            <button className="btn" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
              <ChevronLeft size={16} />
            </button>
            <button className="btn" onClick={() => setWeekStart(mondayOf(new Date()))}>
              This week
            </button>
            <button className="btn" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
              <ChevronRight size={16} />
            </button>
          </div>
          <button className="btn primary" onClick={() => setScheduling(true)}>
            <Plus size={16} /> Schedule a session
          </button>
        </div>
      </div>

      {sessions.isLoading ? (
        <Loading />
      ) : (
        <div className="stack">
          {days.map((d) => {
            const key = isoDay(d)
            const items = byDay.get(key) ?? []
            return (
              <section key={key} className="panel">
                <div className="panel-head">
                  <h2 style={{ fontSize: 'var(--t-md)' }}>
                    {fmt.shortWeekday(d)}
                    {key === todayKey && (
                      <span className="chip harbor" style={{ marginLeft: 8 }}>
                        Today
                      </span>
                    )}
                  </h2>
                  <span className="xs faint">{items.length ? `${items.length} sessions` : 'No sessions'}</span>
                </div>
                {items.length > 0 && (
                  <ul className="list">
                    {items.map((s) => (
                      <li key={s.id} className="clickable" onClick={() => open(s.id)}>
                        <span className="time">{fmt.time(s.scheduled_start)}</span>
                        <div className="grow">
                          <div className="strong small">{s.student_name}</div>
                          <div className="xs muted row" style={{ gap: 5 }}>
                            {SESSION_TYPE_LABEL[s.session_type]}, {s.duration_minutes} min
                            {s.modality === 'telehealth' && (
                              <>
                                <Video size={12} /> Telehealth
                              </>
                            )}
                            {user.role === 'admin' && <>. {s.counselor_name}</>}
                          </div>
                        </div>
                        <SessionStatus s={s} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      {scheduling && (
        <ScheduleSessionModal
          studentId={studentId ? Number(studentId) : undefined}
          hasCase={selected ? selected.case_status === 'open' : true}
          onClose={() => {
            setScheduling(false)
            setStudentId('')
          }}
          studentPicker={
            <label className="field">
              <span>Student</span>
              <select className="select" value={studentId} onChange={(e) => setStudentId(e.target.value)} data-autofocus>
                <option value="">Choose a student</option>
                {students.data
                  ?.filter((s) => s.counselor)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.last_name}, {s.preferred_name ?? s.first_name} (grade {s.grade})
                    </option>
                  ))}
              </select>
            </label>
          }
        />
      )}
    </>
  )
}
