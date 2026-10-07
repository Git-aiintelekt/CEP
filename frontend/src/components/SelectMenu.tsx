import { ChevronDown } from 'lucide-react'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { controlClass } from './controlStyles'
import { SingleSelectMenu, type MenuOption } from './FilterChip'
import { Popover } from './Popover'

interface SelectMenuProps<V extends string> {
  /** from Field: the label points at the trigger */
  id?: string
  describedBy?: string
  invalid?: boolean
  /** the field's name, for the trigger's and the menu's accessible names */
  label: string
  value: V | ''
  options: MenuOption<V>[]
  onChange: (value: V) => void
  /** shown in Gray 400 while nothing is chosen */
  placeholder?: string
  disabled?: boolean
}

/**
 * A form field's dropdown in the design system's look, where a native <select> would open the browser's own list:
 * a 40px trigger styled like the other fields, and the shared menu under it (Popover + SingleSelectMenu: white, hairline,
 * 6px, the menu shadow; the chosen option in Blue 100 / Blue 800). Arrow keys, Escape and a click outside come from
 * useSingleDropdown.
 */
export function SelectMenu<V extends string>({ id, describedBy, invalid = false, label, value, options, onChange, placeholder = 'Choose', disabled = false }: SelectMenuProps<V>) {
  const menus = useSingleDropdown<'menu'>()
  const open = menus.isOpen('menu')
  const chosen = options.find((option) => option.value === value)
  return (
    <div className="relative">
      <button type="button" id={id} {...menus.triggerProps('menu')} aria-haspopup="listbox" aria-label={`${label}: ${chosen?.label ?? placeholder}`}
        aria-describedby={describedBy} aria-invalid={invalid || undefined} disabled={disabled} data-select-menu
        className={`${controlClass({ invalid })} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed`}>
        <span className={`min-w-0 truncate ${chosen || disabled ? '' : 'text-ink-300'}`}>{chosen?.label ?? placeholder}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 transition-transform duration-fast ${disabled ? 'text-ink-300' : 'text-ink-800'} ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <Popover {...menus.panelProps('menu')} label={label} placement="bottom-start" className="right-0">
          <div className="max-h-72 overflow-y-auto">
            <SingleSelectMenu label={label} options={options} value={value as V} onChange={(next) => { onChange(next); menus.close() }} />
          </div>
        </Popover>
      )}
    </div>
  )
}
