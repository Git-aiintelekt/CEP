/**
 * "/" straight after signing in: an administrator whose workspace is not ready lands on Settings → Set-Up (unless the Home
 * card was hidden); everyone else, and every later visit to Home, gets Home. The sign-in page leaves a flag in session
 * storage; it is read once here.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Spinner } from '@/components/States'

import { SETUP_KEY, clearFreshSignIn, fetchSetup, readFreshSignIn, setupWanted } from '@/features/setup/setup'

import { LiveHome } from './LiveHome'

export function LandingAfterSignIn() {
  const { can } = useAuth()
  const [fresh] = useState(readFreshSignIn)
  useEffect(clearFreshSignIn, [])
  const wanted = fresh && can('user.admin')
  const setup = useQuery({ queryKey: SETUP_KEY, enabled: wanted, retry: false, queryFn: ({ signal }) => fetchSetup(signal) })

  if (wanted && setup.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  if (wanted && setupWanted(setup.data)) return <Navigate to="/settings/setup" replace />
  return <LiveHome />
}
