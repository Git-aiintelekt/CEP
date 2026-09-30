import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { buttonClass } from './buttonStyles'
import { Checkbox } from './Checkbox'
import { InputGroup } from './InputGroup'
import { Popover } from './Popover'
import { Tooltip } from './Tooltip'

const CHIP = 'inline-flex h-10 max-w-full items-center gap-2 rounded-control-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-fast ease-standard'
const CHIP_STATE = {
  rest: 'border-line bg-surface text-ink-900 hover:bg-surface-subtle',
  active: 'border-brand-600 bg-brand-100 text-brand-800',
}

interface FilterChipProps {
  label: string
  /** a non-default value is picked: Blue 600 border, Blue 100 fill, Blue 800 text */
  active?: boolean
  /** the menu's accessible name */
  menuLabel: string
  /** px */
  menuWidth?: number
  /** the label is cut at this width (px), with the full text in a tooltip */
  maxLabelWidth?: number
  children: (menu: { close: () => void }) => ReactNode
}

/** A 40px filter trigger with a chevron; its menu opens under it, aligned to its right edge. */
export function FilterChip({ label, active = false, menuLabel, menuWidth = 280, maxLabelWidth = 220, children }: FilterChipProps) {
  const menus = useSingleDropdown<'menu'>()
  const text = useRef<HTMLSpanElement>(null)
  const open = menus.isOpen('menu')
  const cut = () => Boolean(text.current && text.current.scrollWidth > text.current.clientWidth)
  return (
    <span className="relative inline-flex max-w-full">
      <Tooltip content={label} disabled={() => open || !cut()}>
        <button type="button" {...menus.triggerProps('menu')} aria-haspopup="listbox" data-filter-chip className={`${CHIP} ${active ? CHIP_STATE.active : CHIP_STATE.rest}`}>
          <span ref={text} className="min-w-0 truncate" style={{ maxWidth: maxLabelWidth }}>{label}</span>
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 transition-transform duration-fast ${open ? 'rotate-180' : ''}`} />
        </button>
      </Tooltip>
      {open && (
        <Popover {...menus.panelProps('menu')} label={menuLabel} placement="bottom-end" width={menuWidth}>
          {children({ close: () => menus.close() })}
        </Popover>
      )}
    </span>
  )
}

export interface MenuOption<V extends string = string> {
  value: V
  label: string
}

const OPTION = 'cep-focus-inset flex min-h-9 cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors duration-fast ease-standard focus-visible:bg-surface-subtle'
const pickOnKey = (event: KeyboardEvent, pick: () => void) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    pick()
  }
}

/** One choice; picking closes the menu. The chosen option wears the Selected state (Blue 100 / Blue 800). */
export function SingleSelectMenu<V extends string>({ label, options, value, onChange }: { label: string; options: MenuOption<V>[]; value: V; onChange: (value: V) => void }) {
  const selected = useRef<HTMLLIElement>(null)
  useEffect(() => selected.current?.focus(), [])
  return (
    <ul role="listbox" aria-label={label} className="py-1">
      {options.map((option) => {
        const isSelected = option.value === value
        return (
          <li
            key={option.value}
            ref={isSelected ? selected : undefined}
            role="option"
            aria-selected={isSelected}
            tabIndex={-1}
            data-dropdown-item
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => pickOnKey(event, () => onChange(option.value))}
            className={`${OPTION} ${isSelected ? 'bg-brand-100 font-semibold text-brand-800' : 'text-ink-900 hover:bg-surface-subtle'}`}
          >
            {option.label}
          </li>
        )
      })}
    </ul>
  )
}

interface MultiSelectMenuProps {
  label: string
  options: MenuOption[]
  value: string[]
  /** called with the new selection only when Apply is pressed */
  onApply: (value: string[]) => void
  searchLabel?: string
  /** a line under the list, such as a limit on what it holds */
  note?: string
}

/** Several choices with a search: ticks are a draft until Apply; Clear empties the draft. */
export function MultiSelectMenu({ label, options, value, onApply, searchLabel = 'Search', note }: MultiSelectMenuProps) {
  const [draft, setDraft] = useState<string[]>(value)
  const [query, setQuery] = useState('')
  const shown = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))
  const toggle = (id: string) => setDraft((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  return (
    <div>
      <div className="border-b border-line-subtle p-2">
        <InputGroup tone="sunken" autoFocus aria-label={searchLabel} placeholder={`${searchLabel}…`} value={query} onChange={(event) => setQuery(event.target.value)}
          start={<Search size={16} strokeWidth={1.5} aria-hidden />} />
      </div>
      <ul role="listbox" aria-label={label} aria-multiselectable="true" className="max-h-64 overflow-y-auto py-1">
        {shown.map((option) => {
          const checked = draft.includes(option.value)
          return (
            <li key={option.value} role="option" aria-selected={checked} tabIndex={-1} data-dropdown-item
              onClick={() => toggle(option.value)} onKeyDown={(event) => pickOnKey(event, () => toggle(option.value))}
              className={`${OPTION} text-ink-900 hover:bg-surface-subtle`}>
              <Checkbox label="" checked={checked} readOnly tabIndex={-1} aria-hidden className="pointer-events-none shrink-0" />
              <span className="min-w-0 truncate">{option.label}</span>
            </li>
          )
        })}
        {shown.length === 0 && <li className="px-3 py-2 text-helper text-ink-800">Nothing matches “{query.trim()}”.</li>}
      </ul>
      {note && <p data-menu-note className="border-t border-line-subtle px-3 py-2 text-helper text-ink-800">{note}</p>}
      <div className="flex items-center justify-between gap-2 border-t border-line-subtle px-3 py-2">
        <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setDraft([])}>Clear</button>
        <button type="button" className={buttonClass({ variant: 'primary', size: 'sm' })} onClick={() => onApply(draft)}>Apply</button>
      </div>
    </div>
  )
}

/** Resets every filter; the caller shows it only while a filter is set. */
export function ClearFiltersLink({ onClick }: { onClick: () => void }) {
  return <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={onClick}>Clear Filters</button>
}
