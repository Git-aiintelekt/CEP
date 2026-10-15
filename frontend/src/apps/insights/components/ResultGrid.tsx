/**
 * A run's rows in AG Grid Community, styled with the design tokens: hairlines, the type scale, no stripes. The viewer and
 * both editors share it. A column masked for this reader is named above the grid and its cells are muted.
 */
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { Lock } from 'lucide-react'
import { useMemo } from 'react'

import type { RunResult } from '../types'
import { formatCell, maskedWords } from './resultWords'

ModuleRegistry.registerModules([AllCommunityModule])

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
  rowHeight: 36,
  headerHeight: 36,
  wrapperBorderRadius: 0,
  cellHorizontalPadding: 12,
})

export function ResultGrid({ result, label = 'Report rows', minHeight = 360 }: { result: RunResult; label?: string; minHeight?: number }) {
  const columnDefs = useMemo<ColDef[]>(() => result.columns.map((column, index) => ({
    headerName: column.masked ? `${column.label} (masked)` : column.label,
    field: `c${index}`,
    type: column.type === 'number' && !column.masked ? 'numericColumn' : undefined,
    cellClass: column.masked ? 'text-ink-700' : undefined,
    valueFormatter: (p) => formatCell(column, p.value),
    sortable: true,
    resizable: true,
    minWidth: 120,
    flex: 1,
  })), [result.columns])
  const rowData = useMemo(() => result.rows.map((row) => Object.fromEntries(row.map((value, index) => [`c${index}`, value]))), [result.rows])
  const masked = maskedWords(result)
  return (
    <div className="flex flex-col gap-2">
      {masked && (
        <p role="note" className="flex items-center gap-1.5 text-xs text-ink-800">
          <Lock size={12} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-700" />{masked}
        </p>
      )}
      <div className="overflow-hidden rounded-md border border-line" style={{ minHeight }} role="region" aria-label={label}>
        <AgGridReact theme={theme} columnDefs={columnDefs} rowData={rowData} domLayout="autoHeight" suppressCellFocus animateRows={false} overlayNoRowsTemplate="<span>No rows match this report.</span>" />
      </div>
    </div>
  )
}
