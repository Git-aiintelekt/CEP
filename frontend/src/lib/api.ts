/**
 * Thin client for the C360 REST API.
 *  - JWT bearer auth with one silent refresh on 401 (refresh tokens rotate server-side)
 *  - X-Tenant header on every call (the API resolves the tenant before it authenticates)
 *  - errors are RFC 9457 problem+json -> ApiError
 *  - lists are cursor-paginated: { next, previous, results }
 */
import { API_BASE_URL, DEFAULT_TENANT } from './config'
import type { AuthOptions, LoginResult, Page, Problem, TokenPair } from './types'

/**
 * One sign-in per workspace: the tokens are stored under the workspace's code (`cep.access.NWA`), so tabs on different
 * workspaces keep their own session and tabs on the same one share it. Each tab remembers its workspace for itself
 * (sessionStorage, kept across a reload); `cep.tenant` is only the last one used, which the login page offers.
 */
const KEYS = { access: 'cep.access', refresh: 'cep.refresh', tenant: 'cep.tenant' } as const

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

function read(key: string, kind: 'local' | 'session' = 'local'): string | null {
  try {
    return storage(kind)?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string | null, kind: 'local' | 'session' = 'local'): void {
  try {
    if (value === null) storage(kind)?.removeItem(key)
    else storage(kind)?.setItem(key, value)
  } catch {
    /* private mode / blocked storage: the session simply does not survive a reload */
  }
}

/** A stored value that belongs to one workspace: `${name}.${CODE}`, the code in capitals as the API matches it. */
export function workspaceKey(name: string, tenant: string = memory.tenant): string {
  return `${name}.${tenant.trim().toUpperCase()}`
}

/** Before sessions were kept per workspace there was one, under `cep.access` / `cep.refresh`: it moves to its workspace. */
function migrateSharedSession(): void {
  const access = read(KEYS.access)
  const refresh = read(KEYS.refresh)
  if (access === null && refresh === null) return
  const tenant = (read(KEYS.tenant) ?? DEFAULT_TENANT).trim()
  if (tenant) {
    if (access !== null && read(workspaceKey(KEYS.access, tenant)) === null) write(workspaceKey(KEYS.access, tenant), access)
    if (refresh !== null && read(workspaceKey(KEYS.refresh, tenant)) === null) write(workspaceKey(KEYS.refresh, tenant), refresh)
  }
  write(KEYS.access, null)
  write(KEYS.refresh, null)
}

function sessionOf(tenant: string): { access: string | null; refresh: string | null; tenant: string } {
  if (!tenant.trim()) return { access: null, refresh: null, tenant }
  return { access: read(workspaceKey(KEYS.access, tenant)), refresh: read(workspaceKey(KEYS.refresh, tenant)), tenant }
}

migrateSharedSession()
let memory = sessionOf(read(KEYS.tenant, 'session') ?? read(KEYS.tenant) ?? DEFAULT_TENANT)

export const session = {
  get tenant() {
    return memory.tenant
  },
  get hasToken() {
    return memory.access !== null
  },
  get accessToken() {
    return memory.access
  },
  /** This tab now works in `tenant`, with whatever session that workspace already has in this browser. */
  setTenant(tenant: string) {
    memory = sessionOf(tenant)
    write(KEYS.tenant, tenant)
    write(KEYS.tenant, tenant, 'session')
  },
  /** refresh: null forgets the stored one (a support session has none, and must never refresh into someone else) */
  setTokens(tokens: { access?: string; refresh?: string | null }) {
    if (tokens.access !== undefined) {
      memory.access = tokens.access
      write(workspaceKey(KEYS.access), tokens.access)
    }
    if (tokens.refresh !== undefined) {
      memory.refresh = tokens.refresh
      write(workspaceKey(KEYS.refresh), tokens.refresh)
    }
  },
  /** Ends this workspace's session in the browser; other workspaces' sessions stay. */
  clear() {
    memory = { ...memory, access: null, refresh: null }
    write(workspaceKey(KEYS.access), null)
    write(workspaceKey(KEYS.refresh), null)
  },
  /** signing out ends the refresh token on the server too; the session is cleared whether or not that call gets through */
  revoke() {
    const refresh = memory.refresh
    if (refresh) {
      fetch(buildUrl('/auth/token/revoke/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Tenant': memory.tenant },
        body: JSON.stringify({ refresh }),
        keepalive: true,
      }).catch(() => undefined)
    }
    session.clear()
  },
}

/** The single sign-on binding: kept in this tab when the sign-in starts, shown again to collect the tokens. */
export const SSO_BINDING_KEY = 'cep.sso.binding'

export function newSsoBinding(): string {
  const bytes = window.crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Raised when the API ends the session; `detail` says why, for the login page's notice. */
export const UNAUTHORIZED_EVENT = 'cep:unauthorized'
export type SignedOutReason = 'expired' | 'unknown-workspace'
/** the title of the API's 404 when no workspace matches X-Tenant (TenantMiddleware) */
const UNKNOWN_WORKSPACE_TITLE = 'Unknown tenant'

export class ApiError extends Error {
  status: number
  problem: Problem

  constructor(status: number, problem: Problem) {
    super(problem.detail ?? problem.title ?? `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
  }

  /** Field errors from a 400 response, flattened to `field -> first message`. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [field, messages] of Object.entries(this.problem.errors ?? {})) {
      out[field] = Array.isArray(messages) ? String(messages[0]) : String(messages)
    }
    return out
  }
}

type Query = Record<string, string | number | boolean | null | undefined>

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** JSON-serialised, except FormData which is sent as multipart (the browser sets the boundary header) */
  body?: unknown
  query?: Query
  /** false for the login / refresh calls themselves */
  auth?: boolean
  signal?: AbortSignal
}

function buildUrl(path: string, query?: Query): string {
  const url = `${API_BASE_URL}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function parseProblem(response: Response): Promise<Problem> {
  try {
    const data = (await response.json()) as Problem
    return { status: response.status, ...data }
  } catch {
    // not problem+json (a proxy's page, an HTML error): never show its words
    return { type: 'about:blank', title: response.status >= 500 ? 'C360 had a problem' : 'The request was refused', status: response.status }
  }
}

/** No answer at all (offline, the server unreachable): status 0, in C360's words rather than the browser's. */
function unreachable(): ApiError {
  return new ApiError(0, { type: 'about:blank', title: 'C360 could not be reached', status: 0, detail: 'C360 could not be reached. Check your connection and try again.' })
}

let refreshing: Promise<boolean> | null = null

/** Single-flight: concurrent 401s share one refresh call. */
function refreshAccessToken(): Promise<boolean> {
  // a refresh token works once: another tab of this workspace may already have rotated it, so use the latest one stored for it
  const stored = read(workspaceKey(KEYS.refresh))
  if (stored && memory.refresh) memory.refresh = stored
  if (!memory.refresh) return Promise.resolve(false)
  refreshing ??= (async () => {
    try {
      const response = await fetch(buildUrl('/auth/token/refresh/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Tenant': memory.tenant },
        body: JSON.stringify({ refresh: memory.refresh }),
      })
      if (!response.ok) return false
      session.setTokens((await response.json()) as Partial<TokenPair>)
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, signal } = options

  const send = () => {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Tenant': memory.tenant }
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
    if (auth && memory.access) headers.Authorization = `Bearer ${memory.access}`
    return fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal,
    }).catch((error: unknown) => {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      throw unreachable()
    })
  }

  let response = await send()
  if (response.status === 401 && auth && (await refreshAccessToken())) response = await send()

  if (response.status === 401 && auth) {
    session.clear()
    window.dispatchEvent(new CustomEvent<SignedOutReason>(UNAUTHORIZED_EVENT, { detail: 'expired' }))
  }
  if (!response.ok) {
    const problem = await parseProblem(response)
    // the workspace this tab was signed in to is not known (mistyped, or removed): back to the login page, which says so
    if (response.status === 404 && auth && memory.access !== null && problem.title === UNKNOWN_WORKSPACE_TITLE) {
      session.clear()
      window.dispatchEvent(new CustomEvent<SignedOutReason>(UNAUTHORIZED_EVENT, { detail: 'unknown-workspace' }))
    }
    throw new ApiError(response.status, problem)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** `next` / `previous` are absolute URLs: only the cursor is reused, so the dev proxy and any API host keep working. */
export function cursorOf(link: string | null): string | null {
  if (!link) return null
  try {
    return new URL(link, window.location.origin).searchParams.get('cursor')
  } catch {
    return null
  }
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, { query, signal }),
  list: <T>(path: string, query?: Query, signal?: AbortSignal) => request<Page<T>>(path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
  /** a file the API produces (CSV export): the bytes, fetched with the session like any other call */
  async download(path: string, query?: Query): Promise<Blob> {
    const send = () => fetch(buildUrl(path, query), { headers: { 'X-Tenant': memory.tenant, ...(memory.access ? { Authorization: `Bearer ${memory.access}` } : {}) } })
    let response = await send()
    if (response.status === 401 && (await refreshAccessToken())) response = await send()
    if (!response.ok) throw new ApiError(response.status, await parseProblem(response))
    return response.blob()
  },
  /** multipart upload of one file in the `file` field */
  upload: <T>(path: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<T>(path, { method: 'POST', body: form })
  },

  /** Tokens are stored when the password was enough; otherwise the result carries the `mfa_token` for verifyMfa(). */
  async login(tenant: string, email: string, password: string): Promise<LoginResult> {
    session.setTenant(tenant)
    const result = await request<LoginResult>('/auth/token/', { method: 'POST', body: { email, password }, auth: false })
    if (result.access) session.setTokens(result)
    return result
  },

  async verifyMfa(mfaToken: string, code: string): Promise<void> {
    session.setTokens(await request<TokenPair>('/auth/mfa/verify/', { method: 'POST', body: { mfa_token: mfaToken, code }, auth: false }))
  },

  /** What the login page may offer for a workspace (single sign-on); null when the workspace is unknown. */
  async authOptions(tenant: string, signal?: AbortSignal): Promise<AuthOptions | null> {
    try {
      const response = await fetch(buildUrl('/auth/options/'), { headers: { Accept: 'application/json', 'X-Tenant': tenant }, signal })
      return response.ok ? ((await response.json()) as AuthOptions) : null
    } catch {
      return null
    }
  },

  /** Browser navigation, not fetch: the identity provider's page has to open. */
  ssoStartUrl: (tenant: string, next: string, binding: string) => buildUrl('/auth/sso/start/', { tenant, next, binding }),

  /** After single sign-on: the one-time code and this tab's binding -> the tokens (for adopt()) and where to go. */
  ssoExchange(tenant: string, code: string, binding: string): Promise<TokenPair & { next: string }> {
    session.setTenant(tenant)
    return request<TokenPair & { next: string }>('/auth/sso/exchange/', { method: 'POST', body: { code, binding }, auth: false })
  },
}
