/** The API client's session: one sign-in per workspace, so tabs on two workspaces do not sign each other out; a refresh uses
 * the latest refresh token any tab of the same workspace stored (each works once); signing out ends only that workspace's
 * session, on the server as well as in the browser; an unknown workspace ends the session and says so. */
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

type Sent = { url: string; body: Record<string, unknown> | null; tenant: string | null }

function stubFetch(answer: (url: string, body: Record<string, unknown> | null) => Response) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    sent.push({ url, body, tenant: new Headers(init?.headers).get('X-Tenant') })
    return answer(url, body)
  }))
  return sent
}

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** what another tab leaves behind when it signs in to CITYHT */
function otherTabSignsInToCityHT() {
  window.localStorage.setItem('cep.access.CITYHT', 'city-access')
  window.localStorage.setItem('cep.refresh.CITYHT', 'city-refresh')
  window.localStorage.setItem('cep.tenant', 'CITYHT')
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.localStorage.setItem('cep.access.NWA', 'access-old')
  window.localStorage.setItem('cep.refresh.NWA', 'refresh-old')
  window.localStorage.setItem('cep.tenant', 'NWA')
  vi.resetModules()
})
afterEach(() => vi.unstubAllGlobals())

test('a refresh uses the refresh token another tab of the same workspace stored since this one loaded', async () => {
  const { api } = await import('./api')
  window.localStorage.setItem('cep.refresh.NWA', 'refresh-from-other-tab')
  const sent = stubFetch((url, body) => {
    if (url.includes('/auth/token/refresh/')) return body?.refresh === 'refresh-from-other-tab' ? json({ access: 'access-new', refresh: 'refresh-new' }) : json({}, 401)
    return url.includes('/me/') && sent.filter((s) => s.url.includes('/me/')).length === 1 ? json({ title: 'Unauthorized' }, 401) : json({ ok: true })
  })

  await expect(api.get('/me/')).resolves.toEqual({ ok: true })
  expect(sent.find((s) => s.url.includes('/auth/token/refresh/'))?.body).toEqual({ refresh: 'refresh-from-other-tab' })
  expect(window.localStorage.getItem('cep.refresh.NWA')).toBe('refresh-new')
})

test('another tab signing in to a second workspace leaves this tab its own workspace and session', async () => {
  const { api, session } = await import('./api')
  otherTabSignsInToCityHT()
  const sent = stubFetch((url, body) => {
    if (url.includes('/auth/token/refresh/')) return body?.refresh === 'refresh-old' ? json({ access: 'access-new', refresh: 'refresh-new' }) : json({}, 401)
    return url.includes('/me/') && sent.filter((s) => s.url.includes('/me/')).length === 1 ? json({ title: 'Unauthorized' }, 401) : json({ ok: true })
  })

  await expect(api.get('/me/')).resolves.toEqual({ ok: true })
  expect(session.tenant).toBe('NWA')
  expect(sent.every((s) => s.tenant === 'NWA')).toBe(true)
  expect(sent.find((s) => s.url.includes('/auth/token/refresh/'))?.body).toEqual({ refresh: 'refresh-old' })
  expect(window.localStorage.getItem('cep.refresh.NWA')).toBe('refresh-new')
  expect(window.localStorage.getItem('cep.access.CITYHT')).toBe('city-access')
  expect(window.localStorage.getItem('cep.refresh.CITYHT')).toBe('city-refresh')
})

test('a refused refresh signs out only this workspace', async () => {
  const { api } = await import('./api')
  otherTabSignsInToCityHT()
  const ended: unknown[] = []
  window.addEventListener('cep:unauthorized', (event) => ended.push((event as CustomEvent).detail), { once: true })
  stubFetch(() => json({ title: 'Unauthorized' }, 401))

  await expect(api.get('/me/')).rejects.toMatchObject({ status: 401 })
  expect(ended).toEqual(['expired'])
  expect(window.localStorage.getItem('cep.access.NWA')).toBeNull()
  expect(window.localStorage.getItem('cep.refresh.NWA')).toBeNull()
  expect(window.localStorage.getItem('cep.refresh.CITYHT')).toBe('city-refresh')
})

test('a reloaded tab stays on its own workspace, not the one another tab used last', async () => {
  window.sessionStorage.setItem('cep.tenant', 'NWA')
  otherTabSignsInToCityHT()
  const { session } = await import('./api')

  expect(session.tenant).toBe('NWA')
  expect(session.accessToken).toBe('access-old')
})

test('switching this tab to another workspace takes that workspace\'s own session', async () => {
  otherTabSignsInToCityHT()
  window.sessionStorage.setItem('cep.tenant', 'NWA')
  const { session } = await import('./api')

  session.setTenant('cityht')
  expect(session.accessToken).toBe('city-access')
  expect(window.sessionStorage.getItem('cep.tenant')).toBe('cityht')
  session.setTokens({ access: 'city-access-2' })
  expect(window.localStorage.getItem('cep.access.CITYHT')).toBe('city-access-2')
  expect(window.localStorage.getItem('cep.access.NWA')).toBe('access-old')
})

test('signing out sends the refresh token to be ended and clears only this workspace\'s session', async () => {
  const { session } = await import('./api')
  otherTabSignsInToCityHT()
  const sent = stubFetch(() => json(null, 204))

  session.revoke()
  expect(sent).toEqual([{ url: expect.stringContaining('/auth/token/revoke/') as unknown as string, body: { refresh: 'refresh-old' }, tenant: 'NWA' }])
  expect(window.localStorage.getItem('cep.access.NWA')).toBeNull()
  expect(window.localStorage.getItem('cep.refresh.NWA')).toBeNull()
  expect(window.localStorage.getItem('cep.access.CITYHT')).toBe('city-access')
  expect(window.localStorage.getItem('cep.refresh.CITYHT')).toBe('city-refresh')
})

test('the one session kept before sessions were per workspace moves to its workspace, so nobody is signed out', async () => {
  window.localStorage.clear()
  window.localStorage.setItem('cep.access', 'access-shared')
  window.localStorage.setItem('cep.refresh', 'refresh-shared')
  window.localStorage.setItem('cep.tenant', 'CityHT')
  const { session } = await import('./api')

  expect(session.tenant).toBe('CityHT')
  expect(session.accessToken).toBe('access-shared')
  expect(window.localStorage.getItem('cep.access.CITYHT')).toBe('access-shared')
  expect(window.localStorage.getItem('cep.refresh.CITYHT')).toBe('refresh-shared')
  expect(window.localStorage.getItem('cep.access')).toBeNull()
  expect(window.localStorage.getItem('cep.refresh')).toBeNull()
})

test('a workspace the API does not know ends the session and says why; any other 404 is just an error', async () => {
  const { api } = await import('./api')
  const ended: unknown[] = []
  const listen = (event: Event) => ended.push((event as CustomEvent).detail)
  window.addEventListener('cep:unauthorized', listen)
  stubFetch((url) => (url.includes('/campaigns/') ? json({ type: 'about:blank', title: 'Not found', status: 404 }, 404) : json({ type: 'about:blank', title: 'Unknown tenant', status: 404 }, 404)))

  await expect(api.get('/campaigns/x/')).rejects.toMatchObject({ status: 404 })
  expect(ended).toEqual([])
  expect(window.localStorage.getItem('cep.access.NWA')).toBe('access-old')

  await expect(api.get('/me/')).rejects.toMatchObject({ status: 404 })
  expect(ended).toEqual(['unknown-workspace'])
  expect(window.localStorage.getItem('cep.access.NWA')).toBeNull()
  window.removeEventListener('cep:unauthorized', listen)
})
