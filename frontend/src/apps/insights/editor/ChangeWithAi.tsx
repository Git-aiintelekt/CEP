/**
 * The editor bar's Change With AI button: it opens Change with a Prompt under it. The prompt stays mounted while closed,
 * so Undo still puts the last change back after the panel is shut. Shown only when the assistant is on.
 */
import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { buttonSecondary } from '@/components/Form'
import { useAssistant } from '../api'
import type { ReportDefinition } from '../types'
import { ChangeWithPrompt } from './ChangeWithPrompt'

export function ChangeWithAi({ dataset, definition, onChange }: { dataset: string; definition: ReportDefinition; onChange: (next: ReportDefinition) => void }) {
  const assistant = useAssistant()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  if (!assistant.data?.enabled) return null
  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} className={buttonSecondary} onClick={() => setOpen((now) => !now)}>
        <Sparkles size={16} strokeWidth={1.5} aria-hidden />Change With AI
      </button>
      <div hidden={!open} className="absolute right-0 z-30 mt-1 w-[480px] max-w-[calc(100vw-2rem)] rounded-md border border-line bg-surface-overlay p-3 shadow-menu">
        <ChangeWithPrompt dataset={dataset} definition={definition} onChange={onChange} />
      </div>
    </div>
  )
}
