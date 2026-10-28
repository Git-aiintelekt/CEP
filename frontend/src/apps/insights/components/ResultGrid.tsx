/**
 * A run's rows in AG Grid Community, styled with the design tokens: hairlines, the type scale, no stripes. The viewer and
 * both editors share it. A column masked for this reader is named above the grid and its cells are muted. More than 20 rows
 * are paged under the grid (docs/mockups/grid-paging-and-speed.html, option A): 20, 50 or 100 a page, remembered per browser;
 * the rows already fetched are paged, so a page turns without running the report again, and a sort sorts every row.
 */
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GridApi } from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { Lock } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

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

export function ResultGrid({ result, label = 'Report rows', minHeight = 360, onPick, formats, onContext }: { result: RunResult; label?: string; minHeight?: number; onPick?: (column: ResultColumn, value: unknown) => void; formats?: ColumnFormat[]; onContext?: (column: ResultColumn, value: unknown, at: { x: number; y: number }) => void }) {
  const columnDefs = useMemo<ColDef[]>(() => result.columns.map((column, index) => {
    const rule = column.masked ? undefined : formatOf(formats, column.key)
    const range = rule ? rangeOf(result.rows.map((row) => row[index])) : null
    const base = column.masked ? 'text-ink-700' : onPick && !column.aggregate ? 'cursor-pointer' : ''
    return {
    headerName: column.masked ? `${column.label} (masked)` : column.label,
    field: `c${index}`,
    type: column.type === 'number' && !column.masked ? 'numericColumn' : undefined,
    cellClass: rule ? (p: { value: unknown }) => [base, toneClass(rule, p.value)].filter(Boolean).join(' ') || undefined : base || undefined,
    cellStyle: rule && rule.style !== 'rules' ? (p: { value: unknown }) => (fillOf(rule, p.value, range) ?? null) as never : undefined,
    valueFormatter: (p) => formatCell(column, p.value),
    sortable: true,
    resizable: true,
    minWidth: 120,
    flex: 1,
  } }), [result.columns, result.rows, onPick, formats])
  const rowData = useMemo(() => result.rows.map((row) => Object.fromEntries(row.map((value, index) => [`c${index}`, value]))), [result.rows])
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
        <AgGridReact theme={theme} columnDefs={columnDefs} rowData={rowData} domLayout="autoHeight" suppressCellFocus animateRows={false} overlayNoRowsTemplate="<span>No rows match this report.</span>"
          pagination={paged} paginationPageSize={size} suppressPaginationPanel suppressRowVirtualisation={paged} onGridReady={(event) => { grid.current = event.api }}
          onPaginationChanged={(event) => setPage(event.api.paginationGetCurrentPage())} onRowDataUpdated={(event) => event.api.paginationGoToFirstPage()}
          onCellClicked={onPick ? (event) => { const column = result.columns[Number(String(event.colDef.field).slice(1))]; if (column && !column.aggregate && !column.masked) onPick(column, event.value) } : undefined}
          preventDefaultOnContextMenu={Boolean(onContext)}
          onCellContextMenu={onContext ? (event) => {
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
