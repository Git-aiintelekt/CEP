/**
 * The Tags tab in the left rail: the same list the popovers show, inline and always there.
 *
 * A row puts its tag into the text being edited on the canvas; with nothing being edited it copies the token
 * instead and says so beneath the list. Whether an insert happened is the caller's answer — this file knows
 * nothing about GrapesJS, only how to copy and what to say.
 */
import { forwardRef, useImperativeHandle, useRef, type MouseEvent as ReactMouseEvent } from 'react'

import type { PersonalizationTag } from '@/lib/types'

import { asToken } from '../tags'
import { TagPicker } from './TagPicker'

export interface TagsPanelHandle {
  focusSearch: () => void
}

export interface TagsPanelProps {
  tags: PersonalizationTag[]
  channel: string
  recent: string[]
  disabled?: boolean
  /** returns true when the tag went into the canvas; false means copy it and say so */
  onPick: (key: string) => boolean
  /** the first press inside the panel: the moment to note where the canvas caret is */
  onEngage?: () => void
  /** the token is on the clipboard: said as a toast, since the panel may not be what the reader is looking at */
  onCopied?: (token: string) => void
  onCopyFailed?: (token: string, reason: string) => void
  /** anything else the panel wants to say beneath the list */
  message?: string | null
}

export const TagsPanel = forwardRef<TagsPanelHandle, TagsPanelProps>(function TagsPanel(
  { tags, channel, recent, disabled = false, onPick, onEngage, onCopied, onCopyFailed, message },
  ref,
) {
  const root = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    focusSearch: () => root.current?.querySelector<HTMLInputElement>('input')?.focus(),
  }))

  // A press in here must not read as a press on the page beneath: the canvas ends a text edit on one. The
  // search box keeps the default, so a click still places its caret; nothing else in here needs focus.
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (!(event.target instanceof HTMLInputElement)) event.preventDefault()
    onEngage?.()
  }

  const pick = async (key: string) => {
    if (onPick(key)) return // into the text being edited: what happened is on the canvas, so nothing is said
    const token = asToken(key)
    try {
      await navigator.clipboard.writeText(token)
      onCopied?.(token)
    } catch (error) {
      onCopyFailed?.(token, error instanceof Error ? error.message : 'The clipboard is not available')
    }
  }

  return (
    <div ref={root} onMouseDown={onMouseDown} className="flex h-full min-h-0 w-full flex-col bg-surface">
      <div className="min-h-0 flex-1">
        <TagPicker
          tags={tags}
          channel={channel}
          recent={recent}
          layout="panel"
          focusSearchOnMount={false}
          disabled={disabled}
          onPick={(key) => void pick(key)}
          onClose={() => {}}
        />
      </div>
      {/* the live region outlives any one message; a copy says so as a toast, not as a strip */}
      <span role="status" aria-live="polite" className="sr-only">
        {message ?? ''}
      </span>
    </div>
  )
})
