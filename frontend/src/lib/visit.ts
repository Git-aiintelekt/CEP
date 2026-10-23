/** Switch Workspace (apps/platform_ops/visits.py): entering a workspace as a platform administrator, and Back to Platform. The
 * browser keeps one session per workspace, so the Platform session stays stored while the tab works in the visited one. */
import { api, session } from './api'
import type { VisitStart } from './types'

/** the whole page starts afresh in the other workspace (every cache and query emptied); a seam for the tests */
export const navigation = { go: (path: string) => window.location.assign(path) }

/** the tab moves into the visited workspace with the visit's tokens, and starts afresh there */
export function enterVisit(visit: VisitStart): void {
  session.setTenant(visit.tenant)
  session.setTokens({ access: visit.access, refresh: visit.refresh })
  navigation.go('/')
}

/** the visit ends on the server (whether or not that call gets through), its tokens are forgotten, and the tab goes home */
export async function leaveVisit(home: string): Promise<void> {
  try {
    await api.post('/auth/visit/end/')
  } catch {
    /* already ended, or unreachable: going home either way */
  }
  session.clear()
  session.setTenant(home)
  navigation.go('/')
}
