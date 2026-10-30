/**
 * What every Insights list page shares (docs/mockups/insights-admin-pages.html), as on Reports: the filters kept in the
 * address so a link opens the same view, and the table's Title Case header row and card. The count beside the title is CountBadge.
 */
import { useSearchParams } from 'react-router-dom'

/** the table's header row: a light grey row of Title Case labels */
export const listHeadClass = 'border-b border-line bg-surface-subtle text-left text-label font-medium text-ink-900'
/** a table row under it */
export const listRowClass = 'border-t border-line-subtle first:border-t-0'
/** the card a table sits in */
export const listCardClass = 'overflow-x-auto rounded-lg border border-line bg-surface'

/** a page's filters in the address: read one, set some (an empty value removes it), clear them all, and whether any is set */
export function useListParams<K extends string>(keys: readonly K[], defaults: Partial<Record<K, string>> = {}) {
  const [params, setParams] = useSearchParams()
  const get = (key: K): string => params.get(key) ?? defaults[key] ?? ''
  const set = (next: Partial<Record<K, string>>) => setParams((current) => {
    const merged = new URLSearchParams(current)
    Object.entries(next).forEach(([key, value]) => (value && value !== defaults[key as K] ? merged.set(key, value as string) : merged.delete(key)))
    return merged
  }, { replace: true })
  const clear = () => set(Object.fromEntries(keys.map((key) => [key, ''])) as Partial<Record<K, string>>)
  const filtering = keys.some((key) => params.has(key))
  return { get, set, clear, filtering }
}
