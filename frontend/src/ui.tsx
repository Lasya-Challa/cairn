import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { AssessmentBrief } from './types'

export type Tone = 'good' | 'watch' | 'concern' | 'muted'

export function severityTone(severity: string | undefined | null): Tone {
  if (!severity) return 'muted'
  const s = severity.toLowerCase()
  if (s === 'minimal' || s === 'mild') return 'good'
  if (s === 'moderate') return 'watch'
  return 'concern'
}

export function selTone(rating: string): Tone {
  return rating === 'green' ? 'good' : rating === 'yellow' ? 'watch' : 'concern'
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <div className="spinner" aria-hidden />
      {label}
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="title">{title}</div>
      {children && <div className="small">{children}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  return (
    <p className="error-text" role="alert">
      {message}
    </p>
  )
}

export function Flags({ iep, ell, has504 }: { iep: boolean; ell: boolean; has504: boolean }) {
  if (!iep && !ell && !has504) return null
  return (
    <span className="flags">
      {iep && (
        <span className="flag" title="Individualized Education Program">
          IEP
        </span>
      )}
      {has504 && (
        <span className="flag" title="Section 504 plan">
          504
        </span>
      )}
      {ell && (
        <span className="flag" title="English language learner">
          ELL
        </span>
      )}
    </span>
  )
}

export function ScoreChip({ brief, name }: { brief: AssessmentBrief | null; name: string }) {
  if (!brief) return <span className="faint">None</span>
  return (
    <span className={`chip ${severityTone(brief.severity)}`} title={`${name} on ${brief.date}`}>
      <span className="num">{brief.total}</span> {brief.severity}
    </span>
  )
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

function useInitialFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = ref.current
    const target = el?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button:not(.close)')
    ;(target ?? el)?.focus()
    return () => previous?.focus()
  }, [])
  return ref
}

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEscape(onClose)
  const ref = useInitialFocus<HTMLDivElement>()
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="muted small" style={{ marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button className="btn ghost small close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEscape(onClose)
  const ref = useInitialFocus<HTMLDivElement>()
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="btn ghost small close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>
  )
}

let pushToast: (msg: string) => void = () => {}

export function toast(message: string) {
  pushToast(message)
}

export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    let timer: number | undefined
    pushToast = (msg) => {
      setMessage(msg)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setMessage(null), 2800)
    }
    return () => window.clearTimeout(timer)
  }, [])
  if (!message) return null
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  )
}

export function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}
