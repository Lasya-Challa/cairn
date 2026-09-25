import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { api } from '../../api'
import { CONSENT_LABEL, addDays, fmt, isoDay, parseDay } from '../../format'
import { Empty, ErrorNote, Loading, Modal, toast } from '../../ui'
import type { Consent, StudentDetail } from '../../types'
import { invalidateStudent } from './Assessments'

function consentState(c: Consent): { label: string; tone: string } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (c.revoked_on) return { label: `Revoked ${fmt.day(c.revoked_on)}`, tone: 'concern' }
  if (c.expires_on && parseDay(c.expires_on) < today) return { label: 'Expired', tone: '' }
  if (c.expires_on && parseDay(c.expires_on) <= addDays(today, 30)) return { label: 'Expires soon', tone: 'watch' }
  return { label: 'Active', tone: 'good' }
}

export default function ConsentsTab({ studentId, student }: { studentId: number; student: StudentDetail }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [revoking, setRevoking] = useState<Consent | null>(null)
  const consents = useQuery({
    queryKey: ['consents', studentId],
    queryFn: () => api.get<Consent[]>(`/api/students/${studentId}/consents`),
  })
  const revoke = useMutation({
    mutationFn: (id: number) => api.post<Consent>(`/api/consents/${id}/revoke`),
    onSuccess: () => {
      invalidateStudent(qc, studentId)
      toast('Consent revoked')
      setRevoking(null)
    },
  })

  const activeTypes = new Set(
    (consents.data ?? []).filter((c) => ['Active', 'Expires soon'].includes(consentState(c).label)).map((c) => c.consent_type),
  )
  const missing = (Object.keys(CONSENT_LABEL) as Consent['consent_type'][]).filter(
    (t) => t !== 'release_of_information' && !activeTypes.has(t),
  )

  return (
    <div className="stack">
      {!consents.isLoading && missing.length > 0 && (
        <div className="alert info">
          Not on file: {missing.map((t) => CONSENT_LABEL[t].toLowerCase()).join(', ')}.
          {missing.includes('medicaid_billing') && ' Sessions for this student cannot be billed to Medicaid until it is signed.'}
        </div>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>Guardian consents</h2>
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Record consent
          </button>
        </div>
        {consents.isLoading ? (
          <Loading />
        ) : !consents.data?.length ? (
          <Empty title="No consents on file">Services cannot begin until a guardian consents.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Consent</th>
                  <th>Signed by</th>
                  <th>Signed</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {consents.data.map((c) => {
                  const state = consentState(c)
                  return (
                    <tr key={c.id}>
                      <td className="strong">{CONSENT_LABEL[c.consent_type]}</td>
                      <td className="small">
                        {c.signer_name}
                        <div className="xs faint">
                          {c.signer_relationship}, {c.method.replace('_', '-')}
                        </div>
                      </td>
                      <td className="num small">{fmt.dayYear(c.signed_on)}</td>
                      <td className="num small">{c.expires_on ? fmt.dayYear(c.expires_on) : 'No expiration'}</td>
                      <td>
                        <span className={`chip ${state.tone}`}>{state.label}</span>
                      </td>
                      <td className="right">
                        {!c.revoked_on && state.label !== 'Expired' && (
                          <button className="btn small danger" onClick={() => setRevoking(c)}>
                            Revoke
                          </button>
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

      {adding && <ConsentForm studentId={studentId} student={student} onClose={() => setAdding(false)} />}
      {revoking && (
        <Modal
          title="Revoke consent?"
          onClose={() => setRevoking(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRevoking(null)}>
                Keep consent
              </button>
              <button className="btn danger" disabled={revoke.isPending} onClick={() => revoke.mutate(revoking.id)}>
                Revoke consent
              </button>
            </>
          }
        >
          <p>
            {CONSENT_LABEL[revoking.consent_type]} consent from {revoking.signer_name} ends today. Sessions after today will
            not be billable under it. This is recorded in the access log.
          </p>
          <ErrorNote error={revoke.error} />
        </Modal>
      )}
    </div>
  )
}

function ConsentForm({ studentId, student, onClose }: { studentId: number; student: StudentDetail; onClose: () => void }) {
  const qc = useQueryClient()
  const today = new Date()
  const [type, setType] = useState<Consent['consent_type']>('services')
  const [signer, setSigner] = useState(student.guardian_name)
  const [relationship, setRelationship] = useState(student.guardian_relationship)
  const [method, setMethod] = useState('e_signature')
  const [signed, setSigned] = useState(isoDay(today))
  const [expires, setExpires] = useState(isoDay(addDays(today, 365)))

  const save = useMutation({
    mutationFn: () =>
      api.post(`/api/students/${studentId}/consents`, {
        consent_type: type,
        signer_name: signer,
        signer_relationship: relationship,
        method,
        signed_on: signed,
        expires_on: expires || null,
      }),
    onSuccess: () => {
      invalidateStudent(qc, studentId)
      toast('Consent recorded')
      onClose()
    },
  })

  return (
    <Modal
      title="Record consent"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={save.isPending || !signer.trim()} onClick={() => save.mutate()}>
            Record consent
          </button>
        </>
      }
    >
      <div className="form">
        <label className="field">
          <span>Consent for</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as Consent['consent_type'])}>
            {Object.entries(CONSENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label className="field">
            <span>Signed by</span>
            <input className="input" value={signer} onChange={(e) => setSigner(e.target.value)} />
          </label>
          <label className="field">
            <span>Relationship</span>
            <input className="input" value={relationship} onChange={(e) => setRelationship(e.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>Method</span>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="e_signature">E-signature</option>
              <option value="paper">Paper form</option>
              <option value="verbal">Verbal, documented</option>
            </select>
          </label>
          <label className="field">
            <span>Signed on</span>
            <input className="input" type="date" value={signed} onChange={(e) => setSigned(e.target.value)} />
          </label>
          <label className="field">
            <span>Expires</span>
            <input className="input" type="date" value={expires} min={signed} onChange={(e) => setExpires(e.target.value)} />
          </label>
        </div>
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  )
}
