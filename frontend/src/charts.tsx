import { useEffect, useId, useRef, useState } from 'react'
import { fmt, parseDay } from './format'
import type { GoalProgress, Metric, SeriesPoint } from './types'

/* ---------- goal trail ---------- */

const SCALE: Record<Metric, (g: GoalProgress) => [number, number]> = {
  phq9: () => [0, 27],
  gad7: () => [0, 21],
  sel_rating: () => [1, 3],
  attendance_rate: (g) => [Math.max(0, Math.min(70, g.baseline_value, g.current_value ?? 100) - 5), 100],
  behavior_incidents: (g) => [0, Math.max(6, g.baseline_value, g.current_value ?? 0, g.target_value) + 1],
}

function formatValue(metric: Metric, v: number) {
  if (metric === 'attendance_rate') return `${Math.round(v)}%`
  if (metric === 'sel_rating') return ['', 'Red', 'Yellow', 'Green'][Math.round(v)] ?? String(v)
  return String(Math.round(v * 10) / 10)
}

/** Left is always worse, right is always better, so every goal reads the same way. */
export function GoalTrail({ goal }: { goal: GoalProgress }) {
  const [lo, hi] = SCALE[goal.metric](goal)
  const better = goal.direction === 'up'
  const pos = (v: number) => {
    const clamped = Math.min(hi, Math.max(lo, v))
    const f = (clamped - lo) / (hi - lo)
    return (better ? f : 1 - f) * 100
  }
  const targetPos = pos(goal.target_value)
  const basePos = pos(goal.baseline_value)
  const nowPos = goal.current_value == null ? null : pos(goal.current_value)
  const forward = nowPos != null && nowPos >= basePos
  const worst = better ? lo : hi
  const best = better ? hi : lo

  return (
    <div
      className="trail"
      role="img"
      aria-label={`Baseline ${formatValue(goal.metric, goal.baseline_value)}, now ${
        goal.current_value == null ? 'no data' : formatValue(goal.metric, goal.current_value)
      }, goal ${goal.target_text}`}
    >
      <div className="trail-line" />
      <div
        className="trail-zone"
        style={{ left: `min(${targetPos}%, calc(100% - 14px))`, right: 0 }}
        title={`Goal: ${goal.target_text}`}
      />
      {nowPos != null && (
        <div
          className={`trail-path ${forward ? 'forward' : 'back'}`}
          style={{ left: `${Math.min(basePos, nowPos)}%`, width: `${Math.abs(nowPos - basePos)}%` }}
        />
      )}
      <div className="trail-base" style={{ left: `${basePos}%` }} title={`Baseline ${formatValue(goal.metric, goal.baseline_value)}`} />
      {nowPos != null && (
        <div
          className={`trail-now ${goal.met ? 'met' : forward ? '' : 'back'}`}
          style={{ left: `${nowPos}%` }}
          title={`Now ${formatValue(goal.metric, goal.current_value!)}`}
        />
      )}
      <span className="trail-scale start">{formatValue(goal.metric, worst)}</span>
      {targetPos > 14 && targetPos < 86 && (
        <span className="trail-scale" style={{ left: `${targetPos}%` }}>
          {formatValue(goal.metric, goal.target_value)}
        </span>
      )}
      <span className="trail-scale end">{formatValue(goal.metric, best)}</span>
    </div>
  )
}

export { formatValue }

/* ---------- trend chart ---------- */

interface Band {
  from: number
  to: number
  tone: 'good' | 'watch' | 'concern'
  label?: string
}

const BAND_FILL = { good: '#e1f0e6', watch: '#faefd9', concern: '#f8e3e1' }

export function TrendChart({
  points,
  domain,
  bands,
  target,
  mode = 'line',
  height = 150,
  valueFormat = (v: number) => String(Math.round(v * 10) / 10),
  months,
}: {
  points: SeriesPoint[]
  domain: [number, number]
  bands?: Band[]
  target?: { value: number; label: string }
  mode?: 'line' | 'bars'
  height?: number
  valueFormat?: (v: number) => string
  /** Month starts to show on the x axis (for bar mode or to fix the range). */
  months?: string[]
}) {
  const clipId = useId()
  const [wrapRef, width] = useWidth()
  const pad = { l: 34, r: 16, t: 14, b: 24 }
  const w = width - pad.l - pad.r
  const h = height - pad.t - pad.b
  const [d0, d1] = domain
  const y = (v: number) => pad.t + h - ((Math.min(d1, Math.max(d0, v)) - d0) / (d1 - d0)) * h

  const times = (months ?? points.map((p) => p.date)).map((d) => parseDay(d).getTime())
  const tMin = Math.min(...times, ...points.map((p) => parseDay(p.date).getTime()))
  const tMax = Math.max(...times, ...points.map((p) => parseDay(p.date).getTime()))
  const span = Math.max(1, tMax - tMin)
  const x = (d: string) => pad.l + ((parseDay(d).getTime() - tMin) / span) * w

  if (!points.length) {
    return (
      <div ref={wrapRef} className="faint small" style={{ padding: '24px 0' }}>
        No data in the last 12 months.
      </div>
    )
  }

  const ticks = niceTicks(d0, d1)
  const monthLabels = (months ?? uniqueMonths(points.map((p) => p.date))).filter(
    (_, i, arr) => arr.length <= 7 || i % Math.ceil(arr.length / 6) === 0,
  )
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  const barW = Math.max(6, Math.min(22, (w / Math.max(points.length, 1)) * 0.55))

  if (!width) return <div ref={wrapRef} style={{ height }} />

  return (
    <div ref={wrapRef}>
    <svg className="chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
      <defs>
        <clipPath id={clipId}>
          <rect x={pad.l} y={pad.t} width={w} height={h} />
        </clipPath>
      </defs>
      {bands?.map((b) => (
        <rect
          key={`${b.from}-${b.to}`}
          x={pad.l}
          width={w}
          y={y(b.to)}
          height={Math.max(0, y(b.from) - y(b.to))}
          fill={BAND_FILL[b.tone]}
          clipPath={`url(#${clipId})`}
        />
      ))}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} stroke="#dce4e2" strokeDasharray={t === d0 ? '' : '2 3'} />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end">
            {valueFormat(t)}
          </text>
        </g>
      ))}
      {target && (
        <g>
          <line x1={pad.l} x2={pad.l + w} y1={y(target.value)} y2={y(target.value)} stroke="#2e7650" strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={pad.l + 6} y={y(target.value) - 5} textAnchor="start" style={{ fill: '#2e7650', fontWeight: 600 }}>
            {target.label}
          </text>
        </g>
      )}
      {monthLabels.map((m) => (
        <text key={m} x={x(m)} y={height - 6} textAnchor="middle">
          {fmt.month(m)}
        </text>
      ))}
      {mode === 'line' ? (
        <>
          <path d={path} fill="none" stroke="#2b5d6e" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p) => (
            <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={3.2} fill="#fff" stroke="#2b5d6e" strokeWidth={1.8}>
              <title>
                {fmt.dayYear(p.date)}: {valueFormat(p.value)}
                {p.label ? ` (${p.label})` : ''}
              </title>
            </circle>
          ))}
          <circle cx={x(last.date)} cy={y(last.value)} r={5} fill="#1e4553" />
          <text x={x(last.date)} y={y(last.value) - 10} textAnchor="middle" style={{ fill: '#17262e', fontWeight: 700, fontSize: 12 }}>
            {valueFormat(last.value)}
          </text>
        </>
      ) : (
        points.map((p) => (
          <rect
            key={p.date}
            x={x(p.date) - barW / 2}
            width={barW}
            y={y(p.value)}
            height={Math.max(0, y(d0) - y(p.value))}
            rx={2}
            fill={target && p.value > target.value ? '#c9837f' : '#6f98a6'}
          >
            <title>
              {fmt.monthYear(p.date)}: {valueFormat(p.value)}
            </title>
          </rect>
        ))
      )}
    </svg>
    </div>
  )
}

/** Track the rendered width of a container so SVG text stays at its real size. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.floor(el.getBoundingClientRect().width))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo
  const step = [1, 2, 5, 10, 20, 25, 50].find((s) => span / s <= 4) ?? Math.ceil(span / 4)
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v)
  return out
}

function uniqueMonths(dates: string[]) {
  return Array.from(new Set(dates.map((d) => `${d.slice(0, 7)}-01`)))
}

/** Monthly teacher check-ins as a row of colored stones. */
export function RatingStrip({ points }: { points: SeriesPoint[] }) {
  if (!points.length) return <div className="faint small" style={{ padding: '24px 0' }}>No check-ins in the last 12 months.</div>
  const color = (v: number) => (v >= 3 ? '#2e7650' : v >= 2 ? '#d9a321' : '#ae3632')
  const label = (v: number) => (v >= 3 ? 'Green' : v >= 2 ? 'Yellow' : 'Red')
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap', padding: '8px 0 2px' }}>
      {points.map((p) => (
        <div key={p.date} style={{ textAlign: 'center', minWidth: 34 }} title={`${fmt.dayYear(p.date)}: ${label(p.value)}`}>
          <div
            style={{
              width: 26,
              height: 26,
              margin: '0 auto',
              borderRadius: '50%',
              background: color(p.value),
              boxShadow: 'inset 0 -3px 0 rgba(0,0,0,0.12)',
            }}
          />
          <div className="xs faint" style={{ marginTop: 4 }}>
            {fmt.month(p.date)}
          </div>
        </div>
      ))}
    </div>
  )
}

export const PHQ_BANDS: Band[] = [
  { from: 0, to: 9.5, tone: 'good' },
  { from: 9.5, to: 14.5, tone: 'watch' },
  { from: 14.5, to: 27, tone: 'concern' },
]
export const GAD_BANDS: Band[] = [
  { from: 0, to: 9.5, tone: 'good' },
  { from: 9.5, to: 14.5, tone: 'watch' },
  { from: 14.5, to: 21, tone: 'concern' },
]
