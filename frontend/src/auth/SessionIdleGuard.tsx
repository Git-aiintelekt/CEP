/**
 * Signs the person out after they leave the browser idle for a while, with a warning first.
 *
 * `security.idle_timeout_minutes` (global parameter, default 120) of no activity anywhere in the tab shows a warning;
 * `security.idle_warning_seconds` (default 60) after that, with no response, the session ends. Both come from GET /me/,
 * so a change on the back office takes effect the next time someone loads the app, no deployment needed.
 *
 * Activity is shared across tabs of the same browser (a shared localStorage timestamp), so working in one tab keeps
 * every tab of the workspace alive; while the warning is up, only the buttons in it count as "still here" — the
 * pointer merely resting over the page must not silently cancel a sign-out the person never saw.
 */
import { useEffect, useRef, useState } from 'react'

import { useAuth } from './AuthContext'
import { IdleWarningModal } from './IdleWarningModal'

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
const ACTIVITY_KEY = 'cep.lastActivity'
/** read once by the login page, then cleared, so a refresh there does not keep repeating the notice */
export const SIGNED_OUT_REASON_KEY = 'cep.signedOutReason'
const CHECK_MS = 1_000
/** activity is written to storage at most this often: frequent events (scroll, wheel) must not thrash localStorage */
const WRITE_THROTTLE_MS = 5_000

function now() {
  return Date.now()
}

export function SessionIdleGuard() {
  const { status, me, logout } = useAuth()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  const lastActivity = useRef(now())
  const lastWrite = useRef(0)
  const warnedAt = useRef<number | null>(null)
  const warningRef = useRef(false) // mirrors secondsLeft !== null, readable inside the event handler without a re-subscribe

  const timeoutMinutes = me?.session?.idle_timeout_minutes ?? 120
  const warningSeconds = me?.session?.idle_warning_seconds ?? 60
  const authenticated = status === 'authenticated'

  function stayIn() {
    const at = now()
    lastActivity.current = at
    lastWrite.current = at
    warnedAt.current = null
    warningRef.current = false
    setSecondsLeft(null)
    try {
      window.localStorage.setItem(ACTIVITY_KEY, String(at))
    } catch {
      /* private mode / blocked storage: this tab still works, it just cannot share activity with others */
    }
  }

  function signOut() {
    // RequireAuth already sends an anonymous session to /login from wherever it is (the same path the existing
    // 401-triggered logout takes); a manual navigate() here would race that redirect rather than add to it.
    try {
      window.sessionStorage.setItem(SIGNED_OUT_REASON_KEY, 'idle')
    } catch {
      /* private mode / blocked storage: the sign-out itself still happens, just without the login page's explanation */
    }
    logout()
  }

  // Reset whenever a fresh sign-in happens, so a session that started just now is never judged idle from a moment before it existed.
  useEffect(() => {
    if (authenticated) stayIn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated])

  useEffect(() => {
    if (!authenticated) return

    function onActivity() {
      if (warningRef.current) return // the warning is up: only its own buttons count from here, not a passing mouse move
      const at = now()
      lastActivity.current = at
      if (at - lastWrite.current >= WRITE_THROTTLE_MS) {
        lastWrite.current = at
        try {
          window.localStorage.setItem(ACTIVITY_KEY, String(at))
        } catch {
          /* ignore */
        }
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== ACTIVITY_KEY || !event.newValue) return
      const at = Number(event.newValue)
      if (!Number.isFinite(at) || at <= lastActivity.current) return
      lastActivity.current = at
      if (warningRef.current) stayIn() // proven active in another tab while this one was about to sign out: stand down
    }

    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { passive: true })
    window.addEventListener('storage', onStorage)
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity)
      window.removeEventListener('storage', onStorage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated])

  useEffect(() => {
    if (!authenticated) return
    const timeoutMs = Math.max(1, timeoutMinutes) * 60_000
    const id = window.setInterval(() => {
      const at = now()
      if (warnedAt.current === null) {
        if (at - lastActivity.current >= timeoutMs) {
          warnedAt.current = at
          warningRef.current = true
          setSecondsLeft(warningSeconds)
        }
        return
      }
      const left = Math.max(0, warningSeconds - Math.floor((at - warnedAt.current) / 1000))
      setSecondsLeft(left)
      if (left <= 0) signOut()
    }, CHECK_MS)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, timeoutMinutes, warningSeconds])

  if (!authenticated || secondsLeft === null) return null
  return <IdleWarningModal secondsLeft={secondsLeft} totalSeconds={warningSeconds} onStay={stayIn} onSignOut={signOut} />
}
