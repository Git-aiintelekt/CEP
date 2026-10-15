/** The Journeys page's blue Journey Templates panel (an approved exception, like the Templates page's banner):
 * Start from Scratch, then the first four C360 starters, then Your Templates (the ones saved from the workspace's own journeys,
 * when there are any). At narrower widths a row scrolls rather than squashing. */
import { ArrowRight } from 'lucide-react'

import { Spinner } from '@/components/States'
import type { JourneyStarter } from '@/lib/types'

import { useSavedTemplates, useStarters } from './templateApi'
import { PanelStarterCard, ScratchCard } from './TemplateCards'

const SHOWN = 4

export function JourneyTemplatesPanel({ onScratch, onPreview, onViewMore }: {
  /** absent without journey.edit: there is no blank journey to start */
  onScratch?: () => void
  onPreview: (starter: JourneyStarter) => void
  onViewMore: () => void
}) {
  const starters = useStarters()
  const saved = useSavedTemplates()
  const yours = saved.data ?? []
  return (
    <section aria-labelledby="journey-templates-title" className="rounded-lg bg-band px-[clamp(20px,2vw,32px)] pt-6 pb-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="journey-templates-title" className="font-display text-section-title font-semibold text-on-brand">Journey Templates</h2>
          <p className="mt-1 text-sm leading-normal text-on-brand-soft">Start a journey from a blank canvas, a C360 starter or a template saved from one of your journeys. A template is copied into a new draft; the original never changes.</p>
        </div>
        <button type="button" onClick={onViewMore}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control-md bg-surface-overlay px-3 text-sm font-semibold text-link transition-colors duration-fast ease-standard hover:bg-brand-100 hover:text-link-hover active:bg-brand-100">
          View More <ArrowRight size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <ul aria-label="Start a Journey" className="mt-5 grid auto-cols-[minmax(192px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-1">
        {onScratch && <li className="min-w-0"><ScratchCard onClick={onScratch} /></li>}
        {starters.isPending && (
          <li className="flex min-h-[176px] items-center justify-center gap-2 rounded-lg bg-surface text-sm text-ink-800"><Spinner size="sm" /> Loading the starters</li>
        )}
        {starters.isError && (
          <li className="flex min-h-[176px] items-center justify-center rounded-lg bg-surface px-4 text-center text-sm text-ink-800">The starters could not be loaded.</li>
        )}
        {starters.data?.slice(0, SHOWN).map((starter) => (
          <li key={starter.key} className="min-w-0"><PanelStarterCard starter={starter} onClick={() => onPreview(starter)} /></li>
        ))}
      </ul>
      {yours.length > 0 && (
        <>
          <h3 id="your-templates-title" className="mt-6 text-sm font-semibold text-on-brand">Your Templates <span className="cep-num font-normal text-on-brand-soft">{yours.length}</span></h3>
          <ul aria-labelledby="your-templates-title" className="mt-3 grid auto-cols-[minmax(192px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-1">
            {yours.slice(0, SHOWN + 1).map((starter) => (
              <li key={starter.key} className="min-w-0"><PanelStarterCard starter={starter} onClick={() => onPreview(starter)} /></li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
