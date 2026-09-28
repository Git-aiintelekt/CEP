import { useEffect, useState } from 'react'

/** `value` once it has stopped changing for `delay` ms: a search box asks the server once per pause, not once per key. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}
