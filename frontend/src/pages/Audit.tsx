import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { fmt, titleCase } from '../format'
import { Empty, Loading } from '../ui'
import type { AuditEvent } from '../types'

const ACTION_TONE: Record<string, string> = {
  view: '',
  create: 'harbor',
  update: 'harbor',
  sign: 'good',
  export: 'watch',
  revoke: 'concern',
  login: 'outline',
}

export default function Audit() {
  const [action, setAction] = useState('')
  const events = useQuery({ queryKey: ['audit'], queryFn: () => api.get<AuditEvent[]>('/api/admin/audit?limit=300') })
  const rows = (events.data ?? []).filter((e) => !action || e.action === action)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Access log</h1>
          <p>Every view and change to a student record, for HIPAA and FERPA accountability. Most recent first.</p>
        </div>
        <select className="select" style={{ width: 'auto' }} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
          <option value="">All actions</option>
          {['view', 'create', 'update', 'sign', 'export', 'revoke', 'login'].map((a) => (
            <option key={a} value={a}>
              {titleCase(a)}
            </option>
          ))}
        </select>
      </div>
      <section className="panel">
        {events.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="No events" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Record</th>
                  <th>Student</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="num small">{fmt.stamp(e.created_at)}</td>
                    <td className="small">
                      {e.user}
                      <div className="xs faint">{e.role && titleCase(e.role)}</div>
                    </td>
                    <td>
                      <span className={`chip ${ACTION_TONE[e.action] ?? ''}`}>{titleCase(e.action)}</span>
                    </td>
                    <td className="small">{titleCase(e.entity_type)}</td>
                    <td className="small">
                      {e.student_id ? <Link to={`/students/${e.student_id}`}>{e.student_name}</Link> : <span className="faint">None</span>}
                    </td>
                    <td className="small muted">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
