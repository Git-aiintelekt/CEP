/** The suite's search, in the top bar: campaigns, contact lists and templates by name, and the pages the person can already see. */
import { useQuery } from '@tanstack/react-query'
import { Search, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent, type RefObject } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import type { NavItem } from '@/components/navItems'
import { api } from '@/lib/api'
import type { SearchResults } from '@/lib/types'

export function GlobalSearch({ pages, inputRef }: { pages: NavItem[]; inputRef: RefObject<HTMLInputElement | null> }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  const open = openedOn === location.pathname
  const setOpen = (value: boolean) => setOpenedOn(value ? location.pathname : null)
  const term = query.trim().toLowerCase()
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term), 220)
    return () => window.clearTimeout(timer)
  }, [term])
  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => api.get<SearchResults>('/search/', { q: debounced }, signal),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  })
  const pageMatches = term ? pages.filter((page) => page.label.toLowerCase().includes(term)) : []
  const found = results.data && results.data.q === debounced ? results.data : null
  const rows: { key: string; kind: string; label: string; meta?: string; to: string; icon?: LucideIcon }[] = [
    ...(found?.campaigns ?? []).map((item) => ({ key: `c-${item.id}`, kind: 'Campaign', label: item.name, meta: `${item.status_label}${item.code ? ` · ${item.code}` : ''}`, to: item.setup_complete ? `/campaigns/${item.id}` : `/campaigns/${item.id}/edit` })),
    ...(found?.lists ?? []).map((item) => ({ key: `l-${item.id}`, kind: 'Contact list', label: item.name, meta: `${item.member_count.toLocaleString()} contacts`, to: `/contact-lists/${item.id}` })),
    ...(found?.templates ?? []).map((item) => ({ key: `t-${item.id}`, kind: 'Template', label: item.name, meta: item.channel, to: `/templates/${item.id}` })),
    ...pageMatches.map((page) => ({ key: `p-${page.to}`, kind: 'Page', label: page.label, to: page.to, icon: page.icon })),
  ]
  const searching = open && term.length >= 2 && (results.isPending || debounced !== term)

  function go(to: string) {
    setQuery('')
    setOpen(false)
    navigate(to)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (rows[0]) go(rows[0].to)
  }

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className="group relative w-full max-w-lg"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sidebar-icon group-focus-within:text-ink-800" />
      <input
        ref={inputRef}
        type="search"
        aria-label="Search"
        placeholder="Search campaigns, contacts, templates or journeys"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); (event.target as HTMLInputElement).blur() }
        }}
        className="h-8 w-full rounded-control-md border border-transparent bg-sidebar-hover pr-3 pl-8 text-sm text-on-brand transition-colors placeholder:text-sidebar-icon focus:bg-surface focus:text-ink-900 focus:placeholder:text-ink-700 focus-visible:border-focus"
      />
      {open && term && (
        <ul aria-label="Search results" className="absolute top-full right-0 left-0 z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-line bg-surface-overlay py-1 shadow-menu">
          {rows.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-800">{searching ? 'Searching' : term.length < 2 ? 'Type two characters or more.' : 'Nothing matches. Try a campaign, list or template name, or a page such as Settings.'}</li>
          ) : (
            rows.map((row) => (
              <li key={row.key}>
                <button type="button" onClick={() => go(row.to)} className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-ink-900 transition-colors hover:bg-surface-hover">
                  {row.icon ? <row.icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-800" /> : <span className="w-16 shrink-0 text-xs text-ink-800">{row.kind}</span>}
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.meta && <span className="shrink-0 truncate text-xs text-ink-800">{row.meta}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </form>
  )
}
