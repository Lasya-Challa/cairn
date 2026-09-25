import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, Minus, Video } from 'lucide-react'
import { api } from '../../api'
import { GAD_BANDS, GoalTrail, PHQ_BANDS, RatingStrip, TrendChart, formatValue } from '../../charts'
import { DOMAIN_LABEL, SESSION_TYPE_LABEL, fmt, relativeDay } from '../../format'
import { Empty, Loading, selTone, severityTone } from '../../ui'
import type { GoalProgress, Overview, SchoolData, Trends } from '../../types'
import { useOpenSession } from '../Home'

export default function OverviewTab({ studentId }: { studentId: number }) {
  const overview = useQuery({
    queryKey: ['overview', studentId],
    queryFn: () => api.get<Overview>(`/api/students/${studentId}/overview`),
  })
  const trends = useQuery({
    queryKey: ['trends', studentId],
    queryFn: () => api.get<Trends>(`/api/students/${studentId}/trends`),
  })
  const school = useQuery({
    queryKey: ['school-data', studentId],
    queryFn: () => api.get<SchoolData>(`/api/students/${studentId}/school-data`),
  })
  const open = useOpenSession()

  if (overview.isLoading) return <Loading />
  const o = overview.data!

  return (
    <div className="stack">
      {o.alerts.length > 0 && (
        <div className="alerts" role="region" aria-label="Alerts">
          {o.alerts.map((a) => (
            <div key={a.text} className={`alert ${a.level}`}>
              <AlertTriangle size={16} /> {a.text}
            </div>
          ))}
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Start of the {o.school_year} school year</h2>
          <span className="xs faint">First measure recorded this year</span>
        </div>
        <BaselineStrip o={o} />
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Progress toward goals</h2>
            {o.plan && (
              <Link className="small" to={`/students/${studentId}/plan`}>
                Edit plan
              </Link>
            )}
          </div>
          {!o.plan ? (
            <Empty
              title="No active treatment plan"
              action={
                <Link className="btn primary" to={`/students/${studentId}/plan`}>
                  Create a plan
                </Link>
              }
            >
              Goals and progress appear here once a plan is in place.
            </Empty>
          ) : o.goals.length === 0 ? (
            <Empty title="This plan has no goals yet" />
          ) : (
            <div className="table-wrap">
              <table className="measures">
                <thead>
                  <tr>
                    <th>Goal</th>
                    <th>Start</th>
                    <th>Now</th>
                    <th style={{ minWidth: 240 }}>
                      Path to goal <span className="sr-only">(left is worse, right is better)</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {o.goals.map((g) => (
                    <GoalRow key={g.id} g={g} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {o.plan && o.goals.length > 0 && (
            <p className="xs faint" style={{ padding: '0 20px 16px' }}>
              Hollow marker: start. Solid marker: now. Shaded area: goal range. Left is always further from the goal.
            </p>
          )}
        </section>

        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Coming up</h2>
            </div>
            {o.upcoming_sessions.length === 0 ? (
              <Empty title="No sessions scheduled">
                <Link to={`/students/${studentId}/sessions`}>Schedule a session</Link>
              </Empty>
            ) : (
              <ul className="list">
                {o.upcoming_sessions.map((s) => (
                  <li key={s.id} className="clickable" onClick={() => open(s.id)}>
                    <div className="grow">
                      <div className="strong small">{relativeDay(s.scheduled_start)}</div>
                      <div className="xs muted row" style={{ gap: 5 }}>
                        {SESSION_TYPE_LABEL[s.session_type]}, {s.duration_minutes} min
                        {s.modality === 'telehealth' && (
                          <>
                            <Video size={12} /> Telehealth
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {o.plan && (
            <section className="panel">
              <div className="panel-head">
                <h2>Current plan</h2>
              </div>
              <div className="panel-body">
                <dl className="kv" style={{ gridTemplateColumns: '110px minmax(0,1fr)' }}>
                  <dt>Approach</dt>
                  <dd>{o.plan.approach}</dd>
                  <dt>Frequency</dt>
                  <dd>{o.plan.service_frequency}</dd>
                  <dt>Started</dt>
                  <dd>{fmt.dayYear(o.plan.start_date)}</dd>
                  <dt>Review by</dt>
                  <dd>{fmt.dayYear(o.plan.review_date)}</dd>
                </dl>
              </div>
            </section>
          )}
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Last 12 months</h2>
          <span className="xs faint">School data refreshes from the student information system</span>
        </div>
        {trends.isLoading || !trends.data ? (
          <Loading />
        ) : (
          <div className="chart-grid">
            <div className="chart-cell">
              <h3>Depression (PHQ-9)</h3>
              <div className="sub">Score out of 27. Shading marks mild, moderate and higher ranges.</div>
              <TrendChart points={trends.data.phq9} domain={[0, 27]} bands={PHQ_BANDS} target={{ value: 10, label: 'Moderate' }} />
            </div>
            <div className="chart-cell">
              <h3>Anxiety (GAD-7)</h3>
              <div className="sub">Score out of 21.</div>
              <TrendChart points={trends.data.gad7} domain={[0, 21]} bands={GAD_BANDS} target={{ value: 10, label: 'Moderate' }} />
            </div>
            <div className="chart-cell">
              <h3>Attendance</h3>
              <div className="sub">Share of school days present, by month.</div>
              <TrendChart
                points={trends.data.attendance_rate}
                domain={[Math.min(60, ...trends.data.attendance_rate.map((p) => Math.floor(p.value / 10) * 10)), 100]}
                target={{ value: 90, label: '90%' }}
                valueFormat={(v) => `${Math.round(v)}%`}
              />
            </div>
            <div className="chart-cell">
              <h3>Behavior incidents</h3>
              <div className="sub">Reported incidents per month.</div>
              <TrendChart
                mode="bars"
                points={trends.data.behavior_incidents}
                domain={[0, Math.max(4, ...trends.data.behavior_incidents.map((p) => p.value))]}
                target={{ value: 2, label: 'Goal: 2 or fewer' }}
                valueFormat={(v) => String(Math.round(v))}
              />
            </div>
            <div className="chart-cell">
              <h3>Academic/SEL check-ins</h3>
              <div className="sub">Monthly teacher rating.</div>
              <RatingStrip points={trends.data.sel_rating} />
            </div>
            <div className="chart-cell">
              <h3>Nurse visits</h3>
              <div className="sub">Visits per month.</div>
              {school.data && <NurseChart data={school.data} />}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function BaselineStrip({ o }: { o: Overview }) {
  const b = o.baseline
  const cells: { k: string; v: React.ReactNode; l: string; tone?: string }[] = [
    {
      k: 'PHQ-9 depression',
      v: b.phq9 ? b.phq9.total : 'None',
      l: b.phq9 ? `${b.phq9.severity}, ${fmt.day(b.phq9.date)}` : 'Not screened',
      tone: b.phq9 ? severityTone(b.phq9.severity) : undefined,
    },
    {
      k: 'GAD-7 anxiety',
      v: b.gad7 ? b.gad7.total : 'None',
      l: b.gad7 ? `${b.gad7.severity}, ${fmt.day(b.gad7.date)}` : 'Not screened',
      tone: b.gad7 ? severityTone(b.gad7.severity) : undefined,
    },
    {
      k: 'Prior year GPA',
      v: b.prior_gpa ? b.prior_gpa.value.toFixed(2) : 'None',
      l: b.prior_gpa ? `${b.prior_gpa.school_year} final` : 'No record',
    },
    {
      k: 'Academic/SEL rating',
      v: b.sel_rating ? (
        <>
          <span className={`dot ${b.sel_rating.value}`} style={{ width: 13, height: 13 }} />
          {b.sel_rating.value[0].toUpperCase() + b.sel_rating.value.slice(1)}
        </>
      ) : (
        'None'
      ),
      l: b.sel_rating ? `Teacher check-in, ${fmt.day(b.sel_rating.date)}` : 'No check-in',
      tone: b.sel_rating ? selTone(b.sel_rating.value) : undefined,
    },
    {
      k: 'Behavior',
      v: b.behavior ? b.behavior.value : 'None',
      l: b.behavior ? `Incidents in ${fmt.month(b.behavior.month)}` : 'No school days yet',
    },
    {
      k: 'Attendance',
      v: b.attendance ? `${Math.round(b.attendance.value)}%` : 'None',
      l: b.attendance ? `Rate in ${fmt.month(b.attendance.month)}` : 'No school days yet',
      tone: b.attendance ? (b.attendance.value >= 90 ? 'good' : b.attendance.value >= 80 ? 'watch' : 'concern') : undefined,
    },
    {
      k: 'Nurse visits',
      v: b.nurse_visits.value,
      l: `${fmt.day(b.nurse_visits.from)} to ${fmt.day(b.nurse_visits.to)}`,
    },
  ]
  return (
    <div className="baseline-strip">
      {cells.map((c) => (
        <div key={c.k} className="baseline-cell">
          <div className="k">{c.k}</div>
          <div className="v num" style={c.tone && c.tone !== 'muted' ? { color: `var(--${c.tone})` } : undefined}>
            {c.v}
          </div>
          <div className="l">{c.l}</div>
        </div>
      ))}
    </div>
  )
}

function nowText(g: GoalProgress): { value: string; label: string; tone: string } {
  if (g.current_value == null) return { value: 'None', label: 'No data yet', tone: '' }
  const tone = g.met ? 'good' : g.trend === 'worsening' ? 'concern' : 'watch'
  switch (g.metric) {
    case 'phq9':
    case 'gad7':
      return { value: String(g.current_value), label: g.as_of ? fmt.day(g.as_of) : '', tone }
    case 'attendance_rate':
      return { value: `${Math.round(g.current_value)}%`, label: 'Last 20 school days', tone }
    case 'behavior_incidents':
      return { value: String(g.current_value), label: 'Last 30 days', tone }
    case 'sel_rating':
      return { value: formatValue('sel_rating', g.current_value), label: g.as_of ? fmt.day(g.as_of) : '', tone }
  }
}

function GoalRow({ g }: { g: GoalProgress }) {
  const now = nowText(g)
  return (
    <tr>
      <td style={{ maxWidth: 260 }}>
        <div className="xs faint">{DOMAIN_LABEL[g.domain]}</div>
        <div className="measure-name">{g.metric_label}</div>
        <div className="measure-goal">Goal: {g.target_text}</div>
      </td>
      <td>
        <div className="value-block">
          <div className="v num" style={{ fontSize: 'var(--t-lg)', color: 'var(--ink-2)' }}>
            {formatValue(g.metric, g.baseline_value)}
          </div>
          <div className="l">{fmt.day(g.baseline_date)}</div>
        </div>
      </td>
      <td>
        <div className="value-block">
          <div className={`v num ${now.tone}`}>{now.value}</div>
          <div className="l">{now.label}</div>
        </div>
      </td>
      <td>
        <GoalTrail goal={g} />
        <GoalStatus g={g} />
      </td>
    </tr>
  )
}

function GoalStatus({ g }: { g: GoalProgress }) {
  if (g.current_value == null)
    return <div className="status-line muted" style={{ marginTop: 6 }}>No data since the plan started</div>
  if (g.met)
    return (
      <div className="status-line good" style={{ marginTop: 6 }}>
        <Check size={14} /> Goal met
      </div>
    )
  const pct = g.progress == null ? null : Math.round(g.progress * 100)
  const trend =
    g.trend === 'improving' ? (
      <>
        {g.direction === 'down' ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />} Improving
      </>
    ) : g.trend === 'worsening' ? (
      <>
        {g.direction === 'down' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />} Moving away from goal
      </>
    ) : (
      <>
        <Minus size={14} /> No change since last measure
      </>
    )
  const tone = g.trend === 'worsening' ? 'concern' : g.trend === 'improving' ? 'watch' : 'muted'
  return (
    <div className={`status-line ${tone}`} style={{ marginTop: 6 }}>
      {trend}
      {pct != null && pct > 0 && <span className="faint">. {pct}% of the way from start</span>}
    </div>
  )
}

function NurseChart({ data }: { data: SchoolData }) {
  const months = data.attendance.map((a) => a.month)
  const counts = new Map(months.map((m) => [m, 0]))
  for (const v of data.nurse_visits) {
    const m = `${v.date.slice(0, 7)}-01`
    counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  const points = Array.from(counts, ([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date))
  return (
    <TrendChart
      mode="bars"
      points={points}
      domain={[0, Math.max(3, ...points.map((p) => p.value))]}
      valueFormat={(v) => String(Math.round(v))}
    />
  )
}
