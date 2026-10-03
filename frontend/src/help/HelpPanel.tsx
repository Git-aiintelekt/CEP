/**
 * Help in the app. `PageHelp` is the icon beside a page's title: it opens the page's chapter of the User Guide in a panel at
 * the right edge, on top of the page but not blocking it, so the chapter can be read while the page is used. Escape or the
 * cross closes it and focus goes back to the icon. `FieldNote` is the small information icon beside a field's label, used by
 * the Field primitive's `help` prop: a note on that one field.
 */
import { CircleHelp, Info, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { Popover } from '@/components/Popover'
import { Spinner } from '@/components/States'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { HELP_CHAPTERS, type HelpChapter } from './chapters'
import { Markdown } from './markdown'
import { titleOf } from './markdownParse'

const ICON = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-control-md text-ink-800 transition-colors duration-fast ease-standard hover:bg-fill-subtle hover:text-ink-900'
const ICON_ON_BRAND = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-control-md text-brand-100 transition-colors duration-fast ease-standard hover:bg-brand-800 hover:text-white'

function HelpPanel({ chapter, onClose }: { chapter: HelpChapter; onClose: () => void }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const entry = HELP_CHAPTERS[chapter]

  useEffect(() => {
    let live = true
    entry.load().then((text) => { if (live) setSource(text) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [entry])
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return                  // a dialog on top owns Escape
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // mounted once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const title = (source && titleOf(source)) || entry.title
  return (
    <aside role="complementary" aria-labelledby={titleId} data-help-panel={chapter}
      className="fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l border-line bg-surface shadow-lg sm:w-[min(640px,80vw)]">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md bg-brand-100 text-brand-800"><CircleHelp size={16} strokeWidth={1.5} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-ink-800 uppercase">Help</p>
          <h2 id={titleId} className="font-display text-card-heading font-semibold text-ink-900">{title}</h2>
        </div>
        <button ref={closeRef} type="button" aria-label="Close help" onClick={onClose} className={ICON}><X size={16} strokeWidth={1.5} aria-hidden /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {failed && <p className="text-sm text-ink-800">This chapter could not be loaded. The guide is in the docs folder as docs/manuals/user-guide.</p>}
        {!failed && source === null && <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>}
        {source !== null && <Markdown source={source} skipTitle />}
      </div>
      <p className="border-t border-line px-5 py-2.5 text-xs text-ink-800">From the CEP User Guide. Press Escape to close.</p>
    </aside>
  )
}

/** the help icon beside a page's title (`onBrand` on a brand-blue band); `initiallyOpen` is for the dev playground (?help=1), so a chapter can be reviewed in place */
export function PageHelp({ chapter, initiallyOpen = false, onBrand = false }: { chapter: HelpChapter; initiallyOpen?: boolean; onBrand?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const button = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    button.current?.focus()
  }
  return (
    <>
      <button ref={button} type="button" aria-label="Help for this page" aria-expanded={open} title="Help for this page" onClick={() => setOpen((was) => !was)} className={onBrand ? ICON_ON_BRAND : ICON}>
        <CircleHelp size={18} strokeWidth={1.5} aria-hidden />
      </button>
      {open && <HelpPanel chapter={chapter} onClose={close} />}
    </>
  )
}

/** the information icon beside a field's label; `label` names the field in the icon's accessible name */
export function FieldNote({ label, text }: { label: string; text: string }) {
  const note = useSingleDropdown<'note'>()
  return (
    <span className="relative inline-flex align-middle">
      <button type="button" {...note.triggerProps('note')} data-field-note aria-label={`About ${label}`} className="flex h-5 w-5 items-center justify-center rounded-sm text-ink-800 transition-colors duration-fast ease-standard hover:bg-fill-subtle hover:text-ink-900">
        <Info size={14} strokeWidth={1.5} aria-hidden />
      </button>
      {note.isOpen('note') && (
        <Popover {...note.panelProps('note')} label={`About ${label}`} placement="bottom-start" width={300} className="px-3 py-2.5">
          <p role="note" className="text-helper leading-relaxed text-ink-800">{text}</p>
        </Popover>
      )}
    </span>
  )
}
