import { ChevronRight } from 'lucide-react'
import { Fragment, useId, useState, type ReactNode } from 'react'

import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
  className?: string
  /** with phone="table": hidden on phones until "Show All Columns" */
  phoneOptional?: boolean
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  caption: string
  /** false inside a card, which already draws the border */
  framed?: boolean
  /** 'card': the outer cells take a card's 24px padding, so the table lines up with the card's title */
  inset?: 'default' | 'card'
  /** below 768px this column's cell leads its card as a left-aligned title, without a label; the others stay label / value rows */
  primary?: string
  /** rows that open in place: a chevron button leads the row, and what `render` returns spans the row beneath it */
  expand?: RowExpansion<T>
  /** below 768px: 'cards' (default) stacks each row as a card; 'table' keeps a compact table, for numeric grids */
  phone?: 'cards' | 'table'
  /** extra classes for one row: a tint for a row that needs attention */
  rowClassName?: (row: T) => string
}

export interface RowExpansion<T> {
  render: (row: T) => ReactNode
  /** rows that can't open get no button */
  canExpand?: (row: T) => boolean
  /** the button's name: "Results of run #3" */
  label: (row: T) => string
  /** the keys of the rows that start open */
  initiallyOpen?: string[]
}

function useOpenRows(initial: string[] = []) {
  const [open, setOpen] = useState(() => new Set(initial))
  const toggle = (key: string) => setOpen((now) => {
    const next = new Set(now)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  return [open, toggle] as const
}

function ExpandButton({ open, label, controls, onToggle, children }: { open: boolean; label?: string; controls: string; onToggle: () => void; children?: ReactNode }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} aria-label={label} onClick={(event) => { event.stopPropagation(); onToggle() }}
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-control-sm text-ink-800 transition-colors duration-fast ease-standard hover:bg-fill-subtle">
      <ChevronRight size={16} strokeWidth={1.5} aria-hidden className={`transition-transform duration-base ease-standard motion-reduce:transition-none ${open ? 'rotate-90' : ''} ${children ? '' : 'mx-1'}`} />
      {children}
    </button>
  )
}

/** Below 768px a table row becomes a card of label / value pairs, so nothing needs sideways scrolling. */
function StackedCards<T>({ columns, rows, rowKey, onRowClick, caption, primary, expand, rowClassName }: DataTableProps<T>) {
  const [open, toggle] = useOpenRows(expand?.initiallyOpen)
  const baseId = useId()
  const lead = columns.find((column) => column.key === primary)
  const rest = lead ? columns.filter((column) => column !== lead) : columns
  return (
    <ul aria-label={caption} className="space-y-3">
      {rows.map((row) => (
        <li
          key={rowKey(row)}
          data-row-key={rowKey(row)}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={onRowClick ? (event) => event.key === 'Enter' && onRowClick(row) : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          className={`rounded-lg border border-line bg-surface p-4 ${onRowClick ? 'cursor-pointer transition-colors hover:bg-surface-subtle' : ''} ${rowClassName?.(row) ?? ''}`}
        >
          {lead && <div className="mb-2 text-card-title font-semibold text-ink-900" data-primary>{lead.render(row)}</div>}
          <dl className="divide-y divide-line-subtle">
            {rest.map((column) => (
              <div key={column.key} className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
                <dt className="shrink-0 text-label font-medium text-ink-800">{column.header}</dt>
                <dd className={`min-w-0 text-right text-sm text-ink-900 ${column.align === 'right' ? 'cep-num' : ''}`}>{column.render(row)}</dd>
              </div>
            ))}
          </dl>
          {expand && (expand.canExpand?.(row) ?? true) && (() => {
            const key = rowKey(row)
            const id = `${baseId}-${key}`
            return (
              <div className="mt-3 border-t border-line-subtle pt-3">
                <ExpandButton open={open.has(key)} controls={id} onToggle={() => toggle(key)}><span className="pr-1 text-sm font-semibold">{expand.label(row)}</span></ExpandButton>
                {open.has(key) && <div id={id} className="mt-3">{expand.render(row)}</div>}
              </div>
            )
          })()}
        </li>
      ))}
    </ul>
  )
}

export function DataTable<T>(props: DataTableProps<T>) {
  const isMd = useMinWidth(BREAKPOINT.md)
  if (isMd) return <Table {...props} />
  return props.phone === 'table' ? <CompactTable {...props} /> : <StackedCards {...props} />
}

/** A numeric grid on a phone: 13px text and 8px cells, optional columns behind "Show All Columns"; it scrolls inside itself, never the page. */
function CompactTable<T>({ columns, rows, rowKey, caption, inset = 'default' }: DataTableProps<T>) {
  // 8px between columns; in a card the table reaches the card's edges, with 16px at the outer cells
  const edge = inset === 'card' ? 'first:pl-4 last:pr-4' : 'first:pl-0 last:pr-0'
  const [all, setAll] = useState(false)
  const optional = columns.some((column) => column.phoneOptional)
  const shown = columns.filter((column) => all || !column.phoneOptional)
  return (
    <div className="flex flex-col gap-3" data-phone-table>
      <div className={`overflow-x-auto ${inset === 'card' ? '-mx-4' : ''}`}>
        <table className="min-w-full divide-y divide-line text-helper">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-subtle">
            <tr>
              {shown.map((column) => (
                <th key={column.key} scope="col" className={`h-9 px-1 ${edge} text-label font-medium text-ink-900 ${column.align === 'right' ? 'text-right' : 'text-left'}`}>{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {shown.map((column) => (
                  <td key={column.key} className={`px-1 py-2 ${edge} align-middle text-ink-800 ${column.align === 'right' ? 'cep-num text-right whitespace-nowrap' : ''} ${column.className ?? ''}`}>{column.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {optional && (
        <button type="button" aria-pressed={all} onClick={() => setAll(!all)} className="w-fit text-helper font-semibold text-brand-800 hover:underline">
          {all ? 'Show Fewer Columns' : 'Show All Columns'}
        </button>
      )}
    </div>
  )
}

function Table<T>({ columns, rows, rowKey, onRowClick, caption, framed = true, inset = 'default', expand, rowClassName }: DataTableProps<T>) {
  const [open, toggle] = useOpenRows(expand?.initiallyOpen)
  const baseId = useId()
  const edge = inset === 'card' ? 'first:pl-6 last:pr-6' : ''
  return (
    <div className={`overflow-x-auto bg-surface ${framed ? 'rounded-lg border border-line' : 'rounded-b-lg'}`}>
      <table className="min-w-full divide-y divide-line text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-subtle">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`h-10 px-4 ${edge} text-label font-medium text-ink-800 ${column.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => {
            const key = rowKey(row)
            const expandable = Boolean(expand) && (expand?.canExpand?.(row) ?? true)
            const isOpen = expandable && open.has(key)
            const detailId = `${baseId}-${key}`
            return (
              <Fragment key={key}>
                <tr
                  data-row-key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter') onRowClick(row)
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  className={`${onRowClick ? 'h-10 cursor-pointer transition-colors hover:bg-surface-subtle xl:h-12' : 'h-10 xl:h-12'} ${rowClassName?.(row) ?? ''}`}
                >
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={`px-4 ${edge} align-middle text-ink-800 ${column.align === 'right' ? 'cep-num text-right' : ''} ${column.className ?? ''}`}
                    >
                      {expand && index === 0 ? (
                        <span className="flex items-center gap-2">
                          {expandable ? <ExpandButton open={isOpen} label={expand.label(row)} controls={detailId} onToggle={() => toggle(key)} /> : <span aria-hidden className="w-6 shrink-0" />}
                          {column.render(row)}
                        </span>
                      ) : column.render(row)}
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <tr id={detailId} data-expanded-row>
                    <td colSpan={columns.length} className={`bg-surface-subtle px-4 py-5 ${inset === 'card' ? 'pl-6 pr-6' : ''}`}>{expand!.render(row)}</td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
