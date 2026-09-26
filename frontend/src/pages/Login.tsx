import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { ErrorNote, initials } from '../ui'

const DEMO = [
  { email: 'maya.okafor@riverbend.example', name: 'Maya Okafor', role: 'Counselor, middle school' },
  { email: 'daniel.reyes@riverbend.example', name: 'Daniel Reyes', role: 'Counselor, high school' },
  { email: 'grace.whitfield@riverbend.example', name: 'Grace Whitfield', role: 'Administrator, Student Services' },
  { email: 'tom.alvarez@riverbend.example', name: 'Tom Alvarez', role: 'Billing specialist' },
]

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e?: FormEvent, override?: { email: string; password: string }) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(override?.email ?? email, override?.password ?? password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <section className="login-story">
        <div className="row">
          <img src="/cairn.svg" width={34} height={34} alt="" />
          <span className="brand-name" style={{ color: '#fff' }}>
            Cairn
          </span>
        </div>
        <h1>Every student's path to care, in one record.</h1>
        <p>
          Referrals, screenings, treatment plans, sessions and Medicaid documentation for school-based mental health
          teams.
        </p>
        <ol className="login-steps" aria-label="Care workflow">
          <li>Referral</li>
          <li>Intake and consent</li>
          <li>Treatment plan</li>
          <li>Sessions and notes</li>
          <li>Progress and billing</li>
        </ol>
      </section>

      <section className="login-form">
        <div className="inner">
          <h2 style={{ fontSize: 'var(--t-xl)' }}>Sign in</h2>
          <p className="muted small" style={{ marginTop: 4, marginBottom: 22 }}>
            Riverbend Unified School District
          </p>
          <form className="form" onSubmit={submit}>
            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <ErrorNote error={error} />
            <button className="btn primary block" disabled={busy}>
              {busy ? 'Signing in' : 'Sign in'}
            </button>
          </form>

          <div className="demo-accounts">
            <div className="small strong">Demo accounts</div>
            <p className="xs faint" style={{ marginBottom: 8 }}>
              All data is synthetic. Choose an account to sign in as that role.
            </p>
            {DEMO.map((d) => (
              <button key={d.email} type="button" disabled={busy} onClick={() => submit(undefined, { email: d.email, password: 'demo1234' })}>
                <span className="avatar sm">{initials(d.name)}</span>
                <span>
                  <span className="strong small" style={{ display: 'block' }}>
                    {d.name}
                  </span>
                  <span className="xs faint">{d.role}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
