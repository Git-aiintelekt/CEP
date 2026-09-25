/**
 * Who owns the campaign: an avatar, the name and a "Change" button that opens a people picker under the row
 * (search, then the workspace's members). Arrow keys move, Enter picks, Escape closes the picker only.
 */
import { Check, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import type { CampaignFormOptions } from '@/lib/types'

type Person = CampaignFormOptions['owners'][number]

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)![0] : '')).toUpperCase() || '?'
}

export function Avatar({ name, size = 36 }: { name: string; size?: 28 | 36 }) {
  return (
    <span aria-hidden style={{ width: size, height: size }} className={`flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800 ${size === 36 ? 'text-helper' : 'text-xs'}`}>
      {initials(name)}
    </span>
  )
}

interface OwnerPickerProps {
  value: string
  onChange: (id: string) => void
  people: Person[]
  /** the signed-in person: "auto-assigned to you" while the owner is still them */
  meId: string
  autoAssigned: boolean
  disabled?: boolean
}

export function OwnerPicker({ value, onChange, people, meId, autoAssigned, disabled = false }: OwnerPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const id = useId()
  const listId = `${id}-people`
  const searchBox = useRef<HTMLInputElement>(null)
  const changeButton = useRef<HTMLButtonElement>(null)
  const current = people.find((person) => person.id === value)
  const typed = search.trim().toLowerCase()
  const shown = [...people.filter((person) => !typed || person.name.toLowerCase().includes(typed) || person.email.toLowerCase().includes(typed)),
    ...(!typed ? [{ id: '', name: 'No Owner', email: 'Nobody answers for it yet' }] : [])]

  useEffect(() => {
    if (open) searchBox.current?.focus()
  }, [open])

  function close(refocus = true) {
    setOpen(false)
    setSearch('')
    if (refocus) changeButton.current?.focus()
  }
  function pick(person: Person) {
    onChange(person.id)
    close()
  }
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((now) => (event.key === 'ArrowDown' ? Math.min(shown.length - 1, now + 1) : Math.max(0, now - 1)))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (shown[active]) pick(shown[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation() // closes the picker, not the pop-up
      close()
    }
  }

  const name = current?.name ?? (value ? 'Someone in this workspace' : 'No Owner')
  return (
    <div className="relative" data-field="owner_user">
      <div className="flex items-center gap-3">
        <Avatar name={current?.name ?? '–'} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-ink-900" data-testid="owner-name">{name}</span>
          <span className="text-helper text-ink-500">{autoAssigned && value === meId ? 'Owner · Auto-Assigned to You' : 'Owner'}</span>
        </div>
        <button ref={changeButton} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
          onClick={() => (open ? close() : (setActive(Math.max(0, shown.findIndex((person) => person.id === value))), setOpen(true)))}
          className="shrink-0 rounded-control-sm px-1 text-sm font-semibold text-brand-800 hover:underline disabled:text-ink-300 disabled:no-underline">
          Change
        </button>
      </div>
      {open && (
        <div role="region" aria-label="Choose the owner" className="absolute top-full right-0 left-0 z-20 mt-2 overflow-hidden rounded-md border border-line bg-surface shadow-menu"
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) close(false) }}>
          <div className="border-b border-line-subtle p-2">
            <label className="flex h-9 items-center gap-2 rounded-control-md bg-surface-sunken px-2.5 focus-within:bg-surface focus-within:shadow-focus">
              <Search size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-700" />
              <input ref={searchBox} role="combobox" aria-expanded aria-controls={listId} aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                aria-label="Search workspace members" placeholder="Search workspace members" value={search}
                onChange={(event) => { setSearch(event.target.value); setActive(0) }} onKeyDown={onKey}
                className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-300" />
            </label>
          </div>
          <ul id={listId} role="listbox" aria-label="Workspace members" className="max-h-64 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-ink-500">Nobody matches “{search.trim()}”</li>}
            {shown.map((person, index) => (
              <li key={person.id || 'nobody'} id={`${listId}-${index}`} role="option" aria-selected={person.id === value}
                onMouseDown={(event) => { event.preventDefault(); pick(person) }} onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${index === active ? 'bg-surface-subtle' : ''}`}>
                <Avatar name={person.id ? person.name : '–'} size={28} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-ink-900">{person.name}</span>
                  <span className="truncate text-helper text-ink-500">{person.email}</span>
                </span>
                {person.id === value && <Check size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-brand-600" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
