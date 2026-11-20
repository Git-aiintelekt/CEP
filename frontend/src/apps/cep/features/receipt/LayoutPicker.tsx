/**
 * The top of the E-Receipt editor's Receipt Layout tab: which layout the template uses. Its own (as every template had
 * before Receipt Layouts), or one from Templates → Receipt Layouts, which changes for every template that picks it.
 */
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { ApiError } from '@/lib/api'
import type { ReceiptLayoutSummary } from '@/lib/types'

export interface LibraryPick {
  layout_id: string | null
  layout_name: string | null
}

interface LayoutPickerProps {
  pick: LibraryPick
  list: () => Promise<ReceiptLayoutSummary[]>
  disabled: boolean
  busy: boolean
  onPick: (id: string) => void
  onOwn: () => void
  onEdit: (id: string) => void
  onSaveToLibrary: (name: string) => Promise<void>
}

const OWN = ''

export function LayoutPicker({ pick, list, disabled, busy, onPick, onOwn, onEdit, onSaveToLibrary }: LayoutPickerProps) {
  const selectId = useId()
  const nameId = useId()
  const library = useQuery({ queryKey: ['receipt-layouts', 'list'], queryFn: list, staleTime: 30_000 })
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rows = Array.isArray(library.data) ? library.data : []
  const current = rows.find((row) => row.id === pick.layout_id)
  // a picked layout is always offered, even before the list has loaded
  const options = pick.layout_id && !current ? [{ id: pick.layout_id, name: pick.layout_name ?? 'Library layout', used_by: 0 }, ...rows] : rows

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await onSaveToLibrary(name.trim())
      setNaming(false)
      setName('')
      void library.refetch()
    } catch (failure) {
      setError(failure instanceof ApiError ? (Object.values(failure.fieldErrors)[0] ?? failure.message) : 'The layout was not saved to the library.')
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-line px-3 pt-3 pb-3">
      <label htmlFor={selectId} className="text-xs font-semibold text-ink-800">Layout</label>
      <Select id={selectId} controlSize="sm" value={pick.layout_id ?? OWN} disabled={disabled || busy}
        onChange={(event) => (event.target.value === OWN ? onOwn() : onPick(event.target.value))}>
        <option value={OWN}>This Template’s Own Layout</option>
        {options.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </Select>
      {pick.layout_id ?
        <>
          <p className="text-xs text-ink-800">
            From Receipt Layouts{current ? `, used by ${current.used_by} ${current.used_by === 1 ? 'template' : 'templates'}` : ''}. A change to it reaches every template that uses it.
          </p>
          <button type="button" className={`${buttonSecondary} w-full justify-center`} disabled={busy} onClick={() => onEdit(pick.layout_id!)}>
            <ExternalLink size={14} strokeWidth={1.5} aria-hidden /> Edit Layout
          </button>
          <button type="button" className={`${buttonSecondary} w-full justify-center`} disabled={disabled || busy} onClick={onOwn}>
            Make a Copy for This Template
          </button>
        </>
      : naming ?
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-xs text-ink-800">Name in Receipt Layouts</label>
          <TextInput id={nameId} controlSize="sm" value={name} maxLength={120} autoFocus onChange={(event) => setName(event.target.value)} invalid={Boolean(error)} />
          {error && <p role="alert" className="text-xs text-danger-text">{error}</p>}
          <div className="flex gap-1.5">
            <button type="submit" className={buttonPrimary} disabled={!name.trim() || busy}>Save</button>
            <button type="button" className={buttonSecondary} onClick={() => { setNaming(false); setError(null) }}>Cancel</button>
          </div>
          <p className="text-xs text-ink-800">This template then uses it from the library; save the template to keep that.</p>
        </form>
      : <>
          <p className="text-xs text-ink-800">Only this template uses it.</p>
          {!disabled && (
            <button type="button" className={`${buttonSecondary} w-full justify-center`} disabled={busy} onClick={() => setNaming(true)}>
              Save to Receipt Layouts
            </button>
          )}
        </>
      }
      {library.isError && <p className="text-xs text-ink-800">The library could not be loaded.</p>}
    </div>
  )
}
