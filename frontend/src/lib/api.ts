/**
 * Thin client for the CEP REST API.
 *  - JWT bearer auth with one silent refresh on 401 (refresh tokens rotate server-side)
 *  - X-Tenant header on every call (the API resolves the tenant before it authenticates)
 *  - errors are RFC 9457 problem+json -> ApiError
 *  - lists are cursor-paginated: { next, previous, results }
 */
import { API_BASE_URL, DEFAULT_TENANT } from './config'
import type { AuthOptions, LoginResult, Page, Problem, TokenPair } from './types'

const KEYS = { access: 'cep.access', refresh: 'cep.refresh', tenant: 'cep.tenant' } as const

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* private mode / blocked storage: the session simply does not survive a reload */
  }
}

let memory: { access: string | null; refresh: string | null; tenant: string } = {
  access: read(KEYS.access),
  refresh: read(KEYS.refresh),
  tenant: read(KEYS.tenant) ?? DEFAULT_TENANT,
}

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
  setTenant(tenant: string) {
    memory = { ...memory, tenant }
    write(KEYS.tenant, tenant)
  },
  /** refresh: null forgets the stored one (a support session has none, and must never refresh into someone else) */
  setTokens(tokens: { access?: string; refresh?: string | null }) {
    if (tokens.access !== undefined) {
      memory.access = tokens.access
      write(KEYS.access, tokens.access)
    }
    if (tokens.refresh !== undefined) {
      memory.refresh = tokens.refresh
      write(KEYS.refresh, tokens.refresh)
    }
  },
  clear() {
    memory = { ...memory, access: null, refresh: null }
    write(KEYS.access, null)
    write(KEYS.refresh, null)
  },
}

export const UNAUTHORIZED_EVENT = 'cep:unauthorized'

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
    return { type: 'about:blank', title: response.statusText || 'Request failed', status: response.status }
  }
}

let refreshing: Promise<boolean> | null = null

/** Single-flight: concurrent 401s share one refresh call. */
function refreshAccessToken(): Promise<boolean> {
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
    })
  }

  let response = await send()
  if (response.status === 401 && auth && (await refreshAccessToken())) response = await send()

  if (response.status === 401 && auth) {
    session.clear()
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  if (!response.ok) throw new ApiError(response.status, await parseProblem(response))
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
  ssoStartUrl: (tenant: string, next: string) => buildUrl('/auth/sso/start/', { tenant, next }),
}
