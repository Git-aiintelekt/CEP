/** The cards that open a preview: the Journey Templates panel's (Start from Scratch and the first starters), a
 * starter's in the Starter Templates pop-up, and a journey's in Your Journeys' grid view. Cards are flat with 1px
 * hairlines; the whole card is the button. */
import { AlertTriangle, ArrowRight, Plus, Zap } from 'lucide-react'

import { StatusBadge } from '@/components/StatusBadge'
import { formatDate } from '@/lib/format'
import type { Journey, JourneyStarter } from '@/lib/types'

import { triggerSentence, stepsText } from './templateMeta'
import { CategoryChip, ChannelIcons, FamilyChip, StepStrip, StepTypeStrip, TemplateKindTag, templateKind } from './TemplateParts'

const CARD = 'group flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface text-left transition-colors duration-fast ease-standard'
/** a card on the Journey Templates band: one shade lighter than the band in dark, white on blue in light */
export const BAND_CARD = 'group flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface-overlay text-left transition-colors duration-fast ease-standard'
export const ROUND_ARROW = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-ink-800 transition-colors duration-fast ease-standard group-hover:border-brand-600 group-hover:bg-brand-600 group-hover:text-on-brand group-active:border-brand-800 group-active:bg-brand-fill-pressed'

export function ScratchCard({ onClick, hint = 'Blank canvas. You choose the trigger and every step.' }: { onClick: () => void; hint?: string }) {
  return (
    <button type="button" onClick={onClick} className={`${BAND_CARD} hover:bg-surface-hover active:bg-fill-subtle`}>
      <span aria-hidden className="flex h-[88px] w-full shrink-0 items-center justify-center bg-plum-50">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-plum-100 text-plum-700">
          <Plus size={20} strokeWidth={1.5} />
        </span>
      </span>
      <span className="flex flex-1 flex-col gap-1 px-4 pt-3.5 pb-4">
        <span className="flex items-center justify-between gap-2">
          <span className="text-card-title font-semibold text-ink-900">Start from Scratch</span>
          <span aria-hidden className={ROUND_ARROW}><ArrowRight size={14} strokeWidth={1.5} /></span>
        </span>
        <span className="text-helper text-ink-800">{hint}</span>
      </span>
    </button>
  )
}

/** A starter on the blue panel: category and steps on a grey band, then its name and what starts it. */
export function PanelStarterCard({ starter, onClick }: { starter: JourneyStarter; onClick: () => void }) {
  const sentence = triggerSentence(starter.graph.entry_rules[0])
  return (
    <button type="button" onClick={onClick} aria-label={`${starter.name}, ${templateKind(starter)}`} className={`${BAND_CARD} hover:bg-surface-hover active:bg-fill-subtle`}>
      <span className="flex h-[88px] w-full shrink-0 flex-col justify-between bg-surface-subtle px-4 py-3">
        <span className="flex"><CategoryChip category={starter.category} /></span>
        <StepStrip graph={starter.graph} max={5} />
      </span>
      <span className="flex flex-1 flex-col gap-1 px-4 pt-3.5 pb-4">
        <span className="flex items-start justify-between gap-2">
          <span className="text-card-title font-semibold text-ink-900">{starter.name}</span>
          <span aria-hidden className={ROUND_ARROW}><ArrowRight size={14} strokeWidth={1.5} /></span>
        </span>
        <span className="line-clamp-2 text-helper text-ink-800" title={sentence}>{sentence}</span>
      </span>
    </button>
  )
}

const BORDERED = 'border border-line hover:border-link active:border-brand-800'

function TriggerLine({ text }: { text: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-helper text-ink-800">
      <Zap size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
      <span className="truncate" title={text}>{text}</span>
    </span>
  )
}

function StepsLine({ count, channels }: { count: number; channels: string[] }) {
  return (
    <span className="flex items-center gap-3 text-xs font-semibold text-ink-800">
      <span>{stepsText(count)}</span>
      <ChannelIcons channels={channels} />
    </span>
  )
}

export function GalleryStarterCard({ starter, onClick }: { starter: JourneyStarter; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`${starter.name}, ${templateKind(starter)}`} className={`${CARD} ${BORDERED}`}>
      <span className="flex flex-1 flex-col gap-2 p-4">
        <span className="flex flex-wrap gap-1.5"><CategoryChip category={starter.category} /><TemplateKindTag starter={starter} /></span>
        <span className="text-card-title font-semibold text-ink-900">{starter.name}</span>
        <TriggerLine text={triggerSentence(starter.graph.entry_rules[0])} />
        <span className="mt-1"><StepStrip graph={starter.graph} /></span>
        <StepsLine count={starter.step_count} channels={starter.channels} />
      </span>
      <span className="border-t border-line px-4 py-2.5 text-xs text-ink-800">
        {starter.saved ? `Saved ${formatDate(starter.saved.created_at)}${starter.saved.created_by_name ? ` by ${starter.saved.created_by_name}` : ''}` : 'Made by C360 · Never changes'}
      </span>
    </button>
  )
}

/** A journey in Your Journeys' grid view: the starter card's layout with the journey's own status and dates. */
export function JourneyCard({ journey, onClick }: { journey: Journey; onClick: () => void }) {
  const trigger = journey.entry_rule ? triggerSentence(journey.entry_rule) : 'No trigger chosen yet'
  return (
    <button type="button" onClick={onClick} data-row-key={journey.id} aria-label={journey.name} className={`${CARD} ${BORDERED}`}>
      <span className="flex flex-1 flex-col gap-2 p-4">
        <span className="flex flex-wrap items-center gap-1.5">
          <FamilyChip family={journey.trigger_family} />
          <StatusBadge status={journey.status} />
          {journey.needs_attention && (
            <span title="Needs attention: a recent campaign run failed" className="ml-auto">
              <AlertTriangle size={14} strokeWidth={1.5} aria-label="Needs attention" className="text-danger-text" />
            </span>
          )}
        </span>
        <span className="truncate text-card-title font-semibold text-ink-900" title={journey.name}>{journey.name}</span>
        <TriggerLine text={trigger} />
        <span className="mt-1"><StepTypeStrip steps={journey.step_types.map((type) => ({ type }))} /></span>
        <StepsLine count={journey.step_count} channels={journey.channels} />
      </span>
      <span className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-ink-800">
        <span className="shrink-0">Created {formatDate(journey.created_at)}</span>
        {journey.source_name && <span className="min-w-0 truncate" title={`From ${journey.source_name}`}>From {journey.source_name}</span>}
      </span>
    </button>
  )
}
