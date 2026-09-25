import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { api } from '../api'
import { useUser } from '../auth'
import { fmt, titleCase } from '../format'
import { Drawer, Empty, ErrorNote, Flags, Loading, Modal, toast } from '../ui'
import type { Counselor, Referral } from '../types'

type Status = 'new' | 'accepted' | 'declined'

const CONCERNS = [
  'Low mood',
  'Withdrawal',
  'Anxiety',
  'Test anxiety',
  'Somatic complaints',
  'Peer conflict',
  'Disruption',
  'Emotional regulation',
  'Chronic absence',
  'Declining grades',
  'Grief or loss',
  'Family stress',
]

export default function Referrals() {
  const user = useUser()
  const [status, setStatus] = useState<Status>('new')
  const [creating, setCreating] = useState(false)
  const [accepting, setAccepting] = useState<Referral | null>(null)
  const [declining, setDeclining] = useState<Referral | null>(null)
  const list = useQuery({
    queryKey: ['referrals', status],
    queryFn: () => api.get<Referral[]>(`/api/referrals?status=${status}`),
  })
  const isAdmin = user.role === 'admin'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Referrals</h1>
          <p>
            {isAdmin
              ? 'Review new referrals and assign each student to a counselor. Urgent referrals are listed first.'
              : 'Referrals routed to you and referrals for students on your caseload.'}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New referral
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Status">
          {(['new', 'accepted', 'declined'] as Status[]).map((s) => (
            <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === 'new' ? 'Waiting' : titleCase(s)}
            </button>
          ))}
        </div>
      </div>

      <section className="panel">
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.length ? (
          <Empty title={status === 'new' ? 'No referrals waiting' : `No ${status} referrals`}>
            {status === 'new' && 'New referrals from teachers, families and screenings appear here.'}
          </Empty>
        ) : (
          list.data.map((r) => (
            <article key={r.id} className={`ref-card ${r.urgency}`}>
              <span className="bar" aria-hidden />
              <div>
                <div className="row wrap" style={{ gap: 10 }}>
                  <span className={`chip ${r.urgency === 'urgent' ? 'concern' : r.urgency === 'priority' ? 'watch' : 'outline'}`}>
                    {titleCase(r.urgency)}
                  </span>
                  <span className="strong" style={{ fontSize: 'var(--t-lg)' }}>
                    {r.student.current_counselor || r.status === 'accepted' ? (
                      <Link to={`/students/${r.student.id}`} style={{ color: 'var(--ink)' }}>
                        {r.student.name}
                      </Link>
                    ) : (
                      r.student.name
                    )}
                  </span>
                  <Flags iep={r.student.iep} ell={r.student.ell} has504={r.student.has_504} />
                </div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  Grade {r.student.grade}, {r.student.school}. Referred by {r.referred_by} ({r.source}) on{' '}
                  {fmt.stampDay(r.created_at)}
                </div>
                <p className="reason">{r.reason}</p>
                {r.concerns.length > 0 && (
                  <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                    {r.concerns.map((c) => (
                      <span key={c} className="chip">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                {r.status !== 'new' && (
                  <div className="small" style={{ marginTop: 10 }}>
                    {r.status === 'accepted' ? (
                      <span className="chip good">Assigned to {r.assigned_counselor}</span>
                    ) : (
                      <span className="chip">Declined</span>
                    )}
                    {r.decision_note && <span className="muted"> {r.decision_note}</span>}
                  </div>
                )}
              </div>
              {isAdmin && r.status === 'new' && (
                <div className="ref-actions">
                  <button className="btn primary" onClick={() => setAccepting(r)}>
                    Accept and assign
                  </button>
                  <button className="btn" onClick={() => setDeclining(r)}>
                    Decline
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </section>

      {creating && <NewReferral onClose={() => setCreating(false)} />}
      {accepting && <AcceptReferral referral={accepting} onClose={() => setAccepting(null)} />}
      {declining && <DeclineReferral referral={declining} onClose={() => setDeclining(null)} />}
    </>
  )
}

function useDecide(referral: Referral, onClose: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { action: 'accept' | 'decline'; counselor_id?: number; note?: string }) =>
      api.post<Referral>(`/api/referrals/${referral.id}/decision`, body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['referrals'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['counselors'] })
      qc.invalidateQueries({ queryKey: ['admin-summary'] })
      toast(r.status === 'accepted' ? `${r.student.name} assigned to ${r.assigned_counselor}` : 'Referral declined')
      onClose()
    },
  })
}

function AcceptReferral({ referral, onClose }: { referral: Referral; onClose: () => void }) {
  const counselors = useQuery({ queryKey: ['counselors'], queryFn: () => api.get<Counselor[]>('/api/counselors') })
  const [counselorId, setCounselorId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const decide = useDecide(referral, onClose)
  return (
    <Modal
      title={`Assign ${referral.student.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!counselorId || decide.isPending}
            onClick={() => decide.mutate({ action: 'accept', counselor_id: counselorId!, note: note.trim() || undefined })}
          >
            Accept and assign
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginBottom: 14 }}>
        Accepting opens a case and adds the student to the counselor's caseload.
      </p>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label" style={{ marginBottom: 8 }}>
          Counselor
        </legend>
        {counselors.isLoading ? (
          <Loading />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {counselors.data?.map((c) => (
              <label key={c.id} className="check-pill" style={{ borderRadius: 8, justifyContent: 'space-between', display: 'flex' }}>
                <span className="row">
                  <input type="radio" name="counselor" checked={counselorId === c.id} onChange={() => setCounselorId(c.id)} />
                  {c.full_name}, {c.credentials}
                </span>
                <span className="xs">{c.caseload} students</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <label className="field" style={{ marginTop: 16 }}>
        <span>
          Note <span className="hint">optional</span>
        </span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ErrorNote error={decide.error} />
    </Modal>
  )
}

function DeclineReferral({ referral, onClose }: { referral: Referral; onClose: () => void }) {
  const [note, setNote] = useState('')
  const decide = useDecide(referral, onClose)
  return (
    <Modal
      title="Decline referral"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger" disabled={!note.trim() || decide.isPending} onClick={() => decide.mutate({ action: 'decline', note })}>
            Decline referral
          </button>
        </>
      }
    >
      <label className="field">
        <span>Reason</span>
        <textarea
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="For example: needs are met through existing classroom supports."
        />
      </label>
      <p className="xs faint" style={{ marginTop: 8 }}>
        The referring staff member should be told how the student's needs will be met instead.
      </p>
      <ErrorNote error={decide.error} />
    </Modal>
  )
}

function NewReferral({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const user = useUser()
  const [q, setQ] = useState('')
  const [student, setStudent] = useState<{ id: number; name: string; grade: number; school: string } | null>(null)
  const [source, setSource] = useState('teacher')
  const [referredBy, setReferredBy] = useState(user.full_name)
  const [urgency, setUrgency] = useState('routine')
  const [concerns, setConcerns] = useState<string[]>([])
  const [reason, setReason] = useState('')

  const lookup = useQuery({
    queryKey: ['lookup', q],
    queryFn: () =>
      api.get<{ id: number; name: string; grade: number; school: string; district_student_id: string }[]>(
        `/api/referrals/student-lookup?q=${encodeURIComponent(q)}`,
      ),
    enabled: q.trim().length >= 2 && !student,
  })

  const save = useMutation({
    mutationFn: () =>
      api.post('/api/referrals', { student_id: student!.id, source, referred_by: referredBy, urgency, concerns, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['referrals'] })
      toast('Referral submitted')
      onClose()
    },
  })

  return (
    <Drawer
      title="New referral"
      subtitle="Refer any student in the district. Student Services reviews every referral."
      onClose={onClose}
      footer={
        <>
          <ErrorNote error={save.error} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!student || reason.trim().length < 10 || save.isPending} onClick={() => save.mutate()}>
            Submit referral
          </button>
        </>
      }
    >
      <div className="form">
        <div className="field">
          <span className="field-label">Student</span>
          {student ? (
            <div className="row between panel" style={{ padding: '10px 14px' }}>
              <span>
                <span className="strong">{student.name}</span>{' '}
                <span className="small muted">
                  Grade {student.grade}, {student.school}
                </span>
              </span>
              <button className="link-btn small" onClick={() => setStudent(null)}>
                Change
              </button>
            </div>
          ) : (
            <>
              <label className="search">
                <Search size={16} />
                <span className="sr-only">Find a student</span>
                <input className="input" placeholder="Name or student ID" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus />
              </label>
              {lookup.data && (
                <ul className="list panel" style={{ marginTop: 6 }}>
                  {lookup.data.length === 0 && <li className="small muted">No students match.</li>}
                  {lookup.data.map((s) => (
                    <li key={s.id} className="clickable" onClick={() => setStudent(s)}>
                      <div className="grow">
                        <div className="strong small">{s.name}</div>
                        <div className="xs muted">
                          Grade {s.grade}, {s.school}, #{s.district_student_id}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="form-row">
          <label className="field">
            <span>Source</span>
            <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="teacher">Teacher</option>
              <option value="parent">Parent or guardian</option>
              <option value="screening">Universal screening</option>
              <option value="self">Student self-referral</option>
              <option value="staff">Other staff</option>
            </select>
          </label>
          <label className="field">
            <span>Referred by</span>
            <input className="input" value={referredBy} onChange={(e) => setReferredBy(e.target.value)} />
          </label>
        </div>
        <div className="field">
          <span className="field-label">Urgency</span>
          <div className="segmented" role="group" aria-label="Urgency">
            {['routine', 'priority', 'urgent'].map((u) => (
              <button key={u} type="button" aria-pressed={urgency === u} onClick={() => setUrgency(u)}>
                {titleCase(u)}
              </button>
            ))}
          </div>
          {urgency === 'urgent' && (
            <p className="xs" style={{ color: 'var(--concern)', marginTop: 4 }}>
              If a student is in immediate danger, follow the crisis protocol now. Do not wait for referral review.
            </p>
          )}
        </div>
        <div className="field">
          <span className="field-label">Concerns</span>
          <div className="checks">
            {CONCERNS.map((c) => (
              <label key={c} className="check-pill">
                <input
                  type="checkbox"
                  checked={concerns.includes(c)}
                  onChange={(e) => setConcerns(e.target.checked ? [...concerns, c] : concerns.filter((x) => x !== c))}
                />
                {c}
              </label>
            ))}
          </div>
        </div>
        <label className="field">
          <span>
            What have you noticed? <span className="hint">specific behaviors, when they started, what has been tried</span>
          </span>
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
    </Drawer>
  )
}
