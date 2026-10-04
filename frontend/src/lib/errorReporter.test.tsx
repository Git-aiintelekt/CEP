import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from '@/components/ErrorBoundary'

import { session } from './api'
import { installErrorReporter, reportError, resetErrorReporter } from './errorReporter'

function sentBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, string>)
}

describe('errorReporter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    session.setTenant('NWA')
    window.history.pushState({}, '', '/campaigns/abc/edit?tab=2')
  })

  afterEach(() => {
    resetErrorReporter()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends nothing until installed', () => {
    expect(reportError(new Error('boom'), 'error')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the error with its page, tenant and how it was caught', () => {
    installErrorReporter()
    const error = new TypeError('Cannot read properties of undefined')
    expect(reportError(error, 'rejection')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/client-errors/')
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    expect((init.headers as Record<string, string>)['X-Tenant']).toBe('NWA')
    const [body] = sentBodies(fetchMock)
    expect(body).toMatchObject({ kind: 'TypeError', message: 'Cannot read properties of undefined', page: '/campaigns/abc/edit?tab=2', how: 'rejection' })
    expect(body.stack).toContain('TypeError')
  })

  it('sends each distinct error once and at most twenty in all', () => {
    installErrorReporter()
    reportError(new Error('same'), 'error')
    reportError(new Error('same'), 'error')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (let index = 0; index < 30; index += 1) reportError(new Error(`error ${index}`), 'error')
    expect(fetchMock).toHaveBeenCalledTimes(20)
  })

  it('leaves out noise: aborted requests, ResizeObserver warnings, opaque script errors', () => {
    installErrorReporter()
    reportError(new DOMException('The user aborted a request.', 'AbortError'), 'rejection')
    reportError('ResizeObserver loop completed with undelivered notifications.', 'error')
    reportError('Script error.', 'error')
    reportError('', 'error')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports rejected promises and uncaught errors from the window', () => {
    installErrorReporter()
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(rejection, 'reason', { value: new Error('nobody caught me') })
    window.dispatchEvent(rejection)
    window.dispatchEvent(new ErrorEvent('error', { error: new RangeError('out of range'), message: 'out of range' }))
    expect(sentBodies(fetchMock).map((body) => [body.how, body.message])).toEqual([['rejection', 'nobody caught me'], ['error', 'out of range']])
  })

  it('a screen that crashes into the error screen is reported with its component stack', () => {
    installErrorReporter()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    function Broken(): never {
      throw new Error('render failed')
    }
    const view = render(<ErrorBoundary><Broken /></ErrorBoundary>)
    expect(view.getByRole('alert').textContent).toContain('This screen could not be shown')
    const body = sentBodies(fetchMock).find((item) => item.how === 'boundary')
    expect(body?.message).toBe('render failed')
    expect(body?.component_stack).toContain('Broken')
  })

  it('never throws, even when sending fails', () => {
    installErrorReporter()
    fetchMock.mockImplementation(() => {
      throw new Error('offline')
    })
    expect(() => reportError(new Error('x'), 'error')).not.toThrow()
  })
})
