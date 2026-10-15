/** The 32px braces button beside an input, with its own popover. Disabled is a grey fill, never a fade. */
import { Braces } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { PersonalizationTag } from '@/lib/types'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { PICKER_LABEL, TagPickerPopover } from './TagPickerPopover'

export interface TagPickerButtonProps {
  tags: PersonalizationTag[]
  channel: string
  recent: string[]
  onPick: (key: string) => void
  disabled?: boolean
  /** called as the panel opens, before focus moves into it: the moment to note where the caret is */
  onOpen?: () => void
  /** `inset` is the 26px borderless button that sits inside a field */
  variant?: 'standalone' | 'inset'
  /** lets a field keep the button on screen while its picker is open */
  onOpenChange?: (open: boolean) => void
}

export function TagPickerButton({ tags, channel, recent, onPick, disabled = false, onOpen, variant = 'standalone', onOpenChange }: TagPickerButtonProps) {
  const dropdown = useSingleDropdown<'tags'>()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const trigger = dropdown.triggerProps('tags')
  const open = dropdown.isOpen('tags')
  const inset = variant === 'inset'

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  return (
    <>
      <button
        {...trigger}
        ref={(node) => {
          trigger.ref(node)
          setAnchor(node)
        }}
        type="button"
        aria-label={PICKER_LABEL}
        title={PICKER_LABEL}
        aria-disabled={disabled || undefined}
        onClick={
          disabled ? undefined : (
            () => {
              if (!dropdown.isOpen('tags')) onOpen?.()
              trigger.onClick()
            }
          )
        }
        className={
          inset ?
            `inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm transition-colors duration-base ease-standard ${
              disabled ? 'cursor-not-allowed bg-fill-subtle text-ink-300'
              : open ? 'bg-brand-100 text-link'
              : 'text-ink-800 hover:bg-fill-muted'
            }`
          : `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border transition-colors duration-base ease-standard ${
              disabled ? 'cursor-not-allowed border-line bg-fill-subtle text-ink-300'
              : open ? 'border-link bg-brand-100 text-brand-800'
              : 'border-line bg-surface text-ink-800 hover:bg-surface-hover'
            }`
        }
      >
        <Braces size={inset ? 15 : 16} strokeWidth={1.5} aria-hidden />
      </button>
      {disabled ? null : <TagPickerPopover dropdown={dropdown} id="tags" anchor={anchor} tags={tags} channel={channel} recent={recent} onPick={onPick} />}
    </>
  )
}
