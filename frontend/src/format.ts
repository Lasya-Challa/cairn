/** Dates from the API come in two shapes:
 *  - "2026-09-25"            a calendar date, shown as-is (no time zone shift)
 *  - "2026-09-25T14:30:00"   a stored UTC timestamp without an offset
 */

export function parseUTC(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`)
}

export function parseDay(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const dayYearFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short' })
const monthYearFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const shortWeekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

export const fmt = {
  day: (v: string) => dayFmt.format(parseDay(v)),
  dayYear: (v: string) => dayYearFmt.format(parseDay(v)),
  month: (v: string) => monthFmt.format(parseDay(v)),
  monthYear: (v: string) => monthYearFmt.format(parseDay(v)),
  weekday: (d: Date) => weekdayFmt.format(d),
  shortWeekday: (d: Date) => shortWeekdayFmt.format(d),
  time: (v: string) => timeFmt.format(parseUTC(v)),
  stampDay: (v: string) => dayFmt.format(parseUTC(v)),
  stamp: (v: string) => `${dayFmt.format(parseUTC(v))}, ${timeFmt.format(parseUTC(v))}`,
}

export function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export function relativeDay(value: string): string {
  const d = parseUTC(value)
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 86400000)
  if (diff === 0) return `Today, ${fmt.time(value)}`
  if (diff === 1) return `Tomorrow, ${fmt.time(value)}`
  if (diff === -1) return `Yesterday, ${fmt.time(value)}`
  return fmt.stamp(value)
}

export function studentName(s: { first_name: string; last_name: string; preferred_name: string | null }) {
  return `${s.preferred_name ?? s.first_name} ${s.last_name}`
}

export function gradeLabel(grade: number) {
  if (grade === 0) return 'Kindergarten'
  return `Grade ${grade}`
}

export const SESSION_TYPE_LABEL: Record<string, string> = {
  individual: 'Individual',
  group: 'Group',
  family: 'Family',
  crisis: 'Crisis',
  intake: 'Intake',
}

export const CONSENT_LABEL: Record<string, string> = {
  services: 'Counseling services',
  telehealth: 'Telehealth',
  medicaid_billing: 'Medicaid billing',
  release_of_information: 'Release of information',
}

export const DOMAIN_LABEL: Record<string, string> = {
  mental_health: 'Mental health',
  academic_sel: 'Academic/SEL',
  behavioral: 'Behavior',
  attendance: 'Attendance',
}

export function titleCase(s: string) {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
