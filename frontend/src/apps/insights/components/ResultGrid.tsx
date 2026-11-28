/**
 * A run's rows in AG Grid Community, styled with the design tokens: hairlines, the type scale, no stripes. The viewer and
 * both editors share it. A column masked for this reader is named above the grid and its cells are muted. More than 20 rows
 * are paged under the grid (docs/mockups/grid-paging-and-speed.html, option A): 20, 50 or 100 a page, remembered per browser;
 * the rows already fetched are paged, so a page turns without running the report again, and a sort sorts every row.
 * A grid whose view totals some columns pins a bold Total row under the rows: the engine's grand total over every row of the
 * report, not only the ones fetched, so it stays put through paging and sorting.
 * `tick` gives every line a checkbox and reports the ticked lines' values of one column (a dashboard tile opens another report
 * with them). `links` puts an arrow after a column's values that leads to the thing named (a campaign in Engagement); a click
 * elsewhere in the cell still picks the value.
 */
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GridApi } from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { ArrowUpRight, Lock } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import type { ColumnFormat, ResultColumn, RunResult } from '../types'
import { fillOf, formatOf, rangeOf, toneClass } from './formats'
import { PAGE_SIZES, rememberedSize } from './paging'
import { formatCell, maskedWords } from './resultWords'

ModuleRegistry.registerModules([AllCommunityModule])

const SIZE_KEY = 'insights.grid.rows'

const theme = themeQuartz.withParams({
  accentColor: 'var(--color-brand-600)',
  backgroundColor: 'var(--color-surface)',
  foregroundColor: 'var(--color-ink-900)',
  headerBackgroundColor: 'var(--color-surface-subtle)',
  headerTextColor: 'var(--color-ink-800)',
  borderColor: 'var(--color-line-subtle)',
  wrapperBorder: false,
  rowBorder: { color: 'var(--color-line-subtle)' },
  rowHoverColor: 'var(--color-surface-hover)',
  selectedRowBackgroundColor: 'var(--color-brand-100)',
  fontFamily: 'inherit',
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 600,
  rowHeight: 32,
  headerHeight: 32,
  wrapperBorderRadius: 0,
  cellHorizontalPadding: 12,
})

const TOTAL = 'Total'

/** the Total row as grid cells: the grand total under each totalled column, "Total" in the first column that isn't one */
export function gridTotalRow(result: RunResult, totals?: string[]): Record<string, unknown> | null {
  const wanted = new Set(totals ?? [])
  const whole = result.totals?.find((entry) => Object.keys(entry.keys).length === 0)
  if (!wanted.size || !whole) return null
  const row: Record<string, unknown> = {}
  let measure = 0
  result.columns.forEach((column, index) => {
    if (!column.aggregate) return
    if (wanted.has(column.key) && !column.masked) row[`c${index}`] = whole.values[measure] ?? null
    measure += 1
  })
  const label = result.columns.findIndex((column) => !wanted.has(column.key))
  if (label >= 0) row[`c${label}`] = TOTAL
  return row
}

/** the lines ticked: the column whose values are reported, and where they go */
export interface GridTick { column: string; onChange: (values: unknown[]) => void }
/** by column key: where a value of that column leads, and the words for it; null for a value with nowhere to go */
export type GridLinks = Record<string, (value: unknown) => { to: string; label: string } | null>

const ROW_ID = '__row'

function LinkedCell({ words, target }: { words: string; target: { to: string; label: string } | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="min-w-0 truncate" title={words}>{words}</span>
      {target && (
        <Link to={target.to} aria-label={target.label} title={target.label}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-control-sm text-ink-800 transition-colors hover:bg-fill-subtle hover:text-brand-800">
          <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden />
        </Link>
      )}
    </span>
  )
}

export function ResultGrid({ result, label = 'Report rows', minHeight = 360, onPick, formats, totals, onContext, tick, links }: { result: RunResult; label?: string; minHeight?: number; onPick?: (column: ResultColumn, value: unknown) => void; formats?: ColumnFormat[]; totals?: string[]; onContext?: (column: ResultColumn, value: unknown, at: { x: number; y: number }) => void; tick?: GridTick; links?: GridLinks }) {
  const roomy = Boolean(links || tick)                                   // a name with an arrow needs room: the other columns give a little
  const columnDefs = useMemo<ColDef[]>(() => result.columns.map((column, index) => {
    const rule = column.masked ? undefined : formatOf(formats, column.key)
    const link = column.masked || column.aggregate ? undefined : links?.[column.key]
    const range = rule ? rangeOf(result.rows.map((row) => row[index])) : null
    const base = column.masked ? 'text-ink-700' : onPick && !column.aggregate ? 'cursor-pointer' : ''
    return {
    headerName: column.masked ? `${column.label} (masked)` : column.label,
    field: `c${index}`,
    type: column.type === 'number' && !column.masked ? 'numericColumn' : undefined,
    cellClass: rule ? (p: { value: unknown }) => [base, toneClass(rule, p.value)].filter(Boolean).join(' ') || undefined : base || undefined,
    cellStyle: rule && rule.style !== 'rules' ? (p: { value: unknown }) => (fillOf(rule, p.value, range) ?? null) as never : undefined,
    valueFormatter: (p) => (p.node?.rowPinned ? (p.value === TOTAL ? TOTAL : p.value == null ? '' : formatCell(column, p.value)) : formatCell(column, p.value)),
    cellRenderer: link ? (p: { value: unknown; valueFormatted?: string | null; node?: { rowPinned?: string | null } }) => <LinkedCell words={p.valueFormatted ?? String(p.value ?? '')} target={p.node?.rowPinned || p.value == null ? null : link(p.value)} /> : undefined,
    sortable: true,
    resizable: true,
    minWidth: link ? 160 : roomy ? 100 : 120,
    flex: link ? 1.5 : 1,
  } }), [result.columns, result.rows, onPick, formats, links, roomy])
  const tickAt = tick ? result.columns.findIndex((column) => column.key === tick.column && !column.aggregate && !column.masked) : -1
  const rowData = useMemo(() => {
    const values = tickAt >= 0 ? result.rows.map((row) => String(row[tickAt])) : []
    const unique = new Set(values).size === values.length                                   // a line keeps its tick through a refresh when its value names it alone
    return result.rows.map((row, at) => ({ ...Object.fromEntries(row.map((value, index) => [`c${index}`, value])), ...(tickAt >= 0 ? { [ROW_ID]: unique ? `v:${values[at]}` : `${at}:${values[at]}` } : {}) }))
  }, [result.rows, tickAt])
  const pinned = useMemo(() => { const row = gridTotalRow(result, totals); return row ? [row] : undefined }, [result, totals])
  const masked = maskedWords(result)
  const grid = useRef<GridApi | null>(null)
  const [size, setSize] = useState(() => rememberedSize(SIZE_KEY))
  const [page, setPage] = useState(0)
  const paged = result.rows.length > PAGE_SIZES[0]
  const pages = Math.max(1, Math.ceil(result.rows.length / size))
  const go = (next: number) => grid.current?.paginationGoToPage(Math.min(Math.max(0, next), pages - 1))
  const resize = (next: number) => {
    setSize(next)
    try { window.localStorage.setItem(SIZE_KEY, String(next)) } catch { /* the default next visit */ }
  }
  return (
    <div className="flex flex-col gap-2">
      {masked && (
        <p role="note" className="flex items-center gap-1.5 text-xs text-ink-800">
          <Lock size={12} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-700" />{masked}
        </p>
      )}
      <div className="overflow-hidden rounded-md border border-line" style={{ minHeight }} role="region" aria-label={label}>
        <AgGridReact theme={theme} columnDefs={columnDefs} rowData={rowData} pinnedBottomRowData={pinned} getRowClass={(p) => (p.node.rowPinned ? 'font-semibold' : undefined)}
          domLayout="autoHeight" suppressCellFocus animateRows={false} overlayNoRowsTemplate="<span>No rows match this report.</span>"
          pagination={paged} paginationPageSize={size} suppressPaginationPanel suppressRowVirtualisation={paged} onGridReady={(event) => { grid.current = event.api }}
          onPaginationChanged={(event) => setPage(event.api.paginationGetCurrentPage())} onRowDataUpdated={(event) => event.api.paginationGoToFirstPage()}
          rowSelection={tickAt >= 0 ? { mode: 'multiRow', checkboxes: true, headerCheckbox: false, enableClickSelection: false, isRowSelectable: (node) => node.data?.[`c${tickAt}`] != null } : undefined}
          selectionColumnDef={tickAt >= 0 ? { width: 44, minWidth: 44, maxWidth: 44, pinned: 'left', resizable: false, sortable: false, suppressHeaderMenuButton: true } : undefined}
          getRowId={tickAt >= 0 ? (p) => String(p.data[ROW_ID]) : undefined}
          onSelectionChanged={tickAt >= 0 && tick ? (event) => tick.onChange([...new Set(event.api.getSelectedRows().map((row: Record<string, unknown>) => row[`c${tickAt}`]))]) : undefined}
          onCellClicked={onPick ? (event) => {
            if (event.node.rowPinned || (event.event?.target as HTMLElement | null)?.closest?.('a')) return             // the arrow leads away; it does not pick
            const column = result.columns[Number(String(event.colDef.field).slice(1))]
            if (column && !column.aggregate && !column.masked) onPick(column, event.value)
          } : undefined}
          preventDefaultOnContextMenu={Boolean(onContext)}
          onCellContextMenu={onContext ? (event) => {
            if (event.node.rowPinned) return
            const column = result.columns[Number(String(event.colDef.field).slice(1))]
            const mouse = event.event as MouseEvent | null | undefined
            if (column && mouse) onContext(column, event.value, { x: mouse.clientX, y: mouse.clientY })
          } : undefined} />
        {paged && <Pager page={Math.min(page, pages - 1)} pages={pages} size={size} rows={result.rows.length} onPage={go} onSize={resize} />}
      </div>
    </div>
  )
}

/** the pages to number: the first, the last and the ones beside the current, with a gap shown between */
function pageNumbers(page: number, pages: number): (number | null)[] {
  const wanted = [...new Set([0, pages - 1, page - 1, page, page + 1])].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b)
  return wanted.flatMap((n, i) => (i > 0 && n - wanted[i - 1] > 1 ? [null, n] : [n]))
}

/** the rows shown, rows per page, Previous, the page numbers and Next */
export function Pager({ page, pages, size, rows, onPage, onSize }: { page: number; pages: number; size: number; rows: number; onPage: (page: number) => void; onSize: (size: number) => void }) {
  const first = page * size + 1
  const last = Math.min(rows, (page + 1) * size)
  const shape = 'inline-flex h-7 min-w-7 items-center justify-center rounded-control-md border px-2 text-xs'
  const step = `${shape} border-line bg-surface text-ink-900 hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-surface`
  const current = `${shape} border-brand-600 bg-brand-600 font-semibold text-on-brand`
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-2 border-t border-line-subtle px-3 py-2 text-xs text-ink-800">
      <span className="cep-num" aria-live="polite">Rows {first.toLocaleString()}–{last.toLocaleString()} of {rows.toLocaleString()}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <span aria-hidden>Rows per page</span>
        <select aria-label="Rows per page" value={size} onChange={(event) => onSize(Number(event.target.value))}
          className="h-7 rounded-control-md border border-line-control bg-surface px-1.5 text-xs text-ink-900">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <button type="button" className={step} onClick={() => onPage(page - 1)} disabled={page === 0}>‹ Previous</button>
        {pageNumbers(page, pages).map((n, i) => n === null
          ? <span key={`gap-${i}`} aria-hidden className="px-0.5 text-ink-700">…</span>
          : <button key={n} type="button" aria-label={`Page ${n + 1}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}
              className={n === page ? current : step}>{n + 1}</button>)}
        <button type="button" className={step} onClick={() => onPage(page + 1)} disabled={page >= pages - 1}>Next ›</button>
      </span>
    </nav>
  )
}
