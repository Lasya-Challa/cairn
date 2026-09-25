import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Search } from 'lucide-react'
import { api } from '../api'
import { useUser } from '../auth'
import { relativeDay } from '../format'
import { Empty, Flags, Loading, ScoreChip, initials } from '../ui'
import type { School, StudentSummary } from '../types'

type Filter = 'all' | 'iep' | '504' | 'ell' | 'alerts'

export default function Students() {
  const user = useUser()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [schoolId, setSchoolId] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const students = useQuery({ queryKey: ['students'], queryFn: () => api.get<StudentSummary[]>('/api/students') })
  const schools = useQuery({ queryKey: ['schools'], queryFn: () => api.get<School[]>('/api/schools') })

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (students.data ?? []).filter((s) => {
      if (needle) {
        const hay = `${s.first_name} ${s.last_name} ${s.preferred_name ?? ''} ${s.district_student_id}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      if (schoolId && String(s.school.id) !== schoolId) return false
      if (filter === 'iep' && !s.iep) return false
      if (filter === '504' && !s.has_504) return false
      if (filter === 'ell' && !s.ell) return false
      if (filter === 'alerts' && !s.alerts.length) return false
      return true
    })
  }, [students.data, q, schoolId, filter])

  const isAdmin = user.role === 'admin'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isAdmin ? 'Students' : 'My caseload'}</h1>
          <p>
            {isAdmin
              ? 'Every student in the district with a record in Cairn.'
              : 'Students assigned to you. Open a student to see their full record.'}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <span className="sr-only">Search students</span>
          <input className="input" placeholder="Search by name or student ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {isAdmin && (
          <select className="select" style={{ width: 'auto' }} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} aria-label="School">
            <option value="">All schools</option>
            {schools.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <div className="segmented" role="group" aria-label="Filter">
          {(
            [
              ['all', 'All'],
              ['alerts', 'With alerts'],
              ['iep', 'IEP'],
              ['504', '504'],
              ['ell', 'ELL'],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className="panel">
        {students.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="No students match these filters">Clear the search or choose another filter.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>School</th>
                  <th>PHQ-9</th>
                  <th>GAD-7</th>
                  <th>Next session</th>
                  {isAdmin && <th>Counselor</th>}
                  <th>Alerts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const name = `${s.preferred_name ?? s.first_name} ${s.last_name}`
                  const high = s.alerts.some((a) => a.level === 'high')
                  return (
                    <tr key={s.id} className="clickable" onClick={() => navigate(`/students/${s.id}`)}>
                      <td>
                        <div className="row">
                          <span className="avatar sm">{initials(name)}</span>
                          <div>
                            <a
                              href={`/students/${s.id}`}
                              className="strong"
                              style={{ color: 'var(--ink)' }}
                              onClick={(e) => {
                                e.preventDefault()
                                navigate(`/students/${s.id}`)
                              }}
                            >
                              {name}
                            </a>
                            <div className="row" style={{ gap: 6, marginTop: 2 }}>
                              <span className="xs faint num">#{s.district_student_id}</span>
                              <Flags iep={s.iep} ell={s.ell} has504={s.has_504} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="small">{s.school.name}</div>
                        <div className="xs faint">Grade {s.grade}</div>
                      </td>
                      <td>
                        <ScoreChip brief={s.latest_phq9} name="PHQ-9" />
                      </td>
                      <td>
                        <ScoreChip brief={s.latest_gad7} name="GAD-7" />
                      </td>
                      <td className="small">
                        {s.next_session ? relativeDay(s.next_session) : <span className="faint">None scheduled</span>}
                      </td>
                      {isAdmin && <td className="small">{s.counselor?.full_name ?? <span className="faint">Unassigned</span>}</td>}
                      <td>
                        {s.alerts.length > 0 ? (
                          <span
                            className={`chip ${high ? 'concern' : 'watch'}`}
                            title={s.alerts.map((a) => a.text).join('\n')}
                          >
                            <AlertTriangle size={13} /> {s.alerts.length}
                          </span>
                        ) : (
                          <span className="faint small">None</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
