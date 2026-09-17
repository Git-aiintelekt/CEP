/** Public page behind the one-time link an administrator sends: the user chooses their own password. */
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { buttonPrimary, Field, TextInput } from '@/components/Form'
import { Spinner } from '@/components/States'
import { ApiError, request, session } from '@/lib/api'

export function SetPasswordPage() {
  const [params] = useSearchParams()
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
    if (password.length < 12) return setErrors({ password: 'Use at least 12 characters.' })
    if (password !== again) return setErrors({ again: 'The two passwords are not the same.' })
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
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-base font-bold text-white">C</span>
          <div>
            <p className="text-base font-semibold text-ink-900">Customer Engagement Platform</p>
            <p className="text-sm text-ink-500">Choose your password</p>
          </div>
        </div>
        {done ? (
          <div role="status" className="rounded-2xl border border-line bg-surface p-6 text-sm text-ink-700 shadow-sm">
            <p className="font-medium text-ink-900">Your password is set.</p>
            <p className="mt-1">This link no longer works. Sign in with your email address and the password you just chose.</p>
            <Link to="/login" className={`${buttonPrimary} mt-4`}>Go to sign in</Link>
          </div>
        ) : missing ? (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">This link is incomplete. Ask your administrator for a new one.</p>
        ) : (
          <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <Field label="New password" required error={errors.password} hint="At least 12 characters. A sentence you can remember works well.">
              {(ids) => <TextInput {...ids} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
            </Field>
            <Field label="Repeat the password" required error={errors.again}>
              {(ids) => <TextInput {...ids} type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />}
            </Field>
            {errors.link && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors.link}</p>}
            <button type="submit" disabled={busy} className={`${buttonPrimary} w-full`}>
              {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}Set password
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
