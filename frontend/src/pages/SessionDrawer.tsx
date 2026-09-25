import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Lock, Video } from 'lucide-react'
import { api } from '../api'
import { useUser } from '../auth'
import { SESSION_TYPE_LABEL, fmt, parseUTC } from '../format'
import { Drawer, ErrorNote, Loading, toast } from '../ui'
import type { Note, Plan, SessionDetail } from '../types'
import { SessionStatus } from './Home'
import { invalidateStudent } from './student/Assessments'

const INTERVENTIONS = [
  'Cognitive restructuring',
  'Behavioral activation',
  'Relaxation training',
  'Graded exposure',
  'Emotion regulation skills',
  'Social skills practice',
  'Problem solving',
  'Motivational interviewing',
  'Psychoeducation',
  'Safety planning',
  'Family engagement',
  'Mood monitoring',
]

type Draft = Pick<Note, 'data' | 'assessment' | 'plan' | 'interventions' | 'goal_ids' | 'risk_level'>

const EMPTY: Draft = { data: '', assessment: '', plan: '', interventions: [], goal_ids: [], risk_level: 'none' }

export default function SessionDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const user = useUser()
  const qc = useQueryClient()
  const session = useQuery({ queryKey: ['session', id], queryFn: () => api.get<SessionDetail>(`/api/sessions/${id}`) })
  const s = session.data
  const plans = useQuery({
    queryKey: ['plans', s?.student_id],
    queryFn: () => api.get<Plan[]>(`/api/students/${s!.student_id}/plans`),
    enabled: !!s,
  })

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [dirty, setDirty] = useState(false)
  const [addendum, setAddendum] = useState('')

  useEffect(() => {
    if (s?.note) {
      const { data, assessment, plan, interventions, goal_ids, risk_level } = s.note
      setDraft({ data, assessment, plan, interventions, goal_ids, risk_level })
    } else setDraft(EMPTY)
    setDirty(false)
  }, [s?.id, s?.note?.updated_at, s?.note])

  const refresh = (updated: SessionDetail) => {
    qc.setQueryData(['session', id], updated)
    invalidateStudent(qc, updated.student_id)
    qc.invalidateQueries({ queryKey: ['sessions'] })
  }

  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch<SessionDetail>(`/api/sessions/${id}`, { status }),
    onSuccess: (u) => {
      refresh(u)
      toast(u.status === 'completed' ? 'Session marked completed' : `Session marked ${u.status.replace('_', ' ')}`)
    },
  })
  const saveNote = useMutation({
    mutationFn: () => api.put<SessionDetail>(`/api/sessions/${id}/note`, draft),
    onSuccess: (u) => {
      refresh(u)
      setDirty(false)
      toast('Draft saved')
    },
  })
  const sign = useMutation({
    mutationFn: async () => {
      if (dirty) await api.put<SessionDetail>(`/api/sessions/${id}/note`, draft)
      return api.post<SessionDetail>(`/api/sessions/${id}/note/sign`)
    },
    onSuccess: (u) => {
      refresh(u)
      setDirty(false)
      toast('Note signed')
    },
  })
  const addAddendum = useMutation({
    mutationFn: () => api.post<SessionDetail>(`/api/sessions/${id}/note/addenda`, { text: addendum }),
    onSuccess: (u) => {
      refresh(u)
      setAddendum('')
      toast('Addendum added')
    },
  })

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setDirty(true)
  }

  if (session.isLoading || !s) {
    return (
      <Drawer title="Session" onClose={onClose}>
        {session.error ? <ErrorNote error={session.error} /> : <Loading />}
      </Drawer>
    )
  }

  const isAuthor = s.counselor_id === user.id
  const started = parseUTC(s.scheduled_start) <= new Date()
  const signed = !!s.note?.signed_at
  const canWrite = isAuthor && s.status === 'completed' && !signed
  const goals = plans.data?.find((p) => p.status === 'active')?.goals ?? []
  const complete = draft.data.trim() && draft.assessment.trim() && draft.plan.trim()

  let footer: React.ReactNode = null
  if (canWrite) {
    footer = (
      <>
        <div style={{ flex: 1 }}>
          <ErrorNote error={saveNote.error || sign.error} />
          {!complete && !sign.error && <span className="xs faint">Data, assessment and plan are required to sign.</span>}
        </div>
        <button className="btn" disabled={!dirty || saveNote.isPending} onClick={() => saveNote.mutate()}>
          {dirty ? 'Save draft' : 'Draft saved'}
        </button>
        <button className="btn primary" disabled={!complete || sign.isPending} onClick={() => sign.mutate()}>
          Sign note
        </button>
      </>
    )
  } else if (s.status === 'scheduled' && (isAuthor || user.role === 'admin')) {
    footer = (
      <>
        <ErrorNote error={setStatus.error} />
        <button className="btn danger" disabled={setStatus.isPending} onClick={() => setStatus.mutate('cancelled')}>
          Cancel session
        </button>
        {started && (
          <>
            <button className="btn" disabled={setStatus.isPending} onClick={() => setStatus.mutate('no_show')}>
              Student did not attend
            </button>
            <button className="btn primary" disabled={setStatus.isPending} onClick={() => setStatus.mutate('completed')}>
              Mark completed
            </button>
          </>
        )}
      </>
    )
  }

  return (
    <Drawer
      title={
        <Link to={`/students/${s.student_id}`} onClick={onClose} style={{ color: 'var(--ink)' }}>
          {s.student_name}
        </Link>
      }
      subtitle={
        <span className="row wrap" style={{ gap: 8 }}>
          {SESSION_TYPE_LABEL[s.session_type]} session, {fmt.stamp(s.scheduled_start)}, {s.duration_minutes} min
          {s.modality === 'telehealth' && (
            <span className="row" style={{ gap: 4 }}>
              <Video size={13} /> Telehealth
            </span>
          )}
          <SessionStatus s={s} />
        </span>
      }
      onClose={onClose}
      footer={footer}
    >
      {s.status === 'scheduled' && (
        <p className="muted">
          {started
            ? 'This session has started. Record whether it happened, then write the note.'
            : `Scheduled with ${s.counselor_name}${s.location ? ` in ${s.location}` : ''}.`}
        </p>
      )}
      {(s.status === 'cancelled' || s.status === 'no_show') && (
        <p className="muted">
          {s.status === 'no_show' ? 'The student did not attend. ' : 'This session was cancelled. '}
          No note is required, and the session is not billable.
        </p>
      )}

      {s.status === 'completed' && !isAuthor && !s.note && <p className="muted">{s.counselor_name} has not started the note yet.</p>}

      {s.status === 'completed' && signed && s.note && (
        <>
          <div className="signed-banner">
            <Lock size={15} /> Signed by {s.counselor_name} on {fmt.stamp(s.note.signed_at!)}. The note is locked.
          </div>
          <ReadNote note={s.note} goals={goals} />
          <div className="divider" />
          <h4 className="small strong" style={{ marginBottom: 8 }}>
            Addenda
          </h4>
          {s.note.addenda.length === 0 && <p className="small faint">None.</p>}
          {s.note.addenda.map((a) => (
            <div key={a.id} className="note-section">
              <div className="xs faint">{fmt.stamp(a.created_at)}</div>
              <div className="read small">{a.text}</div>
            </div>
          ))}
          {isAuthor && (
            <div className="form" style={{ marginTop: 10 }}>
              <label className="field">
                <span>Add an addendum</span>
                <textarea className="textarea" value={addendum} onChange={(e) => setAddendum(e.target.value)} style={{ minHeight: 70 }} />
              </label>
              <div>
                <button className="btn" disabled={addendum.trim().length < 3 || addAddendum.isPending} onClick={() => addAddendum.mutate()}>
                  Add addendum
                </button>
              </div>
              <ErrorNote error={addAddendum.error} />
            </div>
          )}
        </>
      )}

      {s.status === 'completed' && !signed && !isAuthor && s.note && (
        <>
          <div className="alert medium" style={{ marginBottom: 16 }}>
            Draft note, not yet signed by {s.counselor_name}.
          </div>
          <ReadNote note={s.note} goals={goals} />
        </>
      )}

      {canWrite && (
        <div className="form">
          <NoteField
            label="Data"
            hint="What the student reported and what you observed."
            value={draft.data}
            onChange={(v) => update({ data: v })}
          />
          <NoteField
            label="Assessment"
            hint="Your clinical interpretation and progress toward goals."
            value={draft.assessment}
            onChange={(v) => update({ assessment: v })}
          />
          <NoteField label="Plan" hint="Next steps, homework and coordination." value={draft.plan} onChange={(v) => update({ plan: v })} />

          <div className="field">
            <span className="field-label">Interventions used</span>
            <div className="checks">
              {INTERVENTIONS.map((i) => (
                <label key={i} className="check-pill">
                  <input
                    type="checkbox"
                    checked={draft.interventions.includes(i)}
                    onChange={(e) =>
                      update({
                        interventions: e.target.checked ? [...draft.interventions, i] : draft.interventions.filter((x) => x !== i),
                      })
                    }
                  />
                  {i}
                </label>
              ))}
            </div>
          </div>

          {goals.length > 0 && (
            <div className="field">
              <span className="field-label">Goals addressed</span>
              <div className="checks">
                {goals.map((g) => (
                  <label key={g.id} className="check-pill">
                    <input
                      type="checkbox"
                      checked={draft.goal_ids.includes(g.id)}
                      onChange={(e) =>
                        update({ goal_ids: e.target.checked ? [...draft.goal_ids, g.id] : draft.goal_ids.filter((x) => x !== g.id) })
                      }
                    />
                    {g.metric_label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <span className="field-label">Risk observed in this session</span>
            <div className="segmented" role="group" aria-label="Risk level">
              {(['none', 'low', 'elevated'] as const).map((r) => (
                <button key={r} type="button" aria-pressed={draft.risk_level === r} onClick={() => update({ risk_level: r })}>
                  {r === 'none' ? 'None' : r === 'low' ? 'Low' : 'Elevated'}
                </button>
              ))}
            </div>
            {draft.risk_level === 'elevated' && (
              <div className="alert high" style={{ marginTop: 8 }}>
                <AlertTriangle size={16} /> Document the risk assessment and safety plan in the note, and notify your
                supervisor today.
              </div>
            )}
          </div>
        </div>
      )}

      {!isAuthor && s.status === 'completed' && !signed && user.role === 'admin' && (
        <p className="xs faint" style={{ marginTop: 16 }}>
          <CheckCircle2 size={12} /> Only the counselor who held the session can write or sign its note.
        </p>
      )}
    </Drawer>
  )
}

function NoteField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>
        {label} <span className="hint">{hint}</span>
      </span>
      <textarea className="textarea" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function ReadNote({ note, goals }: { note: Note; goals: { id: number; metric_label: string }[] }) {
  const addressed = goals.filter((g) => note.goal_ids.includes(g.id))
  return (
    <>
      {(
        [
          ['Data', note.data],
          ['Assessment', note.assessment],
          ['Plan', note.plan],
        ] as const
      ).map(([label, text]) => (
        <div key={label} className="note-section">
          <h4>{label}</h4>
          <div className="read">{text || <span className="faint">Empty</span>}</div>
        </div>
      ))}
      <div className="row wrap" style={{ gap: 6 }}>
        {note.interventions.map((i) => (
          <span key={i} className="chip harbor">
            {i}
          </span>
        ))}
        {addressed.map((g) => (
          <span key={g.id} className="chip outline">
            Goal: {g.metric_label}
          </span>
        ))}
        {note.risk_level !== 'none' && (
          <span className={`chip ${note.risk_level === 'elevated' ? 'concern' : 'watch'}`}>Risk: {note.risk_level}</span>
        )}
      </div>
    </>
  )
}
