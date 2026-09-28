/** "Your Templates": channel tabs, status, search, grid or list, with the CEP presets after the workspace's own. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { EllipsisVertical, Eye, LayoutGrid, List, Search, type LucideIcon } from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button, IconButton } from '@/components/Button'
import { Field, TextInput } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { Modal } from '@/components/Modal'
import { Popover } from '@/components/Popover'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import { editorPathFor, editorRouteFor } from '@/lib/editorRoute'
import { formatRelative, titleize } from '@/lib/format'
import type { Preset, Template } from '@/lib/types'
import { useCursorList } from '@/lib/useCursorList'
import { useSingleDropdown, type SingleDropdown } from '@/lib/useSingleDropdown'

import { lookOf, type TemplateChannel } from './channels'
import { usePresets } from './presetSource'
import { ItemTile } from './preview/ItemTile'
import { TemplatePreviewModal } from './preview/TemplatePreviewModal'
import type { PreviewItem } from './preview/usePreviewContent'
import { lastUsedText } from './lastUsed'
import { StatusTag } from './StatusTag'

type View = 'grid' | 'list'
type Item = PreviewItem

const STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED']
const VIEW_KEY = 'cep.templates.view'

const openLabel = (template: Template) => (editorRouteFor(template.channel) === 'design' ? 'Open Designer' : 'Open Editor')
const editorName = (template: Template) => (editorRouteFor(template.channel) === 'design' ? 'designer' : 'editor')
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'The server did not answer.')

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

function matches(preset: Preset, needle: string): boolean {
  return needle === '' || `${preset.name} ${preset.description} ${preset.category}`.toLowerCase().includes(needle)
}

interface TemplateLibraryProps {
  /** channels the workspace can use, in tab order */
  channels: TemplateChannel[]
  canEdit: boolean
}

export function TemplateLibrary({ channels, canEdit }: TemplateLibraryProps) {
  const resultsId = useId()
  const [tab, setTab] = useState<TemplateChannel | 'ALL'>('ALL')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [view, setViewState] = useState<View>(readView)
  const needle = search.trim().toLowerCase()

  const setView = (next: View) => {
    setViewState(next)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {
      // the choice just is not remembered
    }
  }

  const list = useCursorList<Template>('templates', { channel: tab === 'ALL' ? undefined : tab, status: status || undefined, search: needle || undefined })
  const { presets } = usePresets(tab === 'ALL' ? channels : [tab])
  const [previewing, setPreviewing] = useState<PreviewItem | null>(null)

  // a template's own actions: a draft copy of it, or its removal (asked first; a campaign's template is refused by the server)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [deleting, setDeleting] = useState<Template | null>(null)
  const [renaming, setRenaming] = useState<Template | null>(null)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['templates'] })
  const rename = useMutation({
    mutationFn: ({ template, name }: { template: Template; name: string }) => api.patch<Template>(`/templates/${template.id}/`, { name }),
    onSuccess: (renamed, { template }) => {
      setRenaming(null)
      refresh()
      toast.success('Template renamed', `“${template.name}” is now “${renamed.name}”.`)
    },
  })
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
      toast.success('Template deleted', `“${template.name}” is gone from the library.`)
    },
  })
  const actions: TemplateActions | undefined = canEdit ? { onRename: (template) => { rename.reset(); setRenaming(template) }, onDuplicate: duplicate.mutate, onDelete: setDeleting } : undefined

  // presets follow the workspace's own templates, so they sit on the last page; they have no status to filter by
  const shownPresets = !list.hasNext && status === '' ? presets.filter((preset) => matches(preset, needle)) : []
  const items: Item[] = [...list.rows.map((template) => ({ kind: 'template' as const, template })), ...shownPresets.map((preset) => ({ kind: 'preset' as const, preset }))]
  const tabs: { key: TemplateChannel | 'ALL'; label: string }[] = [{ key: 'ALL', label: 'All' }, ...channels.map((channel) => ({ key: channel, label: lookOf(channel).label }))]

  return (
    <section aria-labelledby={`${resultsId}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${resultsId}-title`} className="font-display text-section-title font-semibold text-ink-900">Your Templates</h2>
        <label className="relative block w-full sm:w-64">
          <span className="sr-only">Search templates</span>
          <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search templates"
            className="h-9 w-full rounded-lg border border-transparent bg-surface-sunken pr-3 pl-9 text-sm text-ink-900 transition-colors duration-base ease-standard focus:bg-surface focus-visible:border-brand-600"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line">
        <div role="tablist" aria-label="Channel" className="-mb-px flex gap-6 overflow-x-auto">
          {tabs.map((item) => {
            const selected = tab === item.key
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={resultsId}
                onClick={() => setTab(item.key)}
                className={`h-10 shrink-0 border-b-2 text-sm whitespace-nowrap transition-colors duration-fast ease-standard ${selected ? 'border-brand-600 font-semibold text-brand-600' : 'border-transparent font-medium text-ink-500 hover:text-ink-900'}`}
              >
                {item.label}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 pb-2">
          {list.isFetching && !list.isPending && <Spinner size="sm" />}
          <select
            aria-label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-8 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink-900 transition-colors duration-base ease-standard hover:bg-surface-subtle focus-visible:border-brand-600"
          >
            <option value="">All Statuses</option>
            {STATUSES.map((value) => <option key={value} value={value}>{titleize(value)}</option>)}
          </select>
          <div className="flex overflow-hidden rounded-lg border border-line">
            <ViewButton icon={LayoutGrid} label="Grid View" pressed={view === 'grid'} onClick={() => setView('grid')} />
            <ViewButton icon={List} label="List View" pressed={view === 'list'} onClick={() => setView('list')} />
          </div>
        </div>
      </div>

      <div id={resultsId} className="mt-6">
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isPending ? (
          <p className="flex items-center gap-3 py-12 text-sm text-ink-500"><Spinner /> Loading templates</p>
        ) : items.length === 0 ? (
          needle || status || tab !== 'ALL' ? (
            <div className="p-12 text-center">
              <p className="text-base font-semibold text-ink-900">No matching templates</p>
              <p className="mt-1 text-helper text-ink-500">Try a different channel filter or clear the search.</p>
            </div>
          ) : (
            <EmptyState title="No Templates Yet" hint={canEdit ? 'Start one from a channel above, or copy a CEP preset: every campaign needs a template to send.' : 'Someone with the template.edit permission can start one from a channel above.'} />
          )
        ) : view === 'grid' ? (
          <TemplateGrid items={items} canEdit={canEdit} onPreview={setPreviewing} actions={actions} />
        ) : (
          <TemplateTable items={items} canEdit={canEdit} onPreview={setPreviewing} actions={actions} />
        )}

        {(list.hasNext || list.hasPrevious) && (
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" disabled={!list.hasPrevious} onClick={list.goPrevious}>Previous</Button>
            <Button size="sm" disabled={!list.hasNext} onClick={list.goNext}>Next</Button>
          </div>
        )}
      </div>

      {previewing && <TemplatePreviewModal item={previewing} canEdit={canEdit} onClose={() => setPreviewing(null)} />}
      {renaming && (
        <RenameTemplateModal
          template={renaming}
          pending={rename.isPending}
          error={rename.isError ? messageOf(rename.error) : null}
          onClose={() => setRenaming(null)}
          onSave={(name) => rename.mutate({ template: renaming, name })}
        />
      )}
      {deleting && (
        <Modal
          title="Delete this template?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Keep It</Button>
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(deleting)}>Delete Template</Button>
            </>
          }
        >
          <p className="text-sm text-ink-700">“{deleting.name}” and its saved versions leave the library. A template that a campaign uses cannot be deleted: archive it instead.</p>
          {remove.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-plain">{messageOf(remove.error)}</p>}
        </Modal>
      )}
    </section>
  )
}

/** What the reader may do to one of the workspace's own templates; absent without template.edit. */
interface TemplateActions {
  onRename: (template: Template) => void
  onDuplicate: (template: Template) => void
  onDelete: (template: Template) => void
}

/** The rows every template's menu ends with, when the reader may edit. */
function ActionRows({ template, actions, close }: { template: Template; actions?: TemplateActions; close: () => void }) {
  if (!actions) return null
  return (
    <>
      <MenuRow title="Rename" onClick={() => { close(); actions.onRename(template) }} />
      <MenuRow title="Duplicate" detail="A draft copy of the latest version" onClick={() => { close(); actions.onDuplicate(template) }} />
      <MenuRow tone="error" title="Delete" onClick={() => { close(); actions.onDelete(template) }} />
    </>
  )
}

const RENAME_FORM_ID = 'rename-template-form'
const NAME_MIN = 3

/** A new name for a template, a duplicate's "(copy)" included; the server refuses a name another template has. */
function RenameTemplateModal({ template, pending, error, onClose, onSave }: {
  template: Template
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(template.name)
  const trimmed = name.trim()
  const ready = trimmed.length >= NAME_MIN && trimmed !== template.name
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready && !pending) onSave(trimmed)
  }
  return (
    <Modal
      title="Rename Template"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={RENAME_FORM_ID} loading={pending} disabled={!ready}>Save Name</Button>
        </>
      }
    >
      <form id={RENAME_FORM_ID} onSubmit={submit} noValidate>
        <Field label="Template Name" required error={error ?? undefined} hint="Shown in the template list and when picking a template in a campaign">
          {(ids) => <TextInput {...ids} value={name} maxLength={200} autoFocus onChange={(event) => setName(event.target.value)} />}
        </Field>
      </form>
    </Modal>
  )
}

function ViewButton({ icon: Icon, label, pressed, onClick }: { icon: LucideIcon; label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex h-8 w-9 items-center justify-center transition-colors duration-fast ease-standard ${pressed ? 'bg-brand-100 text-brand-800' : 'bg-surface text-ink-500 hover:bg-surface-subtle hover:text-ink-900'}`}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden />
    </button>
  )
}

interface ItemsProps {
  items: Item[]
  canEdit: boolean
  /** every card and row opens its preview; a preset's preview is where the copy is offered */
  onPreview: (item: PreviewItem) => void
  actions?: TemplateActions
}

const CARD = 'flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-left'
const CARD_ACTIVE = 'transition-colors duration-fast ease-standard hover:border-brand-600 active:border-brand-800'

function CardBody({ name, meta, usage, tags }: { name: string; meta: string; usage?: string; tags: ReactNode }) {
  return (
    <span className="flex flex-col gap-1 p-3.5">
      <span className="truncate text-sm font-semibold text-ink-900">{name}</span>
      <span className="text-xs text-ink-500">{meta}</span>
      {usage && <span className="line-clamp-1 text-xs text-ink-500" data-last-used>{usage}</span>}
      <span className="mt-1.5 flex flex-wrap gap-1.5 pr-8">{tags}</span>
    </span>
  )
}

/** The card's View icon, on the tag row: the same preview the card itself opens, for anyone who looks for a button. */
function ViewIcon({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <span className="absolute right-2 bottom-2.5">
      <IconButton label={`Preview ${name}`} icon={Eye} onClick={onClick} />
    </span>
  )
}

function TemplateGrid({ items, canEdit, onPreview, actions }: ItemsProps) {
  const navigate = useNavigate()
  const menus = useSingleDropdown<string>()
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
      {items.map((item) => {
        if (item.kind === 'template') {
          const { template } = item
          const body = (
            <>
              <ItemTile item={item} />
              <CardBody name={template.name} meta={`Edited ${formatRelative(template.updated_at)}`} usage={lastUsedText(template)} tags={<><StatusTag status={template.status} /><Tag>{lookOf(template.channel).label}</Tag></>} />
            </>
          )
          return (
            <li key={template.id} className="relative min-w-0">
              {/* a template opens in its preview, whose Edit leads on to the editor */}
              <button type="button" onClick={() => onPreview(item)} className={`${CARD} ${CARD_ACTIVE} h-full w-full`}>{body}</button>
              {/* beside the card, not inside it: a button cannot hold a button */}
              <span className="absolute top-2 right-2 rounded-control-md border border-line bg-surface">
                <RowMenu menus={menus} id={template.id} name={template.name}>
                  <MenuRow title="Preview" onClick={() => { menus.close(); onPreview(item) }} />
                  <MenuRow title={openLabel(template)} onClick={() => navigate(editorPathFor(template))} />
                  <ActionRows template={template} actions={actions} close={() => menus.close()} />
                </RowMenu>
              </span>
              <ViewIcon name={template.name} onClick={() => onPreview(item)} />
            </li>
          )
        }
        const { preset } = item
        const body = (
          <>
            <ItemTile item={item} />
            <CardBody name={preset.name} meta="Starter" tags={<><Tag>CEP Preset</Tag><Tag>{lookOf(preset.channel).label}</Tag></>} />
          </>
        )
        return (
          <li key={`preset-${preset.key}`} className="relative min-w-0">
            {canEdit ? (
              <button type="button" onClick={() => onPreview(item)} aria-label={`${preset.name}, CEP Preset`} className={`${CARD} ${CARD_ACTIVE} h-full w-full`}>{body}</button>
            ) : (
              <div className={`${CARD} h-full`}>{body}</div>
            )}
            {canEdit && <ViewIcon name={preset.name} onClick={() => onPreview(item)} />}
          </li>
        )
      })}
    </ul>
  )
}

/** A row's ⋮ button and its menu. */
function RowMenu({ menus, id, name, children }: { menus: SingleDropdown<string>; id: string; name: string; children: ReactNode }) {
  return (
    <span className="relative inline-block">
      <button
        {...menus.triggerProps(id)}
        type="button"
        aria-label={`Actions for ${name}`}
        className="flex h-8 w-8 items-center justify-center rounded-control-md text-ink-700 transition-colors duration-fast ease-standard hover:bg-line-subtle active:bg-line"
      >
        <EllipsisVertical size={16} strokeWidth={1.5} aria-hidden />
      </button>
      {menus.isOpen(id) && (
        <Popover label={`Actions for ${name}`} width={180} placement="bottom-end" {...menus.panelProps(id)}>
          {children}
        </Popover>
      )}
    </span>
  )
}

// the same header as DataTable: 12px, title case
const HEAD = 'h-10 px-4 text-left text-xs font-semibold text-ink-700'
const CELL = 'h-14 px-4 align-middle'

function TemplateTable({ items, canEdit, onPreview, actions }: ItemsProps) {
  const navigate = useNavigate()
  const menus = useSingleDropdown<string>()

  return (
    <div className="relative overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Templates</caption>
        <thead className="bg-surface-subtle">
          <tr className="border-b border-line">
            <th scope="col" className={HEAD}>Template</th>
            <th scope="col" className={HEAD}>Channel</th>
            <th scope="col" className={HEAD}>Status</th>
            <th scope="col" className={HEAD}>Last Edited</th>
            <th scope="col" className={HEAD}>Last Used In</th>
            <th scope="col" className={`${HEAD} w-12`}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            if (item.kind === 'template') {
              const { template } = item
              return (
                <tr key={template.id} onClick={() => onPreview(item)} className="cursor-pointer border-b border-line-subtle last:border-b-0 hover:bg-surface-subtle">
                  <td className={CELL}>
                    <span className="block min-w-0">
                      <button type="button" onClick={(event) => { event.stopPropagation(); onPreview(item) }} className="block max-w-full truncate text-left font-semibold text-ink-900 hover:underline">{template.name}</button>
                      {template.description && <span className="block truncate text-xs text-ink-500">{template.description}</span>}
                    </span>
                  </td>
                  <td className={CELL}><Tag>{lookOf(template.channel).label}</Tag></td>
                  <td className={CELL}><StatusTag status={template.status} /></td>
                  <td className={`${CELL} whitespace-nowrap text-ink-500`}>Edited {formatRelative(template.updated_at)}</td>
                  <td className={`${CELL} max-w-[240px] truncate text-ink-500`} title={lastUsedText(template)}>{template.last_used_in ? lastUsedText(template) : <span className="text-ink-300">Not used yet</span>}</td>
                  <td className={`${CELL} text-right`} onClick={(event) => event.stopPropagation()}>
                    <RowMenu menus={menus} id={template.id} name={template.name}>
                      <MenuRow title="Preview" onClick={() => { menus.close(); onPreview(item) }} />
                      <MenuRow title={openLabel(template)} onClick={() => navigate(editorPathFor(template))} />
                      <ActionRows template={template} actions={actions} close={() => menus.close()} />
                    </RowMenu>
                  </td>
                </tr>
              )
            }
            const { preset } = item
            return (
              <tr
                key={`preset-${preset.key}`}
                onClick={canEdit ? () => onPreview(item) : undefined}
                className={`border-b border-line-subtle last:border-b-0 ${canEdit ? 'cursor-pointer hover:bg-surface-subtle' : ''}`}
              >
                <td className={CELL}>
                  <span className="block min-w-0">
                    {canEdit ? (
                      <button type="button" onClick={(event) => { event.stopPropagation(); onPreview(item) }} className="block max-w-full truncate text-left font-semibold text-ink-900 hover:underline">{preset.name}</button>
                    ) : (
                      <span className="block truncate font-semibold text-ink-900">{preset.name}</span>
                    )}
                    {preset.description && <span className="block truncate text-xs text-ink-500">{preset.description}</span>}
                  </span>
                </td>
                <td className={CELL}><Tag>{lookOf(preset.channel).label}</Tag></td>
                <td className={CELL}><Tag>CEP Preset</Tag></td>
                <td className={`${CELL} text-ink-500`}>Starter</td>
                <td className={`${CELL} text-right`} onClick={(event) => event.stopPropagation()}>
                  <RowMenu menus={menus} id={`preset-${preset.key}`} name={preset.name}>
                    <MenuRow title="Preview" onClick={() => { menus.close(); onPreview(item) }} />
                  </RowMenu>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
