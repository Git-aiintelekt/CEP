/** Collection pages: each is a column definition over the shared <ResourceList>. */
import type { Column } from '@/components/DataTable'
import { ResourceList } from '@/components/ResourceList'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateTime, humanize } from '@/lib/format'
import type { Journey } from '@/lib/types'

const options = (...values: string[]) => values.map((value) => ({ value, label: humanize(value) }))

function Title({ primary, secondary }: { primary: string; secondary?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-ink-900">{primary}</p>
      {secondary && <p className="truncate text-xs text-ink-500">{secondary}</p>}
    </div>
  )
}

const journeyColumns: Column<Journey>[] = [
  { key: 'name', header: 'Journey', render: (row) => <Title primary={row.name} secondary={row.code} /> },
  { key: 'population', header: 'Population', render: (row) => humanize(row.population_mode) },
  { key: 'reentry', header: 'Re-entry', render: (row) => humanize(row.reentry_policy) },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  { key: 'updated', header: 'Updated', render: (row) => formatDateTime(row.updated_at) },
]

export function JourneysPage() {
  return (
    <ResourceList<Journey>
      title="Journeys"
      description="Multi-step, event-triggered or list-based flows. Journey sends are grouped campaign runs, never one campaign per customer."
      resource="journeys"
      columns={journeyColumns}
      filters={[{ param: 'status', label: 'Status', options: options('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED') }]}
      emptyHint="Journeys designed on the canvas appear here."
    />
  )
}
