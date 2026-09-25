import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { fmt, titleCase } from '../../format'
import { Empty, Loading, selTone } from '../../ui'
import type { SchoolData, StudentDetail } from '../../types'

export default function ProfileTab({ studentId, student }: { studentId: number; student: StudentDetail }) {
  const data = useQuery({
    queryKey: ['school-data', studentId],
    queryFn: () => api.get<SchoolData>(`/api/students/${studentId}/school-data`),
  })

  const years = new Map<string, SchoolData['grades']>()
  for (const g of data.data?.grades ?? []) {
    years.set(g.school_year, [...(years.get(g.school_year) ?? []), g])
  }

  return (
    <div className="stack">
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Student</h2>
          </div>
          <div className="panel-body">
            <dl className="kv">
              <dt>Legal name</dt>
              <dd>
                {student.first_name} {student.last_name}
              </dd>
              <dt>Date of birth</dt>
              <dd className="num">{fmt.dayYear(student.date_of_birth)}</dd>
              <dt>School and grade</dt>
              <dd>
                {student.school.name}, grade {student.grade}
              </dd>
              <dt>Primary language</dt>
              <dd>{student.primary_language}</dd>
              <dt>Programs</dt>
              <dd>
                {[student.iep && 'IEP', student.has_504 && '504 plan', student.ell && 'English language learner']
                  .filter(Boolean)
                  .join(', ') || 'None'}
              </dd>
              <dt>Medicaid ID</dt>
              <dd className="num">{student.medicaid_id ?? 'Not enrolled'}</dd>
            </dl>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Guardian</h2>
          </div>
          <div className="panel-body">
            <dl className="kv" style={{ gridTemplateColumns: '110px minmax(0,1fr)' }}>
              <dt>Name</dt>
              <dd>{student.guardian_name}</dd>
              <dt>Relationship</dt>
              <dd>{student.guardian_relationship}</dd>
              <dt>Phone</dt>
              <dd className="num">{student.guardian_phone}</dd>
              <dt>Email</dt>
              <dd>{student.guardian_email ?? 'None'}</dd>
            </dl>
          </div>
        </section>
      </div>

      {data.isLoading || !data.data ? (
        <Loading />
      ) : (
        <>
          <div className="grid-2">
            <section className="panel">
              <div className="panel-head">
                <h2>Grades</h2>
              </div>
              {years.size === 0 ? (
                <Empty title="No grades on record" />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>School year</th>
                      {['Q1', 'Q2', 'Q3', 'Q4', 'Final'].map((t) => (
                        <th key={t} className="right">
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(years).reverse().map(([year, grades]) => (
                      <tr key={year}>
                        <td className="strong">{year}</td>
                        {['Q1', 'Q2', 'Q3', 'Q4', 'Final'].map((t) => {
                          const g = grades.find((x) => x.term === t)
                          return (
                            <td key={t} className={`right num ${t === 'Final' ? 'strong' : ''}`}>
                              {g ? g.gpa.toFixed(2) : <span className="faint">None</span>}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Attendance by month</h2>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="right">Days present</th>
                    <th className="right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.data.attendance].reverse().slice(0, 8).map((m) => (
                    <tr key={m.month}>
                      <td>{fmt.monthYear(m.month)}</td>
                      <td className="right num">
                        {m.present} of {m.days}
                      </td>
                      <td className="right num strong" style={{ color: m.rate < 90 ? 'var(--watch)' : undefined }}>
                        {m.rate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <div className="grid-2">
            <section className="panel">
              <div className="panel-head">
                <h2>Behavior incidents</h2>
                <span className="small muted">Last 12 months</span>
              </div>
              {data.data.incidents.length === 0 ? (
                <Empty title="No incidents reported" />
              ) : (
                <ul className="list">
                  {data.data.incidents.slice(0, 12).map((i) => (
                    <li key={i.id}>
                      <span className="small muted num" style={{ width: 56, flex: 'none' }}>
                        {fmt.day(i.date)}
                      </span>
                      <div className="grow">
                        <div className="small strong">{i.category}</div>
                        <div className="xs muted">
                          {i.description} Reported by {i.reported_by}.
                        </div>
                      </div>
                      {i.severity === 'major' && <span className="chip concern">Major</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="stack">
              <section className="panel">
                <div className="panel-head">
                  <h2>Teacher check-ins</h2>
                </div>
                <ul className="list">
                  {data.data.sel_ratings.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      <span className={`dot ${r.rating}`} />
                      <div className="grow">
                        <div className="small">
                          <span className={`strong`} style={{ color: `var(--${selTone(r.rating)})` }}>
                            {titleCase(r.rating)}
                          </span>{' '}
                          from {r.rater}
                        </div>
                        {r.comment && <div className="xs muted">{r.comment}</div>}
                      </div>
                      <span className="xs faint">{fmt.day(r.date)}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Nurse visits</h2>
                </div>
                {data.data.nurse_visits.length === 0 ? (
                  <Empty title="No visits in the last 12 months" />
                ) : (
                  <ul className="list">
                    {data.data.nurse_visits.slice(0, 6).map((v) => (
                      <li key={v.id}>
                        <span className="small muted num" style={{ width: 56, flex: 'none' }}>
                          {fmt.day(v.date)}
                        </span>
                        <div className="grow small">{v.reason}</div>
                        <span className="xs muted">{titleCase(v.outcome)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
