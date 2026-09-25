/** Public page behind the one-time link: the user chooses their own password. */
import { Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import {
  AuthAlert,
  authButtonPrimary,
  AuthHeading,
  AuthLayout,
  AuthLink,
  AuthPasswordField,
  AuthStep,
} from '@/components/AuthLayout'
import { ApiError, request, session } from '@/lib/api'

const MIN_LENGTH = 12

export function SetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const tenant = params.get('tenant') ?? ''
  const uid = params.get('uid') ?? ''
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [errors, setErrors] = useState<{ password?: string; again?: string; link?: string }>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password.length < MIN_LENGTH) return setErrors({ password: `Password must be at least ${MIN_LENGTH} characters` })
    if (password !== again) return setErrors({ again: "Passwords don't match" })
    setErrors({})
    setBusy(true)
    try {
      session.setTenant(tenant)
      await request<void>('/auth/set-password/', { method: 'POST', body: { uid, token, password }, auth: false })
      setDone(true)
    } catch (error) {
      const fields = error instanceof ApiError ? error.problem.errors ?? {} : {}
      const list = (value: unknown) => (Array.isArray(value) ? value.join(' ') : value ? String(value) : undefined)
      setErrors({ password: list(fields.password), link: list(fields.token) ?? (list(fields.password) ? undefined : 'Could not set the password. Check your connection and try again.') })
    } finally {
      setBusy(false)
    }
  }

  const missing = !tenant || !uid || !token

  return (
    <AuthLayout>
      {done ? (
        <AuthStep>
          <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-success">
            <Check size={20} strokeWidth={1.5} className="text-white" />
          </span>
          <AuthHeading title="Password Updated">Log in with your new password to continue.</AuthHeading>
          <button type="button" onClick={() => navigate('/login')} className={authButtonPrimary}>
            Back to Log In
          </button>
        </AuthStep>
      ) : missing ? (
        <AuthStep>
          <AuthHeading title="This link is incomplete">
            Ask your administrator for a new one, then open it from the message they send.
          </AuthHeading>
          <AuthLink onClick={() => navigate('/login')}>← Back to Log In</AuthLink>
        </AuthStep>
      ) : (
        <AuthStep>
          <AuthHeading title="Set a New Password">Choose a password you haven't used on CEP before.</AuthHeading>
          {errors.link && <AuthAlert>{errors.link}</AuthAlert>}

          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            <AuthPasswordField
              label="New Password"
              autoComplete="new-password"
              placeholder={`At least ${MIN_LENGTH} characters`}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={errors.password}
            />
            <AuthPasswordField
              label="Confirm Password"
              autoComplete="new-password"
              placeholder="Re-enter your password"
              value={again}
              onChange={(event) => setAgain(event.target.value)}
              error={errors.again}
            />
            <button type="submit" disabled={busy} className={authButtonPrimary}>
              Update Password
            </button>
          </form>

          <AuthLink onClick={() => navigate('/login')}>← Back to Log In</AuthLink>
        </AuthStep>
      )}
    </AuthLayout>
  )
}
