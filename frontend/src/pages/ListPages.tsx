/** Collection pages: each is a column definition over the shared <ResourceList>. */
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'

import type { Column } from '@/components/DataTable'
import { buttonPrimary } from '@/components/Form'
import { ResourceList } from '@/components/ResourceList'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { formatDateTime, humanize } from '@/lib/format'
import type { Journey, Template } from '@/lib/types'

const options = (...values: string[]) => values.map((value) => ({ value, label: humanize(value) }))

function Title({ primary, secondary }: { primary: string; secondary?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-ink-900">{primary}</p>
      {secondary && <p className="truncate text-xs text-ink-500">{secondary}</p>}
    </div>
  )
}

const DESIGNER_CHANNELS = ['EMAIL', 'E_RECEIPT']

const templateColumns: Column<Template>[] = [
  { key: 'name', header: 'Template', render: (row) => <Title primary={row.name} secondary={row.description} /> },
  { key: 'channel', header: 'Channel', render: (row) => <Tag>{row.channel}</Tag> },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  { key: 'version', header: 'Version', align: 'right', render: (row) => (row.latest_version ? `v${row.latest_version}` : '—') },
  {
    key: 'open',
    header: 'Design',
    render: (row) =>
      DESIGNER_CHANNELS.includes(row.channel) ? (
        <Link to={`/templates/${row.id}/design`} className="font-medium text-brand-800 hover:underline" onClick={(event) => event.stopPropagation()}>
          Open designer
        </Link>
      ) : (
        <Link to={`/templates/${row.id}/message`} className="font-medium text-brand-800 hover:underline" onClick={(event) => event.stopPropagation()}>
          Open editor
        </Link>
      ),
  },
  { key: 'updated', header: 'Updated', render: (row) => formatDateTime(row.updated_at) },
]

export function TemplatesPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  return (
    <ResourceList<Template>
      onRowClick={(row) => navigate(`/templates/${row.id}/${DESIGNER_CHANNELS.includes(row.channel) ? 'design' : 'message'}`)}
      actions={
        can('template.edit') && (
          <Link to="/templates/new" className={buttonPrimary}>
            New template
          </Link>
        )
      }
      title="Templates"
      description="Email and e-receipt templates open in the drag-and-drop designer; SMS and MMS open in the message editor. All use the same personalization tags."
      resource="templates"
      columns={templateColumns}
      filters={[
        { param: 'channel', label: 'Channel', options: options('EMAIL', 'SMS', 'MMS', 'E_RECEIPT') },
        { param: 'status', label: 'Status', options: options('DRAFT', 'ACTIVE', 'ARCHIVED') },
      ]}
      emptyHint="Templates built in the designer appear here."
    />
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
