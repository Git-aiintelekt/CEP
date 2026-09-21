import type { ReactNode } from 'react'

import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  caption: string
}

/** Below 768px a table row becomes a card of label / value pairs, so nothing needs sideways scrolling. */
function StackedCards<T>({ columns, rows, rowKey, onRowClick, caption }: DataTableProps<T>) {
  return (
    <ul aria-label={caption} className="space-y-3">
      {rows.map((row) => (
        <li
          key={rowKey(row)}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={onRowClick ? (event) => event.key === 'Enter' && onRowClick(row) : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          className={`rounded-lg border border-line bg-surface p-4 ${onRowClick ? 'cursor-pointer transition-colors hover:bg-surface-subtle' : ''}`}
        >
          <dl className="divide-y divide-line-subtle">
            {columns.map((column) => (
              <div key={column.key} className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
                <dt className="shrink-0 text-xs font-semibold text-ink-700">{column.header}</dt>
                <dd className={`min-w-0 text-right text-sm text-ink-900 ${column.align === 'right' ? 'cep-num' : ''}`}>{column.render(row)}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  )
}

export function DataTable<T>(props: DataTableProps<T>) {
  const isMd = useMinWidth(BREAKPOINT.md)
  return isMd ? <Table {...props} /> : <StackedCards {...props} />
}

function Table<T>({ columns, rows, rowKey, onRowClick, caption }: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="min-w-full divide-y divide-line text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-subtle">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`h-10 px-4 text-xs font-semibold text-ink-700 ${column.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter') onRowClick(row)
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              className={onRowClick ? 'h-10 cursor-pointer transition-colors hover:bg-surface-subtle xl:h-12' : 'h-10 xl:h-12'}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 align-middle text-ink-700 ${column.align === 'right' ? 'cep-num text-right' : ''} ${column.className ?? ''}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
