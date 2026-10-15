/**
 * One tile: a saved report in one of its views, or one of its figures over the dashboard's period. The tile runs itself
 * through `load` (the API on a dashboard page, sample data on the playground) and shows the figure with its change, or
 * the rows in the view, or why it could not run. Editing controls come in through `controls`.
 */
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { ApiError } from '@/lib/api'
import { ReportResult } from '../components/ReportViews'
import { formatCell } from '../components/resultWords'
import type { DashboardTile, Period, TileResult } from '../types'
import { SHOW_LABEL } from './layout'

export type TileLoader = (tile: DashboardTile, period: Period, compare: boolean) => Promise<TileResult>

export function TileCard({ tile, period, compare, load, keyPrefix, controls, onTitle }: {
  tile: DashboardTile; period: Period; compare: boolean; load: TileLoader; keyPrefix: readonly unknown[]
  /** the editing controls at the right of the header */
  controls?: ReactNode
  /** when given, the title is an input (editing) */
  onTitle?: (title: string) => void
}) {
  const query = useQuery({
    queryKey: [...keyPrefix, tile.id, tile.report_id, tile.show, tile.measure ?? '', period, compare],
    queryFn: () => load(tile, period, compare).catch((error: unknown) => (error instanceof ApiError && error.status === 422 ? (error.problem as unknown as TileResult) : Promise.reject(error))),
    retry: false,
    placeholderData: (previous) => previous,
  })
  const data = query.data
  const name = tile.title || (data && 'report' in data ? data.report.name : '')
  return (
    <section aria-label={name || 'Tile'} className="flex min-w-0 flex-col rounded-md border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line-subtle px-3 py-2">
        {onTitle ? (
          <input aria-label="Tile title" value={tile.title ?? ''} placeholder={data && 'report' in data ? data.report.name : 'Title'} onChange={(event) => onTitle(event.target.value)} maxLength={100}
            className="h-7 min-w-0 flex-1 rounded-control-sm border border-transparent bg-transparent px-1.5 text-sm font-semibold text-ink-900 hover:border-line focus:border-focus focus:outline-none" />
        ) : <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{name || ' '}</h3>}
        <span className="text-xs whitespace-nowrap text-ink-700">{SHOW_LABEL[tile.show]}</span>
        {data && 'own_dates' in data && data.own_dates && <Tag tone="warning">Own dates</Tag>}
        {controls}
      </header>
      <div className={`min-w-0 flex-1 ${tile.show === 'figure' ? 'p-3' : 'p-2'}`}>
        {query.isPending ? <div className="flex min-h-24 items-center justify-center"><Spinner label="Running the tile" /></div>
          : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} />
          : <TileBody data={data as TileResult} tile={tile} />}
      </div>
    </section>
  )
}

function TileBody({ data, tile }: { data: TileResult; tile: DashboardTile }) {
  if (data.kind === 'missing' || data.kind === 'refused') {
    return <p className="flex min-h-24 items-center justify-center text-center text-sm text-ink-800">{data.detail}</p>
  }
  if (data.kind === 'figure') {
    const value = data.value === null ? '—' : formatCell(data.column, data.value)
    const change = data.compared && data.previous !== null && data.value !== null && Number(data.previous) !== 0 ? (Number(data.value) - Number(data.previous)) / Math.abs(Number(data.previous)) : null
    return (
      <div className="flex flex-col gap-0.5">
        <span className="cep-num font-display text-[26px] leading-tight font-semibold text-ink-900">{value}</span>
        {data.compared && (
          <span className="cep-num text-xs font-semibold text-ink-800">
            {change === null ? 'No previous period to compare' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change * 100).toFixed(1)}% vs previous`}
          </span>
        )}
        <span className="text-xs text-ink-700">{data.report.name} · {data.column.label}</span>
      </div>
    )
  }
  return <ReportResult result={data.result} view={{ ...data.view, type: tile.show === 'figure' ? 'grid' : tile.show }} label={`${tile.title || data.report.name} rows`} minHeight={200} />
}
