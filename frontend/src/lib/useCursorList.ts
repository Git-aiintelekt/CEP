import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, cursorOf } from './api'

type Filters = Record<string, string | number | boolean | null | undefined>

/** One page of a cursor-paginated API list, with next / previous navigation. Changing the filters returns to page one. */
export function useCursorList<T>(resource: string, filters: Filters = {}) {
  const filterKey = JSON.stringify(filters)
  // The cursor is only valid for the filters it was issued under: a different filter set reads as "first page".
  const [position, setPosition] = useState<{ filterKey: string; cursor: string | null }>({ filterKey, cursor: null })
  const cursor = position.filterKey === filterKey ? position.cursor : null
  const setCursor = (value: string) => setPosition({ filterKey, cursor: value })

  const query = useQuery({
    queryKey: [resource, filterKey, cursor],
    queryFn: ({ signal }) => api.list<T>(`/${resource}/`, { ...filters, cursor }, signal),
    placeholderData: keepPreviousData,
  })

  const next = cursorOf(query.data?.next ?? null)
  const previous = cursorOf(query.data?.previous ?? null)

  return {
    ...query,
    rows: query.data?.results ?? [],
    hasNext: next !== null,
    hasPrevious: previous !== null,
    goNext: () => next && setCursor(next),
    goPrevious: () => previous && setCursor(previous),
  }
}
