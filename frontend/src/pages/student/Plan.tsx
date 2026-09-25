import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { DOMAIN_LABEL, fmt, isoDay, addDays } from '../../format'
import { Drawer, Empty, ErrorNote, Loading, Modal, toast } from '../../ui'
import type { Comparator, Goal, Metric, Plan, Trends } from '../../types'
import { invalidateStudent } from './Assessments'
import { formatValue } from '../../charts'

const METRIC_PRESETS: Record<
  Metric,
  { label: string; domain: string; comparator: Comparator; target: number; tracking: string; description: string }
> = {
  phq9: {
    label: 'PHQ-9 score',
    domain: 'mental_health',
    comparator: 'lt',
    target: 10,
    tracking: 'monthly',
    description: 'Reduce depressive symptoms to the mild range or below.',
  },
  gad7: {
    label: 'GAD-7 score',
    domain: 'mental_health',
    comparator: 'lt',
    target: 10,
    tracking: 'monthly',
    description: 'Reduce anxiety symptoms to the mild range or below.',
  },
  attendance_rate: {
    label: 'Attendance rate (%)',
    domain: 'attendance',
    comparator: 'gte',
    target: 90,
    tracking: 'daily',
    description: 'Maintain attendance at or above 90 percent.',
  },
  behavior_incidents: {
    label: 'Behavior incidents per month',
    domain: 'behavioral',
    comparator: 'lte',
    target: 2,
    tracking: 'daily',
    description: 'Reduce behavior incidents to two or fewer per month.',
  },
  sel_rating: {
    label: 'Teacher SEL rating (1 red, 2 yellow, 3 green)',
    domain: 'academic_sel',
    comparator: 'gte',
    target: 3,
    tracking: 'monthly',
    description: 'Earn a green rating on the monthly teacher SEL check-in.',
  },
}

const COMPARATOR_LABEL: Record<Comparator, string> = {
  lt: 'Below',
  lte: 'At most',
  gt: 'Above',
  gte: 'At least',
}

interface GoalDraft {
  metric: Metric
  description: string
  comparator: Comparator
  target_value: string
  baseline_value: string
}

function goalPayload(g: GoalDraft, baselineDate: string) {
  const p = METRIC_PRESETS[g.metric]
  return {
    domain: p.domain,
    description: g.description,
    metric: g.metric,
    comparator: g.comparator,
    target_value: Number(g.target_value),
    baseline_value: Number(g.baseline_value),
    baseline_date: baselineDate,
    tracking: p.tracking,
  }
}

function latestValue(trends: Trends | undefined, metric: Metric): string {
  const series = trends?.[metric]
  if (!series?.length) return ''
  return String(series[series.length - 1].value)
}

function newDraft(metric: Metric, trends: Trends | undefined): GoalDraft {
  const p = METRIC_PRESETS[metric]
  return {
    metric,
    description: p.description,
    comparator: p.comparator,
    target_value: String(p.target),
    baseline_value: latestValue(trends, metric),
  }
}

function GoalFields({
  draft,
  onChange,
  trends,
}: {
  draft: GoalDraft
  onChange: (d: GoalDraft) => void
  trends: Trends | undefined
}) {
  return (
    <div className="form">
      <label className="field">
        <span>Measure</span>
        <select
          className="select"
          value={draft.metric}
          onChange={(e) => onChange(newDraft(e.target.value as Metric, trends))}
        >
          {(Object.keys(METRIC_PRESETS) as Metric[]).map((m) => (
            <option key={m} value={m}>
              {METRIC_PRESETS[m].label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Goal statement</span>
        <input className="input" value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} />
      </label>
      <div className="form-row">
        <label className="field">
          <span>Target</span>
          <select
            className="select"
            value={draft.comparator}
            onChange={(e) => onChange({ ...draft, comparator: e.target.value as Comparator })}
          >
            {(Object.keys(COMPARATOR_LABEL) as Comparator[]).map((c) => (
              <option key={c} value={c}>
                {COMPARATOR_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Value</span>
          <input
            className="input num"
            type="number"
            step="any"
            value={draft.target_value}
            onChange={(e) => onChange({ ...draft, target_value: e.target.value })}
          />
        </label>
        <label className="field">
          <span>
            Baseline <span className="hint">prefilled from latest data</span>
          </span>
          <input
            className="input num"
            type="number"
            step="any"
            value={draft.baseline_value}
            onChange={(e) => onChange({ ...draft, baseline_value: e.target.value })}
          />
        </label>
      </div>
    </div>
  )
}

export default function PlanTab({ studentId, hasCase }: { studentId: number; hasCase: boolean }) {
  const qc = useQueryClient()
  const plans = useQuery({ queryKey: ['plans', studentId], queryFn: () => api.get<Plan[]>(`/api/students/${studentId}/plans`) })
  const trends = useQuery({ queryKey: ['trends', studentId], queryFn: () => api.get<Trends>(`/api/students/${studentId}/trends`) })
  const [creating, setCreating] = useState(false)
  const [addingGoal, setAddingGoal] = useState(false)

  const updateGoal = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.patch<Plan>(`/api/goals/${id}`, { status }),
    onSuccess: () => {
      invalidateStudent(qc, studentId)
      toast('Goal updated')
    },
  })

  if (plans.isLoading) return <Loading />
  const active = plans.data?.find((p) => p.status === 'active')
  const past = plans.data?.filter((p) => p.status !== 'active') ?? []

  return (
    <div className="stack">
      {!active ? (
        <section className="panel">
          <Empty
            title="No active treatment plan"
            action={
              hasCase ? (
                <button className="btn primary" onClick={() => setCreating(true)}>
                  Create a treatment plan
                </button>
              ) : undefined
            }
          >
            {hasCase
              ? 'Set the approach, service frequency and measurable goals. Progress is tracked from school and screening data automatically.'
              : 'This student has no open case. A plan can be created after a referral is accepted.'}
          </Empty>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Treatment plan</h2>
              <button className="btn" onClick={() => setCreating(true)}>
                Replace with a new plan
              </button>
            </div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Presenting concerns</dt>
                <dd>{active.presenting_concerns}</dd>
                <dt>Approach</dt>
                <dd>{active.approach}</dd>
                <dt>Service frequency</dt>
                <dd>{active.service_frequency}</dd>
                <dt>Plan period</dt>
                <dd>
                  {fmt.dayYear(active.start_date)} to review on {fmt.dayYear(active.review_date)}
                  {new Date(active.review_date) < new Date() && (
                    <span className="chip watch" style={{ marginLeft: 8 }}>
                      Review overdue
                    </span>
                  )}
                </dd>
              </dl>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Goals</h2>
              <button className="btn" onClick={() => setAddingGoal(true)}>
                <Plus size={16} /> Add a goal
              </button>
            </div>
            {active.goals.length === 0 ? (
              <Empty title="No goals yet" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Goal</th>
                    <th>Measure</th>
                    <th>Target</th>
                    <th>Baseline</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {active.goals.map((g) => (
                    <GoalLine key={g.id} g={g} onStatus={(status) => updateGoal.mutate({ id: g.id, status })} />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {past.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Earlier plans</h2>
          </div>
          <ul className="list">
            {past.map((p) => (
              <li key={p.id}>
                <div className="grow">
                  <div className="strong small">{p.approach}</div>
                  <div className="xs muted">
                    {fmt.dayYear(p.start_date)}. {p.goals.length} goals: {p.goals.map((g) => g.metric_label).join(', ')}
                  </div>
                </div>
                <span className="chip">Completed</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {creating && <NewPlan studentId={studentId} trends={trends.data} onClose={() => setCreating(false)} />}
      {addingGoal && active && (
        <AddGoal planId={active.id} studentId={studentId} trends={trends.data} onClose={() => setAddingGoal(false)} />
      )}
    </div>
  )
}

function GoalLine({ g, onStatus }: { g: Goal; onStatus: (s: string) => void }) {
  return (
    <tr>
      <td style={{ maxWidth: 320 }}>
        <div className="xs faint">{DOMAIN_LABEL[g.domain]}</div>
        <div className="strong">{g.description}</div>
      </td>
      <td className="small">{g.metric_label}</td>
      <td className="small num">
        {COMPARATOR_LABEL[g.comparator]} {formatValue(g.metric, g.target_value)}
      </td>
      <td className="small num">
        {formatValue(g.metric, g.baseline_value)} <span className="faint">on {fmt.day(g.baseline_date)}</span>
      </td>
      <td>
        <select
          className="select"
          style={{ minHeight: 34, width: 'auto' }}
          value={g.status}
          onChange={(e) => onStatus(e.target.value)}
          aria-label={`Status of ${g.description}`}
        >
          <option value="active">Active</option>
          <option value="met">Met</option>
          <option value="discontinued">Discontinued</option>
        </select>
      </td>
    </tr>
  )
}

function AddGoal({ planId, studentId, trends, onClose }: { planId: number; studentId: number; trends?: Trends; onClose: () => void }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<GoalDraft>(() => newDraft('attendance_rate', trends))
  const save = useMutation({
    mutationFn: () => api.post(`/api/plans/${planId}/goals`, goalPayload(draft, isoDay(new Date()))),
    onSuccess: () => {
      invalidateStudent(qc, studentId)
      toast('Goal added')
      onClose()
    },
  })
  return (
    <Modal
      title="Add a goal"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={save.isPending || draft.baseline_value === ''} onClick={() => save.mutate()}>
            Add goal
          </button>
        </>
      }
    >
      <GoalFields draft={draft} onChange={setDraft} trends={trends} />
      <ErrorNote error={save.error} />
    </Modal>
  )
}

function NewPlan({ studentId, trends, onClose }: { studentId: number; trends?: Trends; onClose: () => void }) {
  const qc = useQueryClient()
  const today = new Date()
  const [concerns, setConcerns] = useState('')
  const [approach, setApproach] = useState('Cognitive behavioral therapy')
  const [frequency, setFrequency] = useState('Weekly, 45 minutes')
  const [start, setStart] = useState(isoDay(today))
  const [review, setReview] = useState(isoDay(addDays(today, 90)))
  const [goals, setGoals] = useState<GoalDraft[]>(() => [newDraft('phq9', trends), newDraft('attendance_rate', trends)])

  const save = useMutation({
    mutationFn: () =>
      api.post(`/api/students/${studentId}/plans`, {
        presenting_concerns: concerns,
        approach,
        service_frequency: frequency,
        start_date: start,
        review_date: review,
        goals: goals.map((g) => goalPayload(g, start)),
      }),
    onSuccess: () => {
      invalidateStudent(qc, studentId)
      toast('Treatment plan saved')
      onClose()
    },
  })

  const valid = concerns.trim().length >= 10 && goals.every((g) => g.baseline_value !== '' && g.target_value !== '')

  return (
    <Drawer
      title="New treatment plan"
      subtitle="Saving this plan completes the current one. Goal progress is calculated from screenings and school data."
      onClose={onClose}
      footer={
        <>
          <ErrorNote error={save.error} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            Save plan
          </button>
        </>
      }
    >
      <div className="form">
        <label className="field">
          <span>
            Presenting concerns <span className="hint">at least 10 characters</span>
          </span>
          <textarea className="textarea" value={concerns} onChange={(e) => setConcerns(e.target.value)} data-autofocus />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Approach</span>
            <select className="select" value={approach} onChange={(e) => setApproach(e.target.value)}>
              <option>Cognitive behavioral therapy</option>
              <option>Skills-based counseling</option>
              <option>Motivational interviewing</option>
              <option>Solution-focused brief therapy</option>
              <option>Dialectical behavior therapy skills</option>
            </select>
          </label>
          <label className="field">
            <span>Service frequency</span>
            <input className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>Start date</span>
            <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>Review date</span>
            <input className="input" type="date" value={review} min={start} onChange={(e) => setReview(e.target.value)} />
          </label>
        </div>

        <div className="divider" />
        <div className="row between">
          <h3 style={{ fontSize: 'var(--t-lg)' }}>Goals</h3>
          <button className="btn small" onClick={() => setGoals([...goals, newDraft('sel_rating', trends)])}>
            <Plus size={15} /> Add a goal
          </button>
        </div>
        {goals.map((g, i) => (
          <div key={i} className="panel" style={{ padding: 16 }}>
            <div className="row between" style={{ marginBottom: 10 }}>
              <span className="strong small">Goal {i + 1}</span>
              <button className="btn ghost small" aria-label={`Remove goal ${i + 1}`} onClick={() => setGoals(goals.filter((_, j) => j !== i))}>
                <Trash2 size={15} />
              </button>
            </div>
            <GoalFields draft={g} trends={trends} onChange={(d) => setGoals(goals.map((x, j) => (j === i ? d : x)))} />
          </div>
        ))}
      </div>
    </Drawer>
  )
}
