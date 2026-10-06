import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { SIGNED_OUT_REASON_KEY } from '@/auth/SessionIdleGuard'
import {
  AuthAlert,
  AuthField,
  authButtonPrimary,
  authButtonSecondary,
  AuthHeading,
  AuthLayout,
  AuthLink,
  AuthNotice,
  AuthPasswordField,
  AuthStep,
} from '@/components/AuthLayout'
import { api, ApiError, request } from '@/lib/api'
import { tenantFromHost } from '@/lib/config'
import { LOADING_HOLD_MS, loadingOverlay } from '@/lib/loadingOverlay'
import type { AuthOptions } from '@/lib/types'

import { markFreshSignIn } from '@/features/setup/setup'

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Incorrect email or password. Try again.'
    if (error.status === 403) return error.message || 'This workspace signs in with single sign-on.'
    if (error.status === 404) return 'That workspace does not exist. Check the workspace code.'
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

/** How long the loader takes to fade before it unmounts and the shell takes over. */
const LOADER_FADE_MS = 600 // TEMPORARY: slowed from 150 so the fade is easy to watch

type Step = 'signin' | 'mfa' | 'reset' | 'sent'

export function LoginPage() {
  const { status, tenant: rememberedTenant, login, verifyMfa } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const hostTenant = tenantFromHost()
  const [step, setStep] = useState<Step>('signin')
  // read once and cleared: a refresh of this same page must not keep repeating a notice about a sign-out that already happened
  const [signedOutReason] = useState(() => {
    try {
      const reason = window.sessionStorage.getItem(SIGNED_OUT_REASON_KEY)
      if (reason) window.sessionStorage.removeItem(SIGNED_OUT_REASON_KEY)
      return reason
    } catch {
      return null
    }
  })
  const [tenant, setTenant] = useState(hostTenant ?? rememberedTenant)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(takeSsoError)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resentAt, setResentAt] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [options, setOptions] = useState<AuthOptions | null>(null)
  const [usePassword, setUsePassword] = useState(false)
  const [mfaToken, setMfaToken] = useState<string | null>(null)

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

  if (status === 'authenticated' && !submitting) return <Navigate to={from} replace />

  const sso = options?.sso_enabled && options.workspace.toUpperCase() === tenant.trim().toUpperCase() ? options : null
  const passwordHidden = Boolean(sso?.sso_enforced) && !usePassword

  /**
   * Runs only once the server has accepted the credentials, so a wrong password or code never shows the animation:
   * it goes straight to the message. Then navigate first and fade: the dashboard is mounted underneath by then, so the
   * loader dissolves onto it instead of revealing this form again, while the shell's own settle runs alongside.
   */
  async function leaveForApp() {
    loadingOverlay.show('Logging you in…')
    await new Promise((resolve) => window.setTimeout(resolve, LOADING_HOLD_MS))
    if (from === '/') markFreshSignIn()                                            // the landing route may send an administrator to Set-Up
    navigate(from, { replace: true })
    loadingOverlay.fadeOut()
    window.setTimeout(() => loadingOverlay.hide(), LOADER_FADE_MS)
  }

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
        setStep('mfa')
      } else await leaveForApp()
    })
  }

  function onCode(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      await verifyMfa(mfaToken as string, code.trim())
      await leaveForApp()
    })
  }

  /**
   * The endpoint that mints a reset link for an anonymous caller does not exist yet: today only an administrator can
   * create one. Until it lands this 404s, and we say so rather than claiming an email is on its way.
   */
  async function sendResetLink() {
    setResetError(null)
    setSubmitting(true)
    try {
      await request<void>('/auth/forgot-password/', { method: 'POST', body: { email: email.trim() }, auth: false })
      setStep('sent')
      return true
    } catch (caught) {
      const missing = caught instanceof ApiError && (caught.status === 404 || caught.status === 405 || caught.status === 501)
      setResetError(missing ? 'Password reset by email is not switched on yet. Ask your administrator to send you a link.' : messageFor(caught))
      return false
    } finally {
      setSubmitting(false)
    }
  }

  function onReset(event: FormEvent) {
    event.preventDefault()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setResetError('Enter a valid email address')
    void sendResetLink()
  }

  function goTo(next: Step) {
    setStep(next)
    setError(null)
    setResetError(null)
    setResentAt(null)
    if (next === 'signin') {
      setPassword('')
      setMfaToken(null)
    }
  }

  return (
    <AuthLayout>
      {step === 'signin' && (
        <AuthStep>
          <AuthHeading title="Log In to CEP">Enter your email and password to continue.</AuthHeading>
          {signedOutReason === 'idle' && !error && <AuthNotice>You were signed out after some time without activity. Log in again to continue.</AuthNotice>}
          {signedOutReason === 'expired' && !error && (
            <AuthNotice>Your session ended. Sign in again to carry on. Changes on the page you were on that were not saved are not kept.</AuthNotice>
          )}
          {error && <AuthAlert>{error}</AuthAlert>}

          <form onSubmit={onPassword} className="flex flex-col gap-5">
            {/* only asked for when the address bar cannot say which workspace this is */}
            {!hostTenant && (
              <AuthField
                label="Workspace"
                value={tenant}
                onChange={(event) => setTenant(event.target.value)}
                required
                autoCapitalize="characters"
                placeholder="Workspace code, e.g. NWA"
              />
            )}

            {sso && (
              <a href={api.ssoStartUrl(tenant.trim(), from)} className={sso.sso_enforced ? authButtonPrimary : authButtonSecondary}>
                Log In with {sso.sso_name}
              </a>
            )}

            {passwordHidden ? (
              <AuthLink onClick={() => setUsePassword(true)}>Administrator? Log in with a password</AuthLink>
            ) : (
              <>
                {sso && (
                  <p className="flex items-center gap-3 text-xs text-ink-800 before:h-px before:flex-1 before:bg-fill-muted after:h-px after:flex-1 after:bg-fill-muted">
                    or
                  </p>
                )}
                <AuthField
                  label="Email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  invalid={Boolean(error)}
                />
                <AuthPasswordField
                  label="Password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  invalid={Boolean(error)}
                  action={<AuthLink onClick={() => goTo('reset')}>Forgot password?</AuthLink>}
                />
                <button type="submit" disabled={submitting} className={authButtonPrimary}>
                  Log In
                </button>
              </>
            )}
          </form>

          <p className="text-[13px] leading-normal text-ink-800">
            By continuing you agree to CEP's Terms of Service and Privacy Policy.
          </p>
        </AuthStep>
      )}

      {step === 'mfa' && (
        <AuthStep>
          <AuthHeading title="Enter Your Code">
            Open your authenticator app for the current code. Lost your phone? Type one of your recovery codes instead.
          </AuthHeading>
          {error && <AuthAlert>{error}</AuthAlert>}

          <form onSubmit={onCode} className="flex flex-col gap-5">
            <AuthField
              label="Authentication Code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 digits"
              className="cep-num tracking-widest"
              invalid={Boolean(error)}
            />
            <button type="submit" disabled={submitting} className={authButtonPrimary}>
              Verify
            </button>
          </form>

          <AuthLink onClick={() => goTo('signin')}>← Back to Log In</AuthLink>
        </AuthStep>
      )}

      {step === 'reset' && (
        <AuthStep>
          <AuthHeading title="Reset Your Password">Enter your email and we'll send a link to reset it.</AuthHeading>

          {/* the address is checked below, so the browser's own bubble would only duplicate it */}
          <form onSubmit={onReset} noValidate className="flex flex-col gap-5">
            <AuthField
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setResetError(null)
              }}
              required
              autoFocus
              error={resetError ?? undefined}
            />
            <button type="submit" disabled={submitting} className={authButtonPrimary}>
              Send Reset Link
            </button>
          </form>

          <AuthLink onClick={() => goTo('signin')}>← Back to Log In</AuthLink>
        </AuthStep>
      )}

      {step === 'sent' && (
        <AuthStep>
          <AuthHeading title="Check Your Email">
            We sent a reset link to <span className="font-medium text-ink-900">{email.trim()}</span>. The link expires in 72 hours.
          </AuthHeading>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void sendResetLink().then((ok) => ok && setResentAt(new Date().toISOString().slice(11, 16)))}
              className={authButtonSecondary}
            >
              Resend Link
            </button>
            {resetError && <AuthAlert>{resetError}</AuthAlert>}
            {resentAt && <span className="text-[13px] text-ink-800">Link resent at {resentAt} UTC</span>}
          </div>

          <div className="border-t border-line pt-4">
            <AuthLink onClick={() => goTo('signin')}>← Back to Log In</AuthLink>
          </div>
        </AuthStep>
      )}

    </AuthLayout>
  )
}
