/**
 * A plain textarea for code, with a line-number column that scrolls with it. No wrapping, so a line number always
 * names one line of the code, and no spellcheck, which would underline every tag.
 *
 * The system monospace is used for code only: the design system has no monospace of its own (see the report's
 * design-system exceptions). View code already used it.
 */
import { useImperativeHandle, useMemo, useRef, type Ref } from 'react'

export interface CodeEditorHandle {
  /** puts the caret at the start of a 1-based line and brings it into view */
  goToLine: (line: number) => void
}

interface CodeEditorProps {
  ref?: Ref<CodeEditorHandle>
  label: string
  value: string
  onChange: (value: string) => void
  describedBy?: string
  invalid?: boolean
}

/** Shared by the textarea and the numbers, so line 40 of one is line 40 of the other. */
const TEXT = 'font-mono text-xs leading-5'
const LINE_HEIGHT = 20

export function CodeEditor({ ref, label, value, onChange, describedBy, invalid = false }: CodeEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null)
  const gutter = useRef<HTMLDivElement>(null)
  const lines = useMemo(() => value.split('\n').length, [value])

  useImperativeHandle(ref, () => ({
    goToLine: (line) => {
      const textarea = area.current
      if (!textarea) return
      const starts = textarea.value.split('\n')
      const target = Math.min(Math.max(1, line), starts.length)
      const offset = starts.slice(0, target - 1).reduce((sum, text) => sum + text.length + 1, 0)
      textarea.focus()
      textarea.setSelectionRange(offset, offset)
      // a few lines of context above the one being pointed at
      textarea.scrollTop = Math.max(0, (target - 4) * LINE_HEIGHT)
    },
  }))

  return (
    // the focus ring sits on the frame: the textarea fills it edge to edge, so its own outline would be clipped
    <div className={`flex max-h-[50vh] min-h-64 overflow-hidden rounded-lg border bg-surface focus-within:border-brand-600 focus-within:shadow-focus ${invalid ? 'border-danger' : 'border-line'}`}>
      <div ref={gutter} aria-hidden className={`${TEXT} shrink-0 overflow-hidden border-r border-line bg-surface-subtle pt-3 pr-2 pb-8 pl-3 text-right text-ink-500 select-none`}>
        {Array.from({ length: lines }, (_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </div>
      <textarea
        ref={area}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop
        }}
        className={`${TEXT} min-w-0 flex-1 resize-none overflow-auto bg-surface px-3 py-3 whitespace-pre text-ink-900 outline-none`}
      />
    </div>
  )
}
