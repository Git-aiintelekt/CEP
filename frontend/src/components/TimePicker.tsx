/**
 * A time field that lists half-hour slots in the repo's dropdown (useSingleDropdown + Popover + MenuRow): arrow keys
 * move through the slots, Escape closes and returns to the field. Values are "HH:MM" (24-hour) or '' for none.
 */
import { Clock } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'

import { HALF_HOURS, timeLabel } from '@/lib/dateValue'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { controlClass } from './controlStyles'
import { MenuRow } from './MenuRow'
import { Popover } from './Popover'

interface TimePickerProps {
  /** "HH:MM" or '' */
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  /** slots before this "HH:MM" can't be chosen (today's past times) */
  min?: string
  className?: string
}

export function TimePicker({ value, onChange, label, placeholder = 'Select Time', min, className = '' }: TimePickerProps) {
  const dropdown = useSingleDropdown<'time'>()
  const open = dropdown.isOpen('time')
  const text = timeLabel(value)
  const list = useRef<HTMLDivElement>(null)

  // open on the chosen slot, or on 9:00 AM, rather than at midnight
  useEffect(() => {
    const node = list.current
    if (!open || !node) return
    const target = node.querySelector<HTMLElement>('[aria-current="true"]') ?? (node.children[18] as HTMLElement | undefined)
    if (target) node.scrollTop = target.offsetTop - 4
  }, [open])

  // stop Escape here so a dialog around the field stays open
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    event.stopPropagation()
    dropdown.close()
  }

  return (
    <div className={`relative ${className}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        {...dropdown.triggerProps('time')}
        aria-label={`${label}, ${text || 'not set'}`}
        className={`${controlClass({ size: 'sm' })} flex items-center gap-2 text-left`}
      >
        <Clock size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-800" />
        <span className={`truncate ${text ? 'text-ink-900' : 'text-ink-300'}`}>{text || placeholder}</span>
      </button>
      {open && (
        <Popover label={label} width={176} placement="bottom-start" {...dropdown.panelProps('time')}>
          <div ref={list} className="relative max-h-60 overflow-y-auto py-1">
            {HALF_HOURS.map((slot) => (
              <MenuRow
                key={slot.value}
                title={slot.label}
                divider={false}
                selected={slot.value === value}
                disabled={min !== undefined && slot.value < min}
                onClick={() => {
                  onChange(slot.value)
                  dropdown.close()
                }}
              />
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}
