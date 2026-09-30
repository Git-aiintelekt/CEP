/** The lists of the Send To and Don't Send To cards: each list's name (opens in a new tab) with when it was attached and last updated, its source and size, and how to take it off. */
import { X } from 'lucide-react'

import { IconButton } from '@/components/Button'
import { DataTable, type Column } from '@/components/DataTable'
import { Tag } from '@/components/StatusBadge'
import { buttonClass } from '@/components/buttonStyles'
import { sourceLabel } from '@/features/contact-lists/sourceLabel'
import { formatNumber } from '@/lib/format'

import { dateInZone } from '../../zone'

export interface ListRow {
  id: string
  name: string
  source_type: string
  list_environment: string
  member_count: number
  updated_at: string | null
  /** attached: saved or picked here; auto: made here from an audience or a clone; review: an upload waiting for a confirmation */
  state: 'attached' | 'auto' | 'review'
  /** when it was attached, if the campaign has stored it */
  attachedAt: string | null
}

interface ListsTableProps {
  rows: ListRow[]
  caption: string
  zone: string
  onRemove: (row: ListRow) => void
  onConfirm?: (row: ListRow) => void
}

export function ListsTable({ rows, caption, zone, onRemove, onConfirm }: ListsTableProps) {
  const today = new Date().toISOString()
  const attached = (row: ListRow) =>
    row.state === 'review' ? 'Uploaded file · not counted until you confirm'
    : row.state === 'auto' ? `Auto-attached ${dateInZone(row.attachedAt ?? today, zone)}`
    : row.attachedAt ? `Attached ${dateInZone(row.attachedAt, zone)}` : 'Attached, not saved yet'
  // the last update shares the line: beside the audience summary the card is too narrow for a column of its own
  const note = (row: ListRow) => [attached(row), row.updated_at && `Updated ${dateInZone(row.updated_at, zone)}`].filter(Boolean).join(' · ')

  const columns: Column<ListRow>[] = [
    { key: 'list', header: 'List', render: (row) => (
      <div className="flex min-w-0 flex-col gap-0.5 md:py-2">
        <a href={`/contact-lists/${row.id}`} target="_blank" rel="noreferrer" aria-label={`${row.name} (opens in a new tab)`}
          className="truncate text-card-title font-semibold text-brand-800 hover:underline">{row.name}</a>
        <span className={`text-helper ${row.state === 'review' ? 'font-medium text-warning-text' : 'text-ink-800'}`}>{row.state === 'review' ? <>Needs Review · {note(row)}</> : note(row)}</span>
        {row.state === 'review' && (
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass({ variant: 'primary', size: 'sm' })} onClick={() => onConfirm?.(row)}>Confirm</button>
            <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} onClick={() => onRemove(row)}>Not Now</button>
          </span>
        )}
      </div>
    ) },
    { key: 'source', header: 'Source', render: (row) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Tag>{sourceLabel(row.source_type)}</Tag>
        {row.list_environment === 'TEST' && <Tag tone="warning">Test</Tag>}
      </span>
    ) },
    { key: 'contacts', header: 'Contacts', align: 'right', render: (row) => formatNumber(row.member_count) },
    { key: 'actions', header: '', className: 'w-0 whitespace-nowrap text-right', render: (row) => row.state === 'review' ? null : <IconButton label={`Remove ${row.name}`} icon={X} size="sm" onClick={() => onRemove(row)} /> },
  ]

  return (
    <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} caption={caption} framed={false} inset="card" primary="list"
      rowClassName={(row) => (row.state === 'review' ? 'bg-warning-bg' : '')} />
  )
}
