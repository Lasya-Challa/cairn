import { NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Phone } from 'lucide-react'
import { ApiError, api } from '../api'
import { gradeLabel, studentName } from '../format'
import { Empty, Flags, Loading, initials } from '../ui'
import type { StudentRecord as Rec } from '../types'
import OverviewTab from './student/Overview'
import AssessmentsTab from './student/Assessments'
import PlanTab from './student/Plan'
import SessionsTab from './student/Sessions'
import TimelineTab from './student/Timeline'
import ConsentsTab from './student/Consents'
import ProfileTab from './student/Profile'

const TABS = [
  ['', 'Overview'],
  ['assessments', 'Assessments'],
  ['plan', 'Plan and goals'],
  ['sessions', 'Sessions'],
  ['timeline', 'Support timeline'],
  ['consents', 'Consents'],
  ['profile', 'Profile and school data'],
] as const

export default function StudentRecord() {
  const id = Number(useParams().id)
  const record = useQuery({ queryKey: ['student', id], queryFn: () => api.get<Rec>(`/api/students/${id}`) })

  if (record.isLoading) return <Loading />
  if (record.error) {
    const status = (record.error as ApiError).status
    return (
      <section className="panel">
        <Empty title={status === 403 ? 'This student is not on your caseload' : 'Student not found'}>
          {status === 403
            ? 'Ask your administrator to reassign the student if you need access.'
            : 'Check the link or search from your caseload.'}
        </Empty>
      </section>
    )
  }

  const { student, case: studentCase } = record.data!
  const name = studentName(student)

  return (
    <>
      <header className="student-head">
        <span className="avatar">{initials(name)}</span>
        <div>
          <div className="row wrap" style={{ gap: 12 }}>
            <h1>{name}</h1>
            <Flags iep={student.iep} ell={student.ell} has504={student.has_504} />
            {studentCase ? (
              <span className="chip harbor">Open case</span>
            ) : (
              <span className="chip outline">No open case</span>
            )}
          </div>
          <div className="student-meta">
            <span>{gradeLabel(student.grade)}</span>
            <span>{student.school.name}</span>
            <span className="num">Student ID {student.district_student_id}</span>
            {student.counselor && <span>Counselor: {student.counselor.full_name}</span>}
          </div>
        </div>
        <div className="student-contact">
          <div className="strong" style={{ color: 'var(--ink)' }}>
            {student.guardian_name}
          </div>
          <div>{student.guardian_relationship}</div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <Phone size={13} /> <span className="num">{student.guardian_phone}</span>
          </div>
        </div>
      </header>

      <nav className="tabs" aria-label="Student record">
        {TABS.map(([path, label]) => (
          <NavLink key={path} to={path ? `/students/${id}/${path}` : `/students/${id}`} end>
            {label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<OverviewTab studentId={id} />} />
        <Route path="assessments" element={<AssessmentsTab studentId={id} />} />
        <Route path="plan" element={<PlanTab studentId={id} hasCase={!!studentCase} />} />
        <Route path="sessions" element={<SessionsTab studentId={id} hasCase={!!studentCase} />} />
        <Route path="timeline" element={<TimelineTab studentId={id} />} />
        <Route path="consents" element={<ConsentsTab studentId={id} student={student} />} />
        <Route path="profile" element={<ProfileTab studentId={id} student={student} />} />
        <Route path="*" element={<Navigate to={`/students/${id}`} replace />} />
      </Routes>
    </>
  )
}
