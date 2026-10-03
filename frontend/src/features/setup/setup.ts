/** Set Up Your Workspace: the one query the page, the Home card and the first-sign-in landing share, and the sign-in flag. */
import { api } from '@/lib/api'
import type { WorkspaceSetup } from '@/lib/types'

export const SETUP_KEY = ['workspace', 'setup']
export const fetchSetup = (signal?: AbortSignal) => api.get<WorkspaceSetup>('/workspace/setup/', undefined, signal)

/** the Home card shows, and a fresh sign-in lands on the page, while the workspace is not ready and the card is not hidden */
export const setupWanted = (data: WorkspaceSetup | null | undefined): data is WorkspaceSetup => Boolean(data && !data.ready && !data.dismissed)

/** set by the sign-in page as it leaves for the app; read once by the landing route */
export const FRESH_SIGN_IN_KEY = 'cep.freshSignIn'

export function markFreshSignIn() {
  try {
    window.sessionStorage.setItem(FRESH_SIGN_IN_KEY, '1')
  } catch {
    // a private window: the landing is Home as usual
  }
}

export function readFreshSignIn(): boolean {
  try {
    return window.sessionStorage.getItem(FRESH_SIGN_IN_KEY) === '1'
  } catch {
    return false
  }
}

export function clearFreshSignIn() {
  try {
    window.sessionStorage.removeItem(FRESH_SIGN_IN_KEY)
  } catch {
    // nothing to clear
  }
}
