export type Role = 'counselor' | 'admin' | 'billing'

export interface User {
  id: number
  email: string
  full_name: string
  role: Role
  credentials: string | null
}

export interface School {
  id: number
  name: string
  level: string
}

export interface AssessmentBrief {
  total: number
  severity: string
  date: string
  safety_flag: boolean
}

export interface StudentSummary {
  id: number
  district_student_id: string
  first_name: string
  last_name: string
  preferred_name: string | null
  grade: number
  school: School
  ell: boolean
  iep: boolean
  has_504: boolean
  counselor: User | null
  case_status: string | null
  latest_phq9: AssessmentBrief | null
  latest_gad7: AssessmentBrief | null
  next_session: string | null
  alerts: Alert[]
}

export interface StudentDetail {
  id: number
  district_student_id: string
  first_name: string
  last_name: string
  preferred_name: string | null
  grade: number
  date_of_birth: string
  school: School
  ell: boolean
  iep: boolean
  has_504: boolean
  primary_language: string
  guardian_name: string
  guardian_relationship: string
  guardian_phone: string
  guardian_email: string | null
  medicaid_id: string | null
  counselor: User | null
}

export interface StudentRecord {
  student: StudentDetail
  case: { id: number; status: string; opened_at: string; counselor_id: number } | null
}

export interface Alert {
  kind: 'safety' | 'documentation' | 'consent' | 'plan'
  level: 'high' | 'medium'
  text: string
}

export type Metric = 'phq9' | 'gad7' | 'attendance_rate' | 'behavior_incidents' | 'sel_rating'
export type Comparator = 'lt' | 'lte' | 'gt' | 'gte'

export interface SeriesPoint {
  date: string
  value: number
  label?: string
}

export interface GoalProgress {
  id: number
  domain: string
  description: string
  metric: Metric
  metric_label: string
  direction: 'up' | 'down'
  comparator: Comparator
  target_value: number
  baseline_value: number
  baseline_date: string
  tracking: string
  status: string
  current_value: number | null
  as_of: string | null
  met: boolean
  progress: number | null
  trend: 'improving' | 'worsening' | 'steady' | 'no_data'
  target_text: string
  series: SeriesPoint[]
}

export interface Overview {
  school_year: string
  baseline: {
    phq9: AssessmentBrief | null
    gad7: AssessmentBrief | null
    prior_gpa: { value: number; school_year: string } | null
    sel_rating: { value: 'red' | 'yellow' | 'green'; date: string } | null
    behavior: { value: number; month: string } | null
    attendance: { value: number; month: string } | null
    nurse_visits: { value: number; from: string; to: string }
  }
  latest_gpa: { value: number; term: string } | null
  plan: {
    id: number
    approach: string
    service_frequency: string
    start_date: string
    review_date: string
    presenting_concerns: string
  } | null
  goals: GoalProgress[]
  upcoming_sessions: { id: number; scheduled_start: string; session_type: string; modality: string; duration_minutes: number }[]
  alerts: Alert[]
}

export type Trends = Record<Metric, SeriesPoint[]>

export interface SchoolData {
  attendance: { month: string; present: number; days: number; rate: number }[]
  incidents: { id: number; date: string; category: string; severity: string; description: string; reported_by: string }[]
  nurse_visits: { id: number; date: string; reason: string; outcome: string }[]
  grades: { school_year: string; term: string; gpa: number; date: string }[]
  sel_ratings: { id: number; date: string; rating: 'red' | 'yellow' | 'green'; rater: string; comment: string | null }[]
}

export interface TimelineEvent {
  date: string
  kind: 'referral' | 'case' | 'plan' | 'assessment' | 'session' | 'consent' | 'incident' | 'nurse'
  title: string
  detail: string | null
  status?: string
  flag?: boolean
  session_id?: number
  signed?: boolean
  severity?: string
}

export interface Assessment {
  id: number
  instrument: 'PHQ9' | 'GAD7'
  responses: number[]
  total: number
  severity: string
  safety_flag: boolean
  is_baseline: boolean
  administered_on: string
  notes: string | null
}

export interface Instrument {
  code: 'PHQ9' | 'GAD7'
  name: string
  measures: string
  stem: string
  items: string[]
  max: number
  bands: { min: number; max: number; label: string }[]
  safety_item: number | null
}

export interface Goal {
  id: number
  domain: string
  description: string
  metric: Metric
  metric_label: string
  comparator: Comparator
  target_value: number
  baseline_value: number
  baseline_date: string
  tracking: string
  status: string
}

export interface Plan {
  id: number
  presenting_concerns: string
  approach: string
  service_frequency: string
  start_date: string
  review_date: string
  status: string
  goals: Goal[]
}

export interface Consent {
  id: number
  consent_type: 'services' | 'telehealth' | 'medicaid_billing' | 'release_of_information'
  signer_name: string
  signer_relationship: string
  method: string
  signed_on: string
  expires_on: string | null
  revoked_on: string | null
  notes: string | null
}

export type SessionStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show'

export interface SessionItem {
  id: number
  student_id: number
  student_name: string
  grade: number
  counselor_id: number
  counselor_name: string
  session_type: 'individual' | 'group' | 'family' | 'crisis' | 'intake'
  modality: 'in_person' | 'telehealth'
  scheduled_start: string
  duration_minutes: number
  status: SessionStatus
  location: string | null
  billing_status: string
  note_status: 'none' | 'draft' | 'signed'
}

export interface Note {
  id: number
  data: string
  assessment: string
  plan: string
  interventions: string[]
  goal_ids: number[]
  risk_level: 'none' | 'low' | 'elevated'
  signed_at: string | null
  updated_at: string
  addenda: { id: number; text: string; created_at: string }[]
}

export interface SessionDetail extends SessionItem {
  note: Note | null
}

export interface Referral {
  id: number
  student: {
    id: number
    name: string
    grade: number
    school: string
    district_student_id: string
    iep: boolean
    ell: boolean
    has_504: boolean
    current_counselor: string | null
  }
  source: string
  referred_by: string
  reason: string
  concerns: string[]
  urgency: 'routine' | 'priority' | 'urgent'
  status: 'new' | 'accepted' | 'declined'
  assigned_counselor: string | null
  decision_note: string | null
  decided_at: string | null
  created_at: string
}

export interface Counselor extends User {
  caseload: number
}

export interface BillingLine {
  session_id: number
  service_date: string
  student_id: number
  student_name: string
  district_student_id: string
  medicaid_id: string | null
  school: string
  provider: string
  provider_credentials: string | null
  session_type: string
  modality: string
  duration_minutes: number
  service_code: string | null
  service_description: string
  modifier: string | null
  place_of_service: string
  units: number
  state: 'ready' | 'blocked' | 'exported' | 'not_eligible'
  issues: string[]
  billing_export_id: number | null
}

export interface BillingResponse {
  lines: BillingLine[]
  summary: { ready: number; blocked: number; exported: number; not_eligible: number }
  issues: { issue: string; count: number }[]
}

export interface BillingExport {
  id: number
  created_at: string
  created_by: string | null
  period_start: string
  period_end: string
  line_count: number
  total_units: number
}

export interface AuditEvent {
  id: number
  created_at: string
  user: string | null
  role: Role | null
  action: string
  entity_type: string
  entity_id: number | null
  student_id: number | null
  student_name: string | null
  detail: string | null
}
