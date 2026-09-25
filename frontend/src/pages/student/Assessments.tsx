import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus } from 'lucide-react'
import { api } from '../../api'
import { fmt, isoDay } from '../../format'
import { Drawer, Empty, ErrorNote, Loading, severityTone, toast } from '../../ui'
import type { Assessment, Instrument } from '../../types'

interface InstrumentsResponse {
  options: { value: number; label: string }[]
  instruments: Instrument[]
}

export function useInstruments() {
  return useQuery({
    queryKey: ['instruments'],
    queryFn: () => api.get<InstrumentsResponse>('/api/instruments'),
    staleTime: Infinity,
  })
}

export function invalidateStudent(qc: ReturnType<typeof useQueryClient>, studentId: number) {
  for (const key of ['overview', 'trends', 'assessments', 'timeline', 'plans', 'consents', 'student-sessions', 'student']) {
    qc.invalidateQueries({ queryKey: [key, studentId] })
  }
  qc.invalidateQueries({ queryKey: ['students'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

export default function AssessmentsTab({ studentId }: { studentId: number }) {
  const [adding, setAdding] = useState(false)
  const [viewing, setViewing] = useState<Assessment | null>(null)
  const list = useQuery({
    queryKey: ['assessments', studentId],
    queryFn: () => api.get<Assessment[]>(`/api/students/${studentId}/assessments`),
  })

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Screenings and assessments</h2>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> Record an assessment
        </button>
      </div>
      {list.isLoading ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty title="No assessments yet">
          PHQ-9 and GAD-7 are validated for adolescents. For younger students, track behavior, attendance and teacher
          check-ins instead.
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Measure</th>
                <th className="right">Score</th>
                <th>Severity</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setViewing(a)}>
                  <td className="num">{fmt.dayYear(a.administered_on)}</td>
                  <td>
                    <span className="strong">{a.instrument === 'PHQ9' ? 'PHQ-9' : 'GAD-7'}</span>
                    {a.is_baseline && (
                      <span className="chip outline" style={{ marginLeft: 8 }}>
                        Baseline
                      </span>
                    )}
                  </td>
                  <td className="right num strong">{a.total}</td>
                  <td>
                    <span className={`chip ${severityTone(a.severity)}`}>{a.severity}</span>
                  </td>
                  <td>
                    {a.safety_flag ? (
                      <span className="chip concern">
                        <AlertTriangle size={13} /> Item 9 endorsed
                      </span>
                    ) : (
                      <span className="small muted">{a.notes ?? ''}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AssessmentForm studentId={studentId} onClose={() => setAdding(false)} />}
      {viewing && <AssessmentView a={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}

function AssessmentView({ a, onClose }: { a: Assessment; onClose: () => void }) {
  const instruments = useInstruments()
  const spec = instruments.data?.instruments.find((i) => i.code === a.instrument)
  const options = instruments.data?.options ?? []
  return (
    <Drawer
      title={`${spec?.name ?? a.instrument}, ${fmt.dayYear(a.administered_on)}`}
      subtitle={`Total ${a.total}: ${a.severity}`}
      onClose={onClose}
    >
      {a.safety_flag && (
        <div className="alert high" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} /> Item 9 was endorsed on this screening.
        </div>
      )}
      {spec?.items.map((item, i) => (
        <div key={item} className="item-row">
          <span className="n">{i + 1}</span>
          <div>{item}</div>
          <div style={{ gridColumn: 2 }} className="small strong">
            {options.find((o) => o.value === a.responses[i])?.label} ({a.responses[i]})
          </div>
        </div>
      ))}
    </Drawer>
  )
}

function AssessmentForm({ studentId, onClose }: { studentId: number; onClose: () => void }) {
  const qc = useQueryClient()
  const instruments = useInstruments()
  const [code, setCode] = useState<'PHQ9' | 'GAD7'>('PHQ9')
  const [responses, setResponses] = useState<Record<string, (number | null)[]>>({})
  const [date, setDate] = useState(isoDay(new Date()))
  const [baseline, setBaseline] = useState(false)
  const [notes, setNotes] = useState('')

  const spec = instruments.data?.instruments.find((i) => i.code === code)
  const options = instruments.data?.options ?? []
  const current = responses[code] ?? spec?.items.map(() => null) ?? []
  const answered = current.filter((r) => r !== null).length
  const complete = spec && answered === spec.items.length
  const total = current.reduce<number>((sum, r) => sum + (r ?? 0), 0)
  const band = spec?.bands.find((b) => total >= b.min && total <= b.max)
  const safety = spec?.safety_item != null && (current[spec.safety_item] ?? 0) > 0

  const save = useMutation({
    mutationFn: () =>
      api.post<Assessment>(`/api/students/${studentId}/assessments`, {
        instrument: code,
        responses: current,
        administered_on: date,
        is_baseline: baseline,
        notes: notes.trim() || null,
      }),
    onSuccess: (a) => {
      invalidateStudent(qc, studentId)
      toast(`${a.instrument === 'PHQ9' ? 'PHQ-9' : 'GAD-7'} saved: ${a.total}, ${a.severity.toLowerCase()}`)
      onClose()
    },
  })

  function answer(i: number, v: number) {
    const next = [...current]
    next[i] = v
    setResponses({ ...responses, [code]: next })
  }

  return (
    <Drawer
      title="Record an assessment"
      subtitle={spec?.stem}
      onClose={onClose}
      footer={
        <>
          <div className="grow" style={{ flex: 1 }}>
            {spec && (
              <div className="row">
                <span className="strong num" style={{ fontSize: 'var(--t-xl)' }}>
                  {total}
                </span>
                <span className="faint small">/ {spec.max}</span>
                {complete && band && <span className={`chip ${severityTone(band.label)}`}>{band.label}</span>}
                {!complete && (
                  <span className="xs faint">
                    {answered} of {spec.items.length} answered
                  </span>
                )}
              </div>
            )}
            <ErrorNote error={save.error} />
          </div>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!complete || save.isPending} onClick={() => save.mutate()}>
            Save assessment
          </button>
        </>
      }
    >
      {instruments.isLoading || !spec ? (
        <Loading />
      ) : (
        <>
          <div className="form-row" style={{ marginBottom: 12 }}>
            <div className="field">
              <span className="field-label">Measure</span>
              <div className="segmented" role="group" aria-label="Measure">
                {instruments.data!.instruments.map((i) => (
                  <button key={i.code} type="button" aria-pressed={i.code === code} onClick={() => setCode(i.code)}>
                    {i.name} ({i.measures.toLowerCase()})
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Date given</span>
              <input className="input" type="date" value={date} max={isoDay(new Date())} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <label className="check-pill" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={baseline} onChange={(e) => setBaseline(e.target.checked)} /> Baseline for this school
            year
          </label>

          {spec.items.map((item, i) => (
            <fieldset
              key={`${code}-${i}`}
              className={`item-row ${spec.safety_item === i && (current[i] ?? 0) > 0 ? 'flagged' : ''}`}
              style={{ border: 0, margin: 0, minWidth: 0 }}
            >
              <span className="n">{i + 1}</span>
              <legend style={{ display: 'contents' }}>{item}</legend>
              <div className="options">
                {options.map((o) => {
                  const id = `${code}-${i}-${o.value}`
                  return (
                    <div className="option" key={o.value}>
                      <input
                        type="radio"
                        id={id}
                        name={`${code}-${i}`}
                        checked={current[i] === o.value}
                        onChange={() => answer(i, o.value)}
                      />
                      <label htmlFor={id}>
                        <b>{o.value}</b>
                        {o.label}
                      </label>
                    </div>
                  )
                })}
              </div>
            </fieldset>
          ))}

          {safety && (
            <div className="alert high" style={{ marginTop: 12 }} role="alert">
              <AlertTriangle size={16} />
              <span>
                Item 9 is endorsed. Complete a suicide risk screening with the student today and follow the district risk
                protocol, including guardian notification, before the student leaves.
              </span>
            </div>
          )}

          <label className="field" style={{ marginTop: 16 }}>
            <span>Notes</span>
            <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 70 }} />
          </label>
        </>
      )}
    </Drawer>
  )
}
