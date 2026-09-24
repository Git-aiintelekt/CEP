/** Collection pages: each is a column definition over the shared <ResourceList>. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreVertical } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'

import { iconButtonClass } from '@/components/buttonStyles'
import type { Column } from '@/components/DataTable'
import { buttonDanger, buttonPrimary, buttonSecondary } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { Modal } from '@/components/Modal'
import { ResourceList } from '@/components/ResourceList'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import { editorRouteFor } from '@/lib/editorRoute'
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


function editorPathFor(row: Template): string {
  return `/templates/${row.id}/${editorRouteFor(row.channel)}`
}

const editorName = (row: Template) => (editorRouteFor(row.channel) === 'design' ? 'designer' : 'editor')

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'The server did not answer.')

const templateColumns: Column<Template>[] = [
  { key: 'name', header: 'Template', render: (row) => <Title primary={row.name} secondary={row.description} /> },
  { key: 'channel', header: 'Channel', render: (row) => <Tag>{row.channel}</Tag> },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  { key: 'version', header: 'Version', align: 'right', render: (row) => (row.latest_version ? `v${row.latest_version}` : '—') },
  {
    key: 'open',
    header: 'Design',
    render: (row) => (
      <Link to={editorPathFor(row)} className="font-medium text-brand-800 hover:underline" onClick={(event) => event.stopPropagation()}>
        {editorRouteFor(row.channel) === 'design' ? 'Open designer' : 'Open editor'}
      </Link>
    ),
  },
  { key: 'updated', header: 'Updated', render: (row) => formatDateTime(row.updated_at) },
]

type TemplateAction = 'open' | 'duplicate' | 'delete'

/** The ⋮ on a template row. Stops the row's own click, which would open the editor under the menu. */
function TemplateRowMenu({ template, canEdit, onAction }: { template: Template; canEdit: boolean; onAction: (action: TemplateAction) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  const pick = (action: TemplateAction) => () => {
    setOpen(false)
    onAction(action)
  }
  return (
    <div ref={box} className="relative inline-block" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${template.name}`} onClick={() => setOpen((value) => !value)}
        className={iconButtonClass({ pressed: open })}>
        <MoreVertical size={18} strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-line bg-surface shadow-menu">
          <MenuRow role="menuitem" divider={false} title={`Open ${editorName(template)}`} onClick={pick('open')} />
          {canEdit && <MenuRow role="menuitem" divider={false} title="Duplicate" detail="A draft copy of the latest version" onClick={pick('duplicate')} />}
          {canEdit && <MenuRow role="menuitem" divider={false} tone="error" title="Delete" onClick={pick('delete')} />}
        </div>
      )}
    </div>
  )
}

export function TemplatesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const { can } = useAuth()
  const canEdit = can('template.edit')
  const [deleting, setDeleting] = useState<Template | null>(null)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['templates'] })

  const duplicate = useMutation({
    mutationFn: (template: Template) => api.post<Template>(`/templates/${template.id}/clone/`, {}),
    onSuccess: (copy) => {
      refresh()
      toast.success('Template duplicated', `“${copy.name}” is a draft. Opening it in the ${editorName(copy)}.`)
      navigate(editorPathFor(copy))
    },
    onError: (error) => toast.error('Could not duplicate the template', messageOf(error)),
  })
  const remove = useMutation({
    mutationFn: (template: Template) => api.delete(`/templates/${template.id}/`),
    onSuccess: (_, template) => {
      setDeleting(null)
      refresh()
      toast.success('Template deleted', `“${template.name}” is gone from the list.`)
    },
  })
  const { mutate: runDuplicate } = duplicate

  const columns = useMemo<Column<Template>[]>(
    () => [
      ...templateColumns,
      {
        key: 'actions',
        header: '',
        align: 'right',
        className: 'w-12',
        render: (row) => (
          <TemplateRowMenu
            template={row}
            canEdit={canEdit}
            onAction={(action) => {
              if (action === 'open') navigate(editorPathFor(row))
              else if (action === 'duplicate') runDuplicate(row)
              else setDeleting(row)
            }}
          />
        ),
      },
    ],
    [canEdit, navigate, runDuplicate],
  )

  return (
    <>
      <ResourceList<Template>
        onRowClick={(row) => navigate(editorPathFor(row))}
        actions={
          canEdit && (
            <Link to="/templates/new" className={buttonPrimary}>
              New template
            </Link>
          )
        }
        title="Templates"
        description="Email and e-receipt templates open in the drag-and-drop designer; SMS and MMS open in the message editor. All use the same personalization tags."
        resource="templates"
        columns={columns}
        filters={[
          { param: 'channel', label: 'Channel', options: options('EMAIL', 'SMS', 'MMS', 'E_RECEIPT') },
          { param: 'status', label: 'Status', options: options('DRAFT', 'ACTIVE', 'ARCHIVED') },
        ]}
        emptyHint="Templates built in the designer appear here."
      />
      {deleting && (
        <Modal
          title="Delete this template?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setDeleting(null)}>Keep it</button>
              <button type="button" className={buttonDanger} disabled={remove.isPending} onClick={() => remove.mutate(deleting)}>Delete template</button>
            </>
          }
        >
          <p className="text-sm text-ink-700">“{deleting.name}” and its saved versions leave the list. A template that a campaign uses cannot be deleted: archive it instead.</p>
          {remove.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-plain">{messageOf(remove.error)}</p>}
        </Modal>
      )}
    </>
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
