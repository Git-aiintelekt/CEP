/** The last few tags the reader chose, newest first, for the top of the picker. Lasts the session, not longer. */
import { useCallback, useState } from 'react'

export const RECENT_LIMIT = 5

export function rememberTag(recent: readonly string[], key: string): string[] {
  return [key, ...recent.filter((item) => item !== key)].slice(0, RECENT_LIMIT)
}

export function useRecentTags(): [string[], (key: string) => void] {
  const [recent, setRecent] = useState<string[]>([])
  const remember = useCallback((key: string) => setRecent((was) => rememberTag(was, key)), [])
  return [recent, remember]
}
