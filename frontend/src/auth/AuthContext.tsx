import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api, session, UNAUTHORIZED_EVENT, type SignedOutReason } from '@/lib/api'

import { SIGNED_OUT_REASON_KEY } from './signedOut'
import type { Feature, Me, PermissionCode } from '@/lib/types'

interface AuthValue {
  status: 'loading' | 'anonymous' | 'authenticated'
  me: Me | null
  tenant: string
  /** Resolves to the MFA token when a second factor is still needed (pass it to verifyMfa), else null: signed in. */
  login: (tenant: string, email: string, password: string) => Promise<string | null>
  verifyMfa: (mfaToken: string, code: string) => Promise<void>
  /** Tokens that arrived another way: the single sign-on redirect, a support session, MFA enrolment. */
  adopt: (tokens: { access: string; refresh?: string | null }, tenant?: string) => void
  logout: () => void
  /** Feature switches of the workspace (industry profile + plan). Unknown = on, so an older API hides nothing. */
  has: (feature: Feature) => boolean
  /** Platform admins hold every permission; everyone else is checked against the codes from GET /me. */
  can: (permission: PermissionCode) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [hasToken, setHasToken] = useState(session.hasToken)

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => api.get<Me>('/me/', undefined, signal),
    enabled: hasToken,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const logout = useCallback(() => {
    session.revoke()
    setHasToken(false)
    queryClient.clear()
  }, [queryClient])

  // The API client raises this when a refresh fails or the workspace is unknown: drop to the login screen from anywhere, and let it say why
  useEffect(() => {
    const ended = (event: Event) => {
      const reason: SignedOutReason = (event as CustomEvent<SignedOutReason | undefined>).detail ?? 'expired'
      try {
        if (!window.sessionStorage.getItem(SIGNED_OUT_REASON_KEY)) window.sessionStorage.setItem(SIGNED_OUT_REASON_KEY, reason)
      } catch {
        // storage blocked: the login screen simply has no notice
      }
      logout()
    }
    window.addEventListener(UNAUTHORIZED_EVENT, ended)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, ended)
  }, [logout])

  const signedIn = useCallback(() => {
    queryClient.clear()
    setHasToken(true)
  }, [queryClient])

  const login = useCallback(
    async (tenant: string, email: string, password: string) => {
      const result = await api.login(tenant, email, password)
      if (result.mfa_required && result.mfa_token) return result.mfa_token
      signedIn()
      return null
    },
    [signedIn],
  )

  const verifyMfa = useCallback(
    async (mfaToken: string, code: string) => {
      await api.verifyMfa(mfaToken, code)
      signedIn()
    },
    [signedIn],
  )

  const adopt = useCallback(
    (tokens: { access: string; refresh?: string | null }, tenant?: string) => {
      if (tenant) session.setTenant(tenant)
      session.setTokens({ access: tokens.access, refresh: tokens.refresh ?? null })
      signedIn()
    },
    [signedIn],
  )

  const value = useMemo<AuthValue>(() => {
    const me = hasToken ? (meQuery.data ?? null) : null
    const permissions = new Set(me?.principal.permissions ?? [])
    const status = !hasToken || meQuery.isError ? 'anonymous' : me ? 'authenticated' : 'loading'
    return {
      status,
      me,
      tenant: session.tenant,
      login,
      verifyMfa,
      adopt,
      logout,
      can: (permission) => Boolean(me?.principal.is_platform_admin) || permissions.has(permission),
      has: (feature) => me?.features?.[feature] !== false,
    }
  }, [hasToken, meQuery.data, meQuery.isError, login, verifyMfa, adopt, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
