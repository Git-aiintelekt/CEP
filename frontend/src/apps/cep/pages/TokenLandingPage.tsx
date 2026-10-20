import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { FullPageSpinner } from '@/components/States'
import { api, SSO_BINDING_KEY } from '@/lib/api'

/** Only same-site paths: `next` travels through the identity provider and back, so it is not trusted as a URL. */
function safePath(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

function ssoBinding(): string | null {
  try {
    return window.sessionStorage.getItem(SSO_BINDING_KEY)
  } catch {
    return null
  }
}

function forgetSsoBinding() {
  try {
    window.sessionStorage.removeItem(SSO_BINDING_KEY)
  } catch {
    // nothing was kept
  }
}

/**
 * Where the API sends the browser back, with what it needs in the URL fragment (never the query string: fragments are
 * not sent to servers or written to access logs):
 *   /sso/complete#code=..&tenant=..                  after single sign-on: a one-time code, exchanged for the tokens only
 *                                                    with the binding this tab kept when the sign-in started
 *   /support-session#token=..&tenant=..              platform support acting as a user (no refresh token)
 */
export function TokenLandingPage({ kind }: { kind: 'sso' | 'support' }) {
  const { adopt } = useAuth()
  const navigate = useNavigate()
  // read once, before the effect wipes the fragment
  const [landing] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    return { secret: fragment.get(kind === 'sso' ? 'code' : 'token'), tenant: fragment.get('tenant'), binding: kind === 'sso' ? ssoBinding() : null }
  })
  const [failed, setFailed] = useState(!landing.secret || !landing.tenant || (kind === 'sso' && !landing.binding))
  const done = useRef(false)

  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname)          // the code leaves the address bar and the history at once
    if (kind === 'sso') forgetSsoBinding()                                     // one sign-in per binding
    if (done.current || failed || !landing.secret || !landing.tenant) return
    done.current = true
    if (kind === 'support') {
      adopt({ access: landing.secret, refresh: null }, landing.tenant)
      navigate('/', { replace: true })
      return
    }
    const tenant = landing.tenant
    api.ssoExchange(tenant, landing.secret, landing.binding ?? '').then(
      ({ access, refresh, next }) => {
        adopt({ access, refresh }, tenant)
        navigate(safePath(next), { replace: true })
      },
      () => setFailed(true),
    )
  }, [adopt, failed, kind, landing, navigate])

  if (!failed) return <FullPageSpinner label={kind === 'sso' ? 'Signing you in' : 'Opening the support session'} />
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div role="alert" className="max-w-sm rounded-lg border border-line bg-surface p-6 text-center">
        <h1 className="text-base font-semibold text-ink-900">{kind === 'sso' ? 'This sign-in did not finish' : 'This link is incomplete'}</h1>
        <p className="mt-1 text-sm text-ink-800">{kind === 'sso' ? 'Sign-in links work once, in the browser tab that started them. Start again from the sign-in page.' : 'Open the support session again from the back-office: each link works once.'}</p>
        <Link to="/login" className="mt-4 inline-block text-sm font-medium text-brand-800 hover:underline">Go to Sign In</Link>
      </div>
    </div>
  )
}
