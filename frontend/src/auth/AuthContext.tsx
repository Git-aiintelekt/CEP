import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api, session, UNAUTHORIZED_EVENT } from '@/lib/api'
import type { Me, PermissionCode } from '@/lib/types'

interface AuthValue {
  status: 'loading' | 'anonymous' | 'authenticated'
  me: Me | null
  tenant: string
  login: (tenant: string, email: string, password: string) => Promise<void>
  logout: () => void
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
    session.clear()
    setHasToken(false)
    queryClient.clear()
  }, [queryClient])

  // The API client raises this when a refresh fails: drop to the login screen from anywhere.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout)
  }, [logout])

  const login = useCallback(
    async (tenant: string, email: string, password: string) => {
      await api.login(tenant, email, password)
      queryClient.clear()
      setHasToken(true)
    },
    [queryClient],
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
      logout,
      can: (permission) => Boolean(me?.principal.is_platform_admin) || permissions.has(permission),
    }
  }, [hasToken, meQuery.data, meQuery.isError, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
