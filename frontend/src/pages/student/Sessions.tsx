import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Video } from 'lucide-react'
import { api } from '../../api'
import { SESSION_TYPE_LABEL, fmt, isoDay } from '../../format'
import { Empty, ErrorNote, Loading, Modal, toast } from '../../ui'
import type { SessionItem } from '../../types'
import { SessionStatus, useOpenSession } from '../Home'
import { invalidateStudent } from './Assessments'

export function ScheduleSessionModal({
  studentId,
  hasCase,
  onClose,
  studentPicker,
}: {
  studentId?: number
  hasCase: boolean
  onClose: () => void
  studentPicker?: React.ReactNode
}) {
  const qc = useQueryClient()
  const [date, setDate] = useState(isoDay(new Date()))
  const [time, setTime] = useState('10:00')
  const [duration, setDuration] = useState(45)
  const [type, setType] = useState(hasCase ? 'individual' : 'intake')
  const [modality, setModality] = useState('in_person')
  const [location, setLocation] = useState('Counseling office')

  const save = useMutation({
    mutationFn: () =>
      api.post<SessionItem>('/api/sessions', {
        student_id: studentId,
        session_type: type,
        modality,
        scheduled_start: new Date(`${date}T${time}`).toISOString(),
        duration_minutes: duration,
        location: modality === 'telehealth' ? 'Video visit' : location,
      }),
    onSuccess: (s) => {
      invalidateStudent(qc, s.student_id)
      qc.invalidateQueries({ queryKey: ['sessions'] })
      toast(`Session scheduled for ${fmt.stamp(s.scheduled_start)}`)
      onClose()
    },
  })

  return (
    <Modal
      title="Schedule a session"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!studentId || save.isPending} onClick={() => save.mutate()}>
            Schedule session
          </button>
        </>
      }
    >
      <div className="form">
        {studentPicker}
        <div className="form-row">
          <label className="field">
            <span>Date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Start time</span>
            <input className="input" type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>Type</span>
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(SESSION_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k} disabled={!hasCase && k !== 'intake'}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Length</span>
            <select className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[20, 30, 45, 60, 75, 90].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          <span className="field-label">Where</span>
          <div className="segmented" role="group" aria-label="Modality">
            <button type="button" aria-pressed={modality === 'in_person'} onClick={() => setModality('in_person')}>
              In person
            </button>
            <button type="button" aria-pressed={modality === 'telehealth'} onClick={() => setModality('telehealth')}>
              Telehealth
            </button>
          </div>
        </div>
        {modality === 'in_person' ? (
          <label className="field">
            <span>Location</span>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
        ) : (
          <p className="xs muted">Telehealth sessions need an active telehealth consent to be billed.</p>
        )}
        {!hasCase && <p className="xs muted">Only an intake can be scheduled until a case is open.</p>}
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  )
}

export default function SessionsTab({ studentId, hasCase }: { studentId: number; hasCase: boolean }) {
  const [scheduling, setScheduling] = useState(false)
  const open = useOpenSession()
  const sessions = useQuery({
    queryKey: ['student-sessions', studentId],
    queryFn: () => api.get<SessionItem[]>(`/api/students/${studentId}/sessions`),
  })

  const upcoming = (sessions.data ?? []).filter((s) => s.status === 'scheduled').reverse()
  const past = (sessions.data ?? []).filter((s) => s.status !== 'scheduled')
  const held = past.filter((s) => s.status === 'completed').length
  const missed = past.filter((s) => s.status === 'no_show').length

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Upcoming</h2>
          <button className="btn primary" onClick={() => setScheduling(true)}>
            <Plus size={16} /> Schedule a session
          </button>
        </div>
        {sessions.isLoading ? (
          <Loading />
        ) : upcoming.length === 0 ? (
          <Empty title="Nothing scheduled" />
        ) : (
          <SessionTable rows={upcoming} onOpen={open} />
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>History</h2>
          <span className="small muted">
            {held} held, {missed} missed
          </span>
        </div>
        {past.length === 0 ? <Empty title="No sessions yet" /> : <SessionTable rows={past} onOpen={open} />}
      </section>

      {scheduling && <ScheduleSessionModal studentId={studentId} hasCase={hasCase} onClose={() => setScheduling(false)} />}
    </div>
  )
}

function SessionTable({ rows, onOpen }: { rows: SessionItem[]; onOpen: (id: number) => void }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Type</th>
            <th>Length</th>
            <th>Where</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="clickable" onClick={() => onOpen(s.id)}>
              <td className="num">{fmt.stamp(s.scheduled_start)}</td>
              <td>{SESSION_TYPE_LABEL[s.session_type]}</td>
              <td className="num">{s.duration_minutes} min</td>
              <td className="small">
                {s.modality === 'telehealth' ? (
                  <span className="row" style={{ gap: 5 }}>
                    <Video size={14} /> Telehealth
                  </span>
                ) : (
                  s.location ?? 'In person'
                )}
              </td>
              <td>
                <SessionStatus s={s} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
