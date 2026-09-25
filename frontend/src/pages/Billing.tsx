import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { api, downloadFile } from '../api'
import { SESSION_TYPE_LABEL, addDays, fmt, isoDay } from '../format'
import { Empty, ErrorNote, Loading, toast } from '../ui'
import type { BillingExport, BillingLine, BillingResponse, School } from '../types'

type View = 'ready' | 'blocked' | 'exported' | 'not_eligible'

function monthRange(offset: number): [string, string] {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = offset === 0 ? now : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return [isoDay(first), isoDay(last)]
}

export default function Billing() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'exports' ? 'exports' : 'lines'
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Medicaid billing</h1>
          <p>
            Completed sessions become billing lines. A line is ready when its note is signed and consents are active on
            the service date.
          </p>
        </div>
      </div>
      <nav className="tabs" aria-label="Billing">
        <a
          href="/billing"
          className={tab === 'lines' ? 'active' : ''}
          onClick={(e) => {
            e.preventDefault()
            setParams({})
          }}
        >
          Service lines
        </a>
        <a
          href="/billing?tab=exports"
          className={tab === 'exports' ? 'active' : ''}
          onClick={(e) => {
            e.preventDefault()
            setParams({ tab: 'exports' })
          }}
        >
          Export history
        </a>
      </nav>
      {tab === 'lines' ? <Lines /> : <Exports />}
    </>
  )
}

function Lines() {
  const qc = useQueryClient()
  const [range, setRange] = useState<[string, string]>(() => monthRange(0))
  const [preset, setPreset] = useState<'this' | 'last' | 'custom'>('this')
  const [schoolId, setSchoolId] = useState('')
  const [view, setView] = useState<View>('ready')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const schools = useQuery({ queryKey: ['schools'], queryFn: () => api.get<School[]>('/api/schools') })
  const data = useQuery({
    queryKey: ['billing', range, schoolId],
    queryFn: () =>
      api.get<BillingResponse>(`/api/billing/lines?start=${range[0]}&end=${range[1]}${schoolId ? `&school_id=${schoolId}` : ''}`),
  })

  const lines = useMemo(() => (data.data?.lines ?? []).filter((l) => l.state === view), [data.data, view])
  const readyIds = useMemo(() => (data.data?.lines ?? []).filter((l) => l.state === 'ready').map((l) => l.session_id), [data.data])
  const chosen = readyIds.filter((id) => selected.has(id))

  const exportLines = useMutation({
    mutationFn: async () => {
      const exp = await api.post<BillingExport>('/api/billing/exports', {
        period_start: range[0],
        period_end: range[1],
        session_ids: chosen,
      })
      await downloadFile(`/api/billing/exports/${exp.id}/csv`, `medicaid-export-${exp.id}.csv`)
      return exp
    },
    onSuccess: (exp) => {
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ['billing'] })
      qc.invalidateQueries({ queryKey: ['billing-exports'] })
      toast(`Exported ${exp.line_count} lines`)
    },
  })

  function choosePreset(p: 'this' | 'last') {
    setPreset(p)
    setRange(monthRange(p === 'this' ? 0 : -1))
    setSelected(new Set())
  }

  const s = data.data?.summary
  const total = s ? s.ready + s.blocked + s.exported : 0

  return (
    <div className="stack">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div className="segmented" role="group" aria-label="Period">
          <button aria-pressed={preset === 'this'} onClick={() => choosePreset('this')}>
            This month
          </button>
          <button aria-pressed={preset === 'last'} onClick={() => choosePreset('last')}>
            Last month
          </button>
          <button aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>
            Custom
          </button>
        </div>
        {preset === 'custom' && (
          <>
            <input
              className="input"
              style={{ width: 'auto' }}
              type="date"
              value={range[0]}
              aria-label="From"
              onChange={(e) => setRange([e.target.value, range[1]])}
            />
            <span className="muted">to</span>
            <input
              className="input"
              style={{ width: 'auto' }}
              type="date"
              value={range[1]}
              max={isoDay(addDays(new Date(), 0))}
              aria-label="To"
              onChange={(e) => setRange([range[0], e.target.value])}
            />
          </>
        )}
        <select className="select" style={{ width: 'auto' }} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} aria-label="School">
          <option value="">All schools</option>
          {schools.data?.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.name}
            </option>
          ))}
        </select>
        <span className="small muted">
          {fmt.dayYear(range[0])} to {fmt.dayYear(range[1])}
        </span>
      </div>

      {data.isLoading || !s ? (
        <Loading />
      ) : (
        <>
          <section className="panel">
            <div className="stat-row">
              <div className="stat">
                <div className="k">Ready to export</div>
                <div className="v" style={{ color: 'var(--good)' }}>
                  {s.ready}
                </div>
                <div className="d">{total ? `${Math.round((100 * s.ready) / total)}% of billable lines` : 'No billable lines'}</div>
              </div>
              <div className="stat">
                <div className="k">Blocked by documentation</div>
                <div className="v" style={{ color: s.blocked ? 'var(--concern)' : undefined }}>
                  {s.blocked}
                </div>
                <div className="d">Fix these before the filing deadline</div>
              </div>
              <div className="stat">
                <div className="k">Already exported</div>
                <div className="v">{s.exported}</div>
                <div className="d">Locked from editing</div>
              </div>
              <div className="stat">
                <div className="k">Not Medicaid-enrolled</div>
                <div className="v" style={{ color: 'var(--ink-3)' }}>
                  {s.not_eligible}
                </div>
                <div className="d">Services provided, not billable</div>
              </div>
            </div>
          </section>

          {data.data!.issues.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>What is blocking lines</h2>
              </div>
              <ul className="list">
                {data.data!.issues.map((i) => (
                  <li key={i.issue}>
                    <span className="grow small">{i.issue}</span>
                    <span className="strong num">{i.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <div className="segmented" role="group" aria-label="Show lines">
                {(
                  [
                    ['ready', `Ready (${s.ready})`],
                    ['blocked', `Blocked (${s.blocked})`],
                    ['exported', `Exported (${s.exported})`],
                    ['not_eligible', `Not enrolled (${s.not_eligible})`],
                  ] as [View, string][]
                ).map(([k, label]) => (
                  <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>
                    {label}
                  </button>
                ))}
              </div>
              {view === 'ready' && (
                <div className="row">
                  <ErrorNote error={exportLines.error} />
                  <button
                    className="btn primary"
                    disabled={!chosen.length || exportLines.isPending}
                    onClick={() => exportLines.mutate()}
                  >
                    <Download size={16} /> Export {chosen.length || ''} lines as CSV
                  </button>
                </div>
              )}
            </div>
            {lines.length === 0 ? (
              <Empty title="No lines here for this period" />
            ) : (
              <LineTable
                lines={lines}
                selectable={view === 'ready'}
                selected={selected}
                onToggle={(id) => {
                  const next = new Set(selected)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  setSelected(next)
                }}
                onToggleAll={(on) => setSelected(on ? new Set(readyIds) : new Set())}
              />
            )}
          </section>
        </>
      )}
    </div>
  )
}

function LineTable({
  lines,
  selectable,
  selected,
  onToggle,
  onToggleAll,
}: {
  lines: BillingLine[]
  selectable: boolean
  selected: Set<number>
  onToggle: (id: number) => void
  onToggleAll: (on: boolean) => void
}) {
  const allOn = lines.every((l) => selected.has(l.session_id))
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  aria-label="Select all ready lines"
                  checked={allOn}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  style={{ accentColor: 'var(--harbor)' }}
                />
              </th>
            )}
            <th>Date</th>
            <th>Student</th>
            <th>Provider</th>
            <th>Service</th>
            <th>Code</th>
            <th className="right">Min</th>
            <th>{lines[0]?.state === 'blocked' ? 'Missing' : 'Medicaid ID'}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.session_id}>
              {selectable && (
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${l.student_name} ${l.service_date}`}
                    checked={selected.has(l.session_id)}
                    onChange={() => onToggle(l.session_id)}
                    style={{ accentColor: 'var(--harbor)' }}
                  />
                </td>
              )}
              <td className="num small">{fmt.day(l.service_date)}</td>
              <td>
                <div className="strong small">{l.student_name}</div>
                <div className="xs faint">{l.school}</div>
              </td>
              <td className="small">
                {l.provider}
                <div className="xs faint">{l.provider_credentials}</div>
              </td>
              <td className="small">
                {SESSION_TYPE_LABEL[l.session_type]}
                {l.modality === 'telehealth' ? ', telehealth' : ''}
              </td>
              <td className="small num">
                <span className="strong">{l.service_code ?? 'None'}</span>
                {l.modifier && <span className="faint">-{l.modifier}</span>}
                <div className="xs faint">POS {l.place_of_service}</div>
              </td>
              <td className="right num small">{l.duration_minutes}</td>
              <td className="small">
                {l.state === 'blocked' ? (
                  <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--concern)' }}>
                    {l.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="num">{l.medicaid_id ?? <span className="faint">Not enrolled</span>}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Exports() {
  const exports = useQuery({ queryKey: ['billing-exports'], queryFn: () => api.get<BillingExport[]>('/api/billing/exports') })
  if (exports.isLoading) return <Loading />
  return (
    <section className="panel">
      {!exports.data?.length ? (
        <Empty title="No exports yet">Select ready lines on the Service lines tab and export them.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Exported</th>
              <th>By</th>
              <th>Service period</th>
              <th className="right">Lines</th>
              <th className="right">Units</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {exports.data.map((e) => (
              <tr key={e.id}>
                <td className="num small">{fmt.stamp(e.created_at)}</td>
                <td className="small">{e.created_by}</td>
                <td className="small">
                  {fmt.day(e.period_start)} to {fmt.dayYear(e.period_end)}
                </td>
                <td className="right num strong">{e.line_count}</td>
                <td className="right num">{e.total_units}</td>
                <td className="right">
                  <button className="btn small" onClick={() => downloadFile(`/api/billing/exports/${e.id}/csv`, `export-${e.id}.csv`)}>
                    <Download size={14} /> CSV
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
