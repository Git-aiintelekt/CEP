import { useState, type ReactNode } from 'react'

import { useCursorList } from '@/lib/useCursorList'

import { DataTable, type Column } from './DataTable'
import { EmptyState, ErrorState, Spinner } from './States'

export function PageHeader({ title, description, actions, help }: { title: string; description?: ReactNode; actions?: ReactNode; /** the page's help icon (PageHelp) */ help?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        {help ? <span className="flex items-center gap-1.5"><h1 className="font-display text-page-title font-semibold text-ink-900">{title}</h1>{help}</span> : <h1 className="font-display text-page-title font-semibold text-ink-900">{title}</h1>}
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-800">{description}</p>}
      </div>
      {actions}
    </div>
  )
}

interface FilterDef {
  param: string
  label: string
  options: { value: string; label: string }[]
}

interface ResourceListProps<T extends { id: string }> {
  title: string
  description: string
  /** API collection name, e.g. "campaigns" */
  resource: string
  columns: Column<T>[]
  filters?: FilterDef[]
  searchable?: boolean
  onRowClick?: (row: T) => void
  emptyHint: string
  /** header actions, e.g. a "New" button */
  actions?: ReactNode
}

/** Title + filters + table + cursor paging for any tenant-scoped API collection. */
export function ResourceList<T extends { id: string }>(props: ResourceListProps<T>) {
  const { title, description, resource, columns, filters = [], searchable = true, onRowClick, emptyHint, actions } = props
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Record<string, string>>({})

  const list = useCursorList<T>(resource, { ...selected, search: searchable ? search.trim() : undefined })
  const filtered = search.trim() !== '' || Object.values(selected).some(Boolean)

  return (
    <section>
      <PageHeader title={title} description={description} actions={actions} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {searchable && (
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${title.toLowerCase()}`}
            aria-label={`Search ${title.toLowerCase()}`}
            className="h-10 w-full rounded-control-lg border border-line bg-surface px-3 text-sm sm:w-64"
          />
        )}
        {filters.map((filter) => (
          <label key={filter.param} className="flex items-center gap-2 text-sm text-ink-800">
            {filter.label}
            <select
              value={selected[filter.param] ?? ''}
              onChange={(event) => setSelected((current) => ({ ...current, [filter.param]: event.target.value }))}
              className="h-10 rounded-control-lg border border-line-control bg-surface px-3 text-sm text-ink-900"
            >
              <option value="">All</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {list.isFetching && <Spinner className="h-4 w-4" />}
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-5 py-10 text-sm text-ink-800">
          <Spinner /> Loading {title.toLowerCase()}
        </div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={filtered ? 'Nothing matches these filters' : `No ${title.toLowerCase()} yet`} hint={filtered ? undefined : emptyHint} />
      ) : (
        <>
          <DataTable columns={columns} rows={list.rows} rowKey={(row) => row.id} onRowClick={onRowClick} caption={title} />
          {(list.hasNext || list.hasPrevious) && (
            <div className="mt-3 flex justify-end gap-2">
              <PagerButton disabled={!list.hasPrevious} onClick={list.goPrevious}>
                Previous
              </PagerButton>
              <PagerButton disabled={!list.hasNext} onClick={list.goNext}>
                Next
              </PagerButton>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function PagerButton({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 rounded-control-md border border-line bg-surface px-3 text-sm font-medium text-ink-800 transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:bg-fill-subtle disabled:text-ink-300"
    >
      {children}
    </button>
  )
}
