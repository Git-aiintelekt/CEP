import { useMemo } from 'react'

import { useAuth } from '@/auth/AuthContext'

import { HomePage } from './HomePage'
import { HomeDataProvider } from './data/HomeDataProvider'
import { liveSource } from './data/liveSource'
import type { HomeViewer } from './data/types'

/** "/": Home on the API, for the person signed in */
export function LiveHome() {
  const { me, can, has } = useAuth()
  const viewer = useMemo<HomeViewer>(() => ({
    firstName: me?.principal.display_name?.split(' ')[0] ?? '',
    timezone: me?.tenant.timezone || 'UTC',
    can,
    has,
  }), [me, can, has])
  return <HomeDataProvider source={liveSource} viewer={viewer}><HomePage /></HomeDataProvider>
}
