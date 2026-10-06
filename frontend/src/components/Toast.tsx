import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { saveFailure } from '@/lib/saveFeedback'

type Tone = 'success' | 'error'

interface ToastOptions {
  /** ms until the toast removes itself; 0 or Infinity keeps it until dismissed */
  durationMs?: number
  /** CEP's own problem: ER-<error group>, shown as a chip the reader can quote */
  reference?: string | null
}

interface Toast {
  id: string
  tone: Tone
  title: string
  detail?: string
  durationMs: number
  reference?: string | null
}

interface ToastApi {
  success: (title: string, detail?: string, options?: ToastOptions) => string
  error: (title: string, detail?: string, options?: ToastOptions) => string
  /** a failed save, in CEP's words (lib/saveFeedback): `toast.failure(error, 'The template was not duplicated')` */
  failure: (error: unknown, failedTitle: string) => string
  dismiss: (id: string) => void
}

const SUCCESS_MS = 4500
const MAX_VISIBLE = 3
/** the same message fired twice in this window is the same event, not two */
const DUPLICATE_MS = 1000

const ToastContext = createContext<ToastApi | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const recent = useRef(new Map<string, number>())

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback((tone: Tone, title: string, detail?: string, options?: ToastOptions) => {
    const key = `${tone}\u0000${title}\u0000${detail ?? ''}`
    const now = Date.now()
    const last = recent.current.get(key)
    if (last !== undefined && now - last < DUPLICATE_MS) return ''
    for (const [seen, at] of recent.current) if (now - at >= DUPLICATE_MS) recent.current.delete(seen)
    recent.current.set(key, now)

    const id = `toast-${++seq.current}`
    const durationMs = options?.durationMs ?? (tone === 'success' ? SUCCESS_MS : 0)
    setToasts((current) => [...current, { id, tone, title, detail, durationMs, reference: options?.reference ?? null }].slice(-MAX_VISIBLE))
    return id
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, detail, options) => push('success', title, detail, options),
      error: (title, detail, options) => push('error', title, detail, options),
      failure: (error, failedTitle) => {
        // a toast has no fields to highlight: every message of a refusal is its detail, under what failed
        const failed = saveFailure(error, failedTitle, [])
        return push('error', failed.title, failed.short || undefined, { reference: failed.reference })
      },
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

/** Fixed under the top bar at the right, above the app shell and above an open modal. */
function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed top-[var(--cep-toast-top,72px)] right-6 z-60 flex flex-col items-end gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

/*
 * A custom toast style, signed off for the editor and pending a token in the design system: Navy 900 is
 * otherwise the sidebar's alone, and the white tints below are the only alpha outside the scrim and shadows.
 */
const SHELL: Record<Tone, string> = { success: 'bg-sidebar', error: 'bg-danger' }
const DOT: Record<Tone, string> = { success: 'bg-success', error: 'bg-white' }
/** the exit fade, long enough to read as a dismissal and short enough never to delay the next one */
const LEAVE_MS = 70

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const { id, tone, durationMs } = toast
  // hover and focus pause rather than restart: the toast resumes with the time it had left
  const remaining = useRef(durationMs)

  const leave = useCallback(() => setLeaving(true), [])

  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => onDismiss(id), LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [leaving, id, onDismiss])

  useEffect(() => {
    if (paused || leaving || !Number.isFinite(durationMs) || durationMs <= 0) return
    const startedAt = Date.now()
    const timer = window.setTimeout(leave, remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt))
    }
  }, [id, durationMs, paused, leaving, leave])

  return (
    <div
      role={tone === 'success' ? 'status' : 'alert'}
      className={`pointer-events-auto flex h-11 max-w-[92vw] items-center gap-2.5 rounded-sm py-0 pr-1.5 pl-3.5 shadow-toast ${SHELL[tone]} ${leaving ? 'animate-popover-out' : 'animate-toast-in'}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />
      <p className="truncate text-sm font-semibold text-white">{toast.title}</p>
      {toast.detail && (
        <>
          <span aria-hidden className="h-4 w-px shrink-0 bg-white/[0.22]" />
          <p className="cep-num truncate text-helper text-white/[0.72]" title={toast.detail}>{toast.detail}</p>
        </>
      )}
      {toast.reference && (
        <span className="shrink-0 rounded-sm bg-white/[0.18] px-1.5 py-0.5 font-mono text-xs font-semibold text-white" aria-label={`Reference ${toast.reference}`}>{toast.reference}</span>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={leave}
        className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-white/[0.72] transition-colors duration-fast ease-standard hover:bg-white/[0.12] hover:text-white"
      >
        <X size={15} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  )
}
