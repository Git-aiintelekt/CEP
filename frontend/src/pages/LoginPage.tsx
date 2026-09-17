import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Spinner } from '@/components/States'
import { api, ApiError } from '@/lib/api'
import { tenantFromHost } from '@/lib/config'
import type { AuthOptions } from '@/lib/types'

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Email or password is incorrect.'
    if (error.status === 403) return error.message || 'This workspace signs in with single sign-on.'
    if (error.status === 404) return 'That workspace does not exist. Check the tenant code.'
    if (error.status === 429) return 'Too many attempts. Wait a minute and try again.'
    if (error.status === 503) return 'This workspace is being migrated. Try again in a few minutes.'
    return error.message
  }
  return 'Cannot reach the server. Check that the API is running.'
}

/** The API sends failed single sign-on attempts back here as #sso_error=...; read once, then clean the address bar. */
function takeSsoError(): string | null {
  const message = new URLSearchParams(window.location.hash.slice(1)).get('sso_error')
  if (message) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  return message
}

const field = 'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink-900'
const primary = 'flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60'
const secondary = 'flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink-900 hover:bg-slate-50'

export function LoginPage() {
  const { status, tenant: rememberedTenant, login, verifyMfa } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const hostTenant = tenantFromHost()
  const [tenant, setTenant] = useState(hostTenant ?? rememberedTenant)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(takeSsoError)
  const [submitting, setSubmitting] = useState(false)
  const [options, setOptions] = useState<AuthOptions | null>(null)
  const [usePassword, setUsePassword] = useState(false)
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [code, setCode] = useState('')

  // what this workspace offers (single sign-on); asked once the code stops changing
  useEffect(() => {
    const wanted = tenant.trim()
    if (!wanted) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => void api.authOptions(wanted, controller.signal).then((found) => !controller.signal.aborted && setOptions(found)), 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [tenant])

  if (status === 'authenticated') return <Navigate to={from} replace />

  const sso = options?.sso_enabled && options.workspace.toUpperCase() === tenant.trim().toUpperCase() ? options : null
  const passwordHidden = Boolean(sso?.sso_enforced) && !usePassword

  async function run(action: () => Promise<void>) {
    setError(null)
    setSubmitting(true)
    try {
      await action()
    } catch (caught) {
      setError(mfaToken && caught instanceof ApiError && caught.status === 401 ? caught.message : messageFor(caught))
    } finally {
      setSubmitting(false)
    }
  }

  function onPassword(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      const pending = await login(tenant.trim(), email.trim(), password)
      if (pending) {
        setMfaToken(pending)
        setCode('')
      } else navigate(from, { replace: true })
    })
  }

  function onCode(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      await verifyMfa(mfaToken as string, code.trim())
      navigate(from, { replace: true })
    })
  }

  const alert = error && (
    <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {error}
    </p>
  )

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-base font-bold text-white">C</span>
          <div>
            <p className="text-base font-semibold text-ink-900">Customer Engagement Platform</p>
            <p className="text-sm text-ink-500">{mfaToken ? 'One more step' : 'Sign in to your workspace'}</p>
          </div>
        </div>

        {mfaToken ? (
          <form onSubmit={onCode} className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <label className="block text-sm font-medium text-ink-700">
              Authentication code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6 digits"
                className={`${field} font-mono tracking-widest`}
              />
            </label>
            <p className="mt-2 text-xs text-ink-500">Open your authenticator app for the current code. Lost your phone? Type one of your recovery codes instead.</p>
            {alert}
            <button type="submit" disabled={submitting} className={`mt-5 ${primary}`}>
              {submitting && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
              Verify
            </button>
            <button type="button" className="mt-3 w-full text-center text-sm font-medium text-brand-700 hover:underline" onClick={() => { setMfaToken(null); setPassword(''); setError(null) }}>
              Start again
            </button>
          </form>
        ) : (
          <form onSubmit={onPassword} className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
            {!hostTenant && (
              <label className="mb-4 block text-sm font-medium text-ink-700">
                Workspace
                <input
                  value={tenant}
                  onChange={(event) => setTenant(event.target.value)}
                  required
                  autoCapitalize="characters"
                  placeholder="Tenant code, e.g. NWA"
                  className={field}
                />
              </label>
            )}

            {sso && (
              <>
                <a href={api.ssoStartUrl(tenant.trim(), from)} className={sso.sso_enforced ? primary : secondary}>
                  Sign in with {sso.sso_name}
                </a>
                {passwordHidden ? (
                  <button type="button" className="mt-4 w-full text-center text-sm font-medium text-brand-700 hover:underline" onClick={() => setUsePassword(true)}>
                    Administrator? Sign in with a password
                  </button>
                ) : (
                  <p className="my-4 flex items-center gap-3 text-xs text-ink-500 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">or</p>
                )}
              </>
            )}

            {!passwordHidden && (
              <>
                <label className="mb-4 block text-sm font-medium text-ink-700">
                  Email
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" className={field} />
                </label>
                <label className="block text-sm font-medium text-ink-700">
                  Password
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" className={field} />
                </label>
              </>
            )}

            {alert}

            {!passwordHidden && (
              <button type="submit" disabled={submitting} className={`mt-5 ${sso?.sso_enforced ? secondary : primary}`}>
                {submitting && <Spinner className={`h-4 w-4 ${sso?.sso_enforced ? '' : 'border-white/40 border-t-white'}`} />}
                Sign in
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
