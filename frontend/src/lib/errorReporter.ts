import { session } from './api'
import { API_BASE_URL } from './config'

/**
 * Sends errors people hit in the browser to the back-office's Errors (POST /client-errors/): uncaught errors, rejected
 * promises nobody handled, and screens that crashed into the error screen. Off until installErrorReporter() runs
 * (main.tsx does; tests do not). Each distinct error is sent once per page load, at most 20 in all, and the reporter
 * never throws.
 */
export type ErrorSource = 'error' | 'rejection' | 'boundary'

const MAX_REPORTS = 20
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i, /The user aborted a request/i, /signal is aborted/i]
let enabled = false
let sent = 0
const seen = new Set<string>()

function describe(error: unknown): { kind: string; message: string; stack: string } {
  if (error instanceof Error) return { kind: error.name || 'Error', message: error.message || error.name, stack: error.stack ?? '' }
  if (error && typeof error === 'object' && 'message' in error) {
    const like = error as { name?: unknown; message?: unknown; stack?: unknown }
    return { kind: String(like.name ?? 'Error'), message: String(like.message ?? ''), stack: typeof like.stack === 'string' ? like.stack : '' }
  }
  if (typeof error === 'string') return { kind: 'Error', message: error, stack: '' }
  try {
    return { kind: 'Error', message: JSON.stringify(error) ?? String(error), stack: '' }
  } catch {
    return { kind: 'Error', message: String(error), stack: '' }
  }
}

export function reportError(error: unknown, how: ErrorSource, componentStack?: string): boolean {
  if (!enabled) return false
  try {
    const { kind, message, stack } = describe(error)
    if (!message.trim() || kind === 'AbortError' || IGNORED.some((pattern) => pattern.test(message))) return false
    const key = `${kind}|${message}|${window.location.pathname}`
    if (seen.has(key) || sent >= MAX_REPORTS) return false
    seen.add(key)
    sent += 1
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (session.tenant) headers['X-Tenant'] = session.tenant
    if (session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`
    const body = JSON.stringify({
      kind: kind.slice(0, 120),
      message: message.slice(0, 2000),
      stack: stack.slice(0, 8000),
      component_stack: componentStack?.slice(0, 3000),
      page: `${window.location.pathname}${window.location.search}`.slice(0, 500),
      how,
      release: import.meta.env.VITE_RELEASE ?? '',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    })
    void fetch(`${API_BASE_URL}/client-errors/`, { method: 'POST', headers, body, keepalive: true }).catch(() => undefined)
    return true
  } catch {
    return false
  }
}

function onError(event: ErrorEvent) {
  reportError(event.error ?? event.message, 'error')
}

function onRejection(event: PromiseRejectionEvent) {
  reportError(event.reason, 'rejection')
}

export function installErrorReporter() {
  if (enabled) return
  enabled = true
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
}

/** For tests: back to the state before installErrorReporter(). */
export function resetErrorReporter() {
  enabled = false
  sent = 0
  seen.clear()
  window.removeEventListener('error', onError)
  window.removeEventListener('unhandledrejection', onRejection)
}
