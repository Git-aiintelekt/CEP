import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { FullPageSpinner } from '@/components/States'

/** Only same-site paths: `next` travels through the identity provider and back, so it is not trusted as a URL. */
function safePath(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

/**
 * Where the API sends the browser with tokens in the URL fragment (never the query string: fragments are not sent
 * to servers or written to access logs):
 *   /sso/complete#access=..&refresh=..&tenant=..&next=..    after single sign-on
 *   /support-session#token=..&tenant=..                     platform support acting as a user (no refresh token)
 */
export function TokenLandingPage({ kind }: { kind: 'sso' | 'support' }) {
  const { adopt } = useAuth()
  const navigate = useNavigate()
  // read once, before the effect wipes the fragment
  const [landing] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    return { access: fragment.get(kind === 'sso' ? 'access' : 'token'), refresh: kind === 'sso' ? fragment.get('refresh') : null, tenant: fragment.get('tenant'), next: fragment.get('next') }
  })
  const failed = !landing.access || !landing.tenant
  const done = useRef(false)

  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname)          // the tokens leave the address bar and the history at once
    if (done.current || !landing.access || !landing.tenant) return
    done.current = true
    adopt({ access: landing.access, refresh: landing.refresh }, landing.tenant)
    navigate(kind === 'sso' ? safePath(landing.next) : '/', { replace: true })
  }, [adopt, kind, landing, navigate])

  if (!failed) return <FullPageSpinner label={kind === 'sso' ? 'Signing you in' : 'Opening the support session'} />
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div role="alert" className="max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-sm">
        <h1 className="text-base font-semibold text-ink-900">This link is incomplete</h1>
        <p className="mt-1 text-sm text-ink-500">{kind === 'sso' ? 'The sign-in did not finish. Start again from the sign-in page.' : 'Open the support session again from the back-office: each link works once.'}</p>
        <Link to="/login" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">Go to sign in</Link>
      </div>
    </div>
  )
}
