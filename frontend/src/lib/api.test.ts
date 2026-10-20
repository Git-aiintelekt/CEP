/** The API client's session: a refresh uses the latest refresh token any tab stored (each works once), and signing out
 * ends the refresh token on the server as well as in the browser. */
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

type Sent = { url: string; body: Record<string, unknown> | null }

function stubFetch(answer: (url: string, body: Record<string, unknown> | null) => Response) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    sent.push({ url, body })
    return answer(url, body)
  }))
  return sent
}

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem('cep.access', 'access-old')
  window.localStorage.setItem('cep.refresh', 'refresh-old')
  window.localStorage.setItem('cep.tenant', 'NWA')
  vi.resetModules()
})
afterEach(() => vi.unstubAllGlobals())

test('a refresh uses the refresh token another tab stored since this one loaded', async () => {
  const { api } = await import('./api')
  window.localStorage.setItem('cep.refresh', 'refresh-from-other-tab')
  const sent = stubFetch((url, body) => {
    if (url.includes('/auth/token/refresh/')) return body?.refresh === 'refresh-from-other-tab' ? json({ access: 'access-new', refresh: 'refresh-new' }) : json({}, 401)
    return url.includes('/me/') && sent.filter((s) => s.url.includes('/me/')).length === 1 ? json({ title: 'Unauthorized' }, 401) : json({ ok: true })
  })

  await expect(api.get('/me/')).resolves.toEqual({ ok: true })
  expect(sent.find((s) => s.url.includes('/auth/token/refresh/'))?.body).toEqual({ refresh: 'refresh-from-other-tab' })
  expect(window.localStorage.getItem('cep.refresh')).toBe('refresh-new')
})

test('signing out sends the refresh token to be ended and clears the session', async () => {
  const { session } = await import('./api')
  const sent = stubFetch(() => json(null, 204))

  session.revoke()
  expect(sent).toEqual([{ url: expect.stringContaining('/auth/token/revoke/') as unknown as string, body: { refresh: 'refresh-old' } }])
  expect(window.localStorage.getItem('cep.access')).toBeNull()
  expect(window.localStorage.getItem('cep.refresh')).toBeNull()
})
