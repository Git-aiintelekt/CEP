/**
 * The workspaces logged in to on this computer (docs/mockups/same-user-workspaces.html, option A): the log-in page offers them as
 * chips under Workspace ID, and the account menu offers Log In to Another Workspace. Only this browser keeps them; nothing about
 * another workspace ever comes from the server. Each is kept with the address it was used at (its own subdomain, usually).
 */
const KEY = 'cep.recentWorkspaces'
const MAX = 5

export interface RecentWorkspace {
  code: string
  name: string | null
  environment: 'PRODUCTION' | 'STAGING'
  /** where it was logged in to: https://citist.cep.example.com */
  origin: string
  at: number
}

export function recentWorkspaces(): RecentWorkspace[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as RecentWorkspace[]
    return Array.isArray(stored) ? stored.filter((item) => item && typeof item.code === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

export function rememberWorkspace(workspace: Omit<RecentWorkspace, 'at' | 'origin'>): void {
  try {
    const kept = recentWorkspaces().filter((item) => item.code !== workspace.code)
    const next = [{ ...workspace, origin: window.location.origin, at: Date.now() }, ...kept].slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage blocked: the chips and the menu simply have nothing to offer
  }
}

/** where to log in to a remembered workspace: its own address, or this one with the Workspace ID filled in */
export function logInAddress(workspace: RecentWorkspace): string {
  return workspace.origin && workspace.origin !== window.location.origin
    ? `${workspace.origin}/login`
    : `/login?workspace=${encodeURIComponent(workspace.code)}`
}
