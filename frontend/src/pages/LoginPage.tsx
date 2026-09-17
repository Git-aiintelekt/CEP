import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Spinner } from '@/components/States'
import { ApiError } from '@/lib/api'
import { tenantFromHost } from '@/lib/config'

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Email or password is incorrect.'
    if (error.status === 404) return 'That workspace does not exist. Check the tenant code.'
    if (error.status === 503) return 'This workspace is being migrated. Try again in a few minutes.'
    return error.message
  }
  return 'Cannot reach the server. Check that the API is running.'
}

export function LoginPage() {
  const { status, tenant: rememberedTenant, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const hostTenant = tenantFromHost()
  const [tenant, setTenant] = useState(hostTenant ?? rememberedTenant)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') return <Navigate to={from} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(tenant.trim(), email.trim(), password)
      navigate(from, { replace: true })
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setSubmitting(false)
    }
  }

  const field = 'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink-900'

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-base font-bold text-white">C</span>
          <div>
            <p className="text-base font-semibold text-ink-900">Customer Engagement Platform</p>
            <p className="text-sm text-ink-500">Sign in to your workspace</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
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
          <label className="mb-4 block text-sm font-medium text-ink-700">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="username"
              className={field}
            />
          </label>
          <label className="block text-sm font-medium text-ink-700">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              className={field}
            />
          </label>

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  )
}
