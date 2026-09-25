import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck, FileSignature, FolderOpen, HeartPulse, Inbox, MessageSquare, Siren, Target } from 'lucide-react'
import { api } from '../../api'
import { fmt } from '../../format'
import { Empty, Loading } from '../../ui'
import type { TimelineEvent } from '../../types'
import { useOpenSession } from '../Home'

const KINDS: { key: TimelineEvent['kind'] | 'all'; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'session', label: 'Sessions' },
  { key: 'assessment', label: 'Assessments' },
  { key: 'incident', label: 'Incidents' },
  { key: 'nurse', label: 'Nurse' },
  { key: 'consent', label: 'Consents' },
]

const ICON = {
  referral: Inbox,
  case: FolderOpen,
  plan: Target,
  assessment: ClipboardCheck,
  session: MessageSquare,
  consent: FileSignature,
  incident: Siren,
  nurse: HeartPulse,
}

export default function TimelineTab({ studentId }: { studentId: number }) {
  const [kind, setKind] = useState<string>('all')
  const open = useOpenSession()
  const events = useQuery({
    queryKey: ['timeline', studentId],
    queryFn: () => api.get<TimelineEvent[]>(`/api/students/${studentId}/timeline`),
  })

  const grouped = useMemo(() => {
    const out: [string, TimelineEvent[]][] = []
    for (const e of events.data ?? []) {
      if (kind !== 'all' && e.kind !== kind) continue
      const month = `${e.date.slice(0, 7)}-01`
      const last = out[out.length - 1]
      if (last && last[0] === month) last[1].push(e)
      else out.push([month, [e]])
    }
    return out
  }, [events.data, kind])

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Support timeline</h2>
        <div className="segmented" role="group" aria-label="Show">
          {KINDS.map((k) => (
            <button key={k.key} aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {events.isLoading ? (
        <Loading />
      ) : grouped.length === 0 ? (
        <Empty title="Nothing to show" />
      ) : (
        grouped.map(([month, items]) => (
          <div key={month}>
            <div className="timeline-month">{fmt.monthYear(month)}</div>
            <ul className="timeline">
              {items.map((e, i) => {
                const Icon = ICON[e.kind]
                const tone =
                  e.flag || (e.kind === 'incident' && e.severity === 'major')
                    ? 'concern'
                    : ['referral', 'case', 'plan'].includes(e.kind)
                      ? 'harbor'
                      : ''
                return (
                  <li key={`${e.kind}-${e.date}-${i}`}>
                    <span className="when">{fmt.day(e.date)}</span>
                    <span className={`icon ${tone}`}>
                      <Icon size={14} />
                    </span>
                    <div className="what">
                      <div className="t">
                        {e.session_id ? (
                          <button className="link-btn" onClick={() => open(e.session_id!)}>
                            {e.title}
                          </button>
                        ) : (
                          e.title
                        )}
                        {e.kind === 'session' && e.status === 'completed' && !e.signed && (
                          <span className="chip concern" style={{ marginLeft: 8 }}>
                            Unsigned
                          </span>
                        )}
                      </div>
                      {e.detail && <div className="d">{e.detail}</div>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}
