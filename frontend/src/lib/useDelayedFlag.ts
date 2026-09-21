import { useEffect, useRef, useState } from 'react'

/**
 * How long the sign-in animation stays once it has appeared. The API usually answers in well under 100ms, so this is
 * what decides how long the animation is seen, not the request. Held at 5s so a full sweep of the converging dots
 * plays out; the design's own prototype runs it for 4.6s on sign-in. Tests set VITE_LOADING_HOLD_MS=0 so the suite
 * does not sit through it — the real timing is checked in a browser instead.
 */
export const LOADING_HOLD_MS = Number(import.meta.env.VITE_LOADING_HOLD_MS ?? 5000)

/**
 * Follows `active`, but never for less than LOADING_HOLD_MS once it has turned on. It appears immediately: delaying the start
 * meant a fast reply finished first and the state never showed at all.
 */
export function useDelayedFlag(active: boolean): boolean {
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)

  // React's supported "adjust state during render" pattern: up in the same paint the request starts
  if (active && !shown) setShown(true)

  useEffect(() => {
    if (shown && shownAt.current === 0) shownAt.current = Date.now()
  }, [shown])

  useEffect(() => {
    if (active || !shown) return
    const remaining = Math.max(0, LOADING_HOLD_MS - (Date.now() - shownAt.current))
    const timer = window.setTimeout(() => {
      shownAt.current = 0
      setShown(false)
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [active, shown])

  return shown
}
