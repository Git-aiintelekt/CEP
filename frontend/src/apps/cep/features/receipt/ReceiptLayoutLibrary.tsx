/**
 * Templates → Receipt Layouts: the named receipt layouts E-Receipt templates pick (option A of docs/mockups/receipt-layouts.html).
 * Used By counts the templates that pick each, so the reader knows how many receipts a change reaches.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Code, EllipsisVertical, Plus, ReceiptText, SlidersHorizontal } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/Button'
import { Field, Select, TextInput } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { Modal } from '@/components/Modal'
import { Popover } from '@/components/Popover'
import { SearchField } from '@/components/SearchField'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import type { ReceiptLayoutPreset, ReceiptLayoutSummary, ReceiptLibraryLayout } from '@/lib/types'
import { useSingleDropdown, type SingleDropdown } from '@/lib/useSingleDropdown'

import { defaultSectionsFor } from './receiptPresets'
import { STARTER_CUSTOM_HTML, STARTER_ITEM_ROW, defaultRegisterSettings } from './registerSettings'

const PRESET_NAMES: Record<ReceiptLayoutPreset, string> = { REGISTER: 'Store Register', STANDARD: 'Standard', ITEMIZED: 'Itemized', COMPACT: 'Compact', CUSTOM_HTML: 'Custom HTML' }

const STARTS: { value: ReceiptLayoutPreset | 'COPY'; title: string; description: string }[] = [
  { value: 'REGISTER', title: 'Store Register', description: 'The paper receipt: transaction numbers, lines with discounts, taxes, tenders.' },
  { value: 'STANDARD', title: 'Standard', description: 'Images, quantity and unit price.' },
  { value: 'ITEMIZED', title: 'Itemized', description: 'SKU and every totals row.' },
  { value: 'COMPACT', title: 'Compact', description: 'Item and amount only.' },
  { value: 'CUSTOM_HTML', title: 'Custom HTML', description: 'Write the HTML, with an Item Row per line.' },
  { value: 'COPY', title: 'Copy From…', description: 'Start from one of your layouts.' },
]

const HEAD = 'h-12 px-2 text-left text-sm font-semibold whitespace-nowrap text-ink-900 first:pl-6 last:pr-6'
const CELL = 'px-2 py-3 text-sm first:pl-6 last:pr-6'

/** A short description of what the layout prints, under its name. */
function describe(row: ReceiptLayoutSummary): string {
  return PRESET_NAMES[row.layout_preset]
}

export function ReceiptLayoutLibrary({ canEdit }: { canEdit: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const menus = useSingleDropdown<string>()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<ReceiptLayoutSummary | null>(null)
  const [archiving, setArchiving] = useState<ReceiptLayoutSummary | null>(null)
  const list = useQuery({ queryKey: ['receipt-layouts', 'list'], queryFn: ({ signal }) => api.get<ReceiptLayoutSummary[]>('/receipt-layouts/', undefined, signal) })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['receipt-layouts'] })
  const open = (id: string) => navigate(`/templates/receipt-layouts/${id}`)

  const duplicate = useMutation({
    mutationFn: (row: ReceiptLayoutSummary) => api.post<ReceiptLibraryLayout>(`/receipt-layouts/${row.id}/duplicate/`, {}),
    onSuccess: (copy) => {
      refresh()
      toast.success('Layout duplicated', `“${copy.name}”. Opening it.`)
      open(copy.id)
    },
    onError: (error) => toast.failure(error, 'The layout was not duplicated'),
  })
  const rename = useMutation({
    mutationFn: ({ row, name }: { row: ReceiptLayoutSummary; name: string }) => api.post<ReceiptLibraryLayout>(`/receipt-layouts/${row.id}/rename/`, { name }),
    onSuccess: (renamed, { row }) => {
      setRenaming(null)
      refresh()
      toast.success('Layout renamed', `“${row.name}” is now “${renamed.name}”.`)
    },
  })
  const archive = useMutation({
    mutationFn: (row: ReceiptLayoutSummary) => api.post<ReceiptLibraryLayout>(`/receipt-layouts/${row.id}/archive/`, {}),
    onSuccess: (_, row) => {
      setArchiving(null)
      refresh()
      toast.success('Layout archived', `“${row.name}” has left the list.`)
    },
  })

  const needle = search.trim().toLowerCase()
  const rows = (list.data ?? []).filter((row) => !needle || row.name.toLowerCase().includes(needle))

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField label="Search layouts" value={search} onChange={setSearch} />
        {list.isFetching && !list.isPending && <Spinner size="sm" />}
        {canEdit && <Button variant="primary" size="sm" className="ml-auto" iconStart={Plus} onClick={() => setCreating(true)}>New Layout</Button>}
      </div>

      <div className="mt-6">
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isPending ? (
          <p className="flex items-center gap-3 py-12 text-sm text-ink-800"><Spinner /> Loading receipt layouts</p>
        ) : (list.data ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-6 py-10 text-center">
            <ReceiptText size={28} strokeWidth={1.5} aria-hidden className="text-ink-800" />
            <p className="text-base font-semibold text-ink-900">No Receipt Layouts Yet</p>
            <p className="max-w-[460px] text-sm text-ink-800">A layout is the receipt inside an E-Receipt: its header, columns, totals and footer. Design it once and use it in as many E-Receipt templates as you like.</p>
            {canEdit && <Button variant="primary" size="sm" iconStart={Plus} onClick={() => setCreating(true)}>New Layout</Button>}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-base font-semibold text-ink-900">No matching layouts</p>
            <p className="mt-1 text-helper text-ink-800">Try a different name or clear the search.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={HEAD}>Name</th>
                  <th className={HEAD}>Kind</th>
                  <th className={HEAD}>Used By</th>
                  <th className={HEAD}>Last Edited</th>
                  <th className={HEAD}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line-subtle hover:bg-surface-hover">
                    <td className={CELL}>
                      <button type="button" onClick={() => open(row.id)} className="text-left font-semibold text-link hover:underline">{row.name}</button>
                      <p className="text-xs text-ink-800">{describe(row)}</p>
                    </td>
                    <td className={CELL}>
                      <span className="inline-flex items-center gap-1.5 text-ink-800">
                        {row.kind === 'CUSTOM_HTML' ? <Code size={14} strokeWidth={1.5} aria-hidden /> : <SlidersHorizontal size={14} strokeWidth={1.5} aria-hidden />}
                        {row.kind === 'CUSTOM_HTML' ? 'Custom HTML' : 'Settings'}
                      </span>
                    </td>
                    <td className={`${CELL} cep-num whitespace-nowrap`}>{row.used_by} {row.used_by === 1 ? 'template' : 'templates'}</td>
                    <td className={`${CELL} whitespace-nowrap text-ink-800`}>{formatRelative(row.updated_at)}{row.updated_by ? ` · ${row.updated_by}` : ''}</td>
                    <td className={`${CELL} text-right`}>
                      <RowMenu menus={menus} id={row.id} name={row.name}>
                        <MenuRow title={canEdit ? 'Edit' : 'Open'} onClick={() => { menus.close(); open(row.id) }} />
                        {canEdit && (
                          <>
                            <MenuRow title="Duplicate" onClick={() => { menus.close(); duplicate.mutate(row) }} />
                            <MenuRow title="Rename" onClick={() => { menus.close(); rename.reset(); setRenaming(row) }} />
                            <MenuRow tone="error" title="Archive" onClick={() => { menus.close(); archive.reset(); setArchiving(row) }} />
                          </>
                        )}
                      </RowMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && <NewLayoutModal layouts={list.data ?? []} onClose={() => setCreating(false)} onCreated={(made) => { refresh(); open(made.id) }} />}
      {renaming && (
        <NameModal title="Rename Layout" initial={renaming.name} saveLabel="Save Name" pending={rename.isPending} error={rename.isError ? rename.error : null}
          onClose={() => setRenaming(null)} onSave={(name) => rename.mutate({ row: renaming, name })} />
      )}
      {archiving && (
        <Modal
          title="Archive this layout?"
          onClose={() => setArchiving(null)}
          footer={
            <>
              <Button onClick={() => setArchiving(null)}>Keep It</Button>
              <Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate(archiving)}>Archive Layout</Button>
            </>
          }
        >
          <p className="text-sm text-ink-800">“{archiving.name}” leaves the list and can no longer be picked. A layout a template still uses cannot be archived: pick another layout in those templates first.</p>
          {archive.isError && <div className="mt-3"><ErrorState title="The layout was not archived" error={archive.error} /></div>}
        </Modal>
      )}
    </div>
  )
}

function RowMenu({ menus, id, name, children }: { menus: SingleDropdown<string>; id: string; name: string; children: ReactNode }) {
  return (
    <span className="relative inline-block">
      <button
        {...menus.triggerProps(id)}
        type="button"
        aria-label={`Actions for ${name}`}
        className="flex h-8 w-8 items-center justify-center rounded-control-md text-ink-800 transition-colors duration-fast ease-standard hover:bg-fill-subtle active:bg-fill-muted"
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

const fieldError = (error: unknown, field: string) => (error instanceof ApiError && error.status === 400 ? error.fieldErrors[field] : undefined)

function NameModal({ title, initial, saveLabel, pending, error, onClose, onSave }: {
  title: string; initial: string; saveLabel: string; pending: boolean; error: unknown; onClose: () => void; onSave: (name: string) => void
}) {
  const [name, setName] = useState(initial)
  const trimmed = name.trim()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (trimmed && !pending) onSave(trimmed)
  }
  return (
    <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="receipt-layout-name-form" loading={pending} disabled={!trimmed || trimmed === initial}>{saveLabel}</Button></>}>
      <form id="receipt-layout-name-form" onSubmit={submit} noValidate>
        <Field label="Name" required error={fieldError(error, 'name') ?? (error && !fieldError(error, 'name') ? 'The name was not saved.' : undefined)}>
          {(ids) => <TextInput {...ids} value={name} maxLength={120} autoFocus onChange={(event) => setName(event.target.value)} />}
        </Field>
      </form>
    </Modal>
  )
}

function NewLayoutModal({ layouts, onClose, onCreated }: { layouts: ReceiptLayoutSummary[]; onClose: () => void; onCreated: (made: ReceiptLibraryLayout) => void }) {
  const [name, setName] = useState('')
  const [start, setStart] = useState<ReceiptLayoutPreset | 'COPY'>('REGISTER')
  const [copyFrom, setCopyFrom] = useState(layouts[0]?.id ?? '')
  const toast = useToast()
  const create = useMutation({
    mutationFn: () => {
      if (start === 'COPY') return api.post<ReceiptLibraryLayout>('/receipt-layouts/', { name: name.trim(), copy_from: copyFrom })
      const content =
        start === 'CUSTOM_HTML' ? { sections: [], custom_html: STARTER_CUSTOM_HTML, custom_css: '', item_row: STARTER_ITEM_ROW }
        : start === 'REGISTER' ? { sections: defaultSectionsFor('REGISTER'), register: defaultRegisterSettings() }
        : { sections: defaultSectionsFor(start) }
      return api.post<ReceiptLibraryLayout>('/receipt-layouts/', { name: name.trim(), layout_preset: start, ...content })
    },
    onSuccess: (made) => {
      toast.success('Layout created', `“${made.name}”. Opening it.`)
      onCreated(made)
    },
  })
  const ready = name.trim().length > 0 && (start !== 'COPY' || Boolean(copyFrom))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready && !create.isPending) create.mutate()
  }
  const nameError = fieldError(create.error, 'name')

  return (
    <Modal
      title="New Receipt Layout"
      size="lg"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-receipt-layout" loading={create.isPending} disabled={!ready}>Create Layout</Button></>}
    >
      <form id="new-receipt-layout" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {create.isError && !nameError && <ErrorState title="The layout was not created" error={create.error} />}
        <Field label="Name" required error={nameError}>
          {(ids) => <TextInput {...ids} value={name} maxLength={120} autoFocus placeholder="Store Register Receipt" onChange={(event) => setName(event.target.value)} />}
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink-900">Start From</legend>
          <div role="radiogroup" aria-label="Start From" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {STARTS.filter((option) => option.value !== 'COPY' || layouts.length > 0).map((option) => {
              const checked = option.value === start
              return (
                <button key={option.value} type="button" role="radio" aria-checked={checked} onClick={() => setStart(option.value)}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors duration-base ease-standard ${checked ? 'border-link bg-brand-100' : 'border-line bg-surface hover:bg-surface-hover'}`}>
                  <span className={`text-sm font-semibold ${checked ? 'text-brand-800' : 'text-ink-900'}`}>{option.title}</span>
                  <span className="text-xs text-ink-800">{option.description}</span>
                </button>
              )
            })}
          </div>
        </fieldset>
        {start === 'COPY' && (
          <Field label="Copy From">
            {(ids) => (
              <Select {...ids} value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}>
                {layouts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </Select>
            )}
          </Field>
        )}
      </form>
    </Modal>
  )
}
