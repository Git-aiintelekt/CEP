// design-sync stub: the library only uses FieldNote from src/help/HelpPanel.tsx; the panel itself pulls Vite ?raw chapters
// esbuild can't load. FieldNote below is copied verbatim - keep it in step with HelpPanel.tsx (see NOTES.md).
import { Info } from 'lucide-react'
import { Popover } from '@/components/Popover'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

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
