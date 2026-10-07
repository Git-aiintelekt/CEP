/** The Sequence step's timeline: the start marker, a gap pill before each message, the message cards, and Add Message. */
import { ChevronRight, CircleAlert, CircleCheck, Clock, Copy, FilePlus, Plus, Split, CircleX, type LucideIcon } from 'lucide-react'
import { forwardRef } from 'react'

import type { DripStep } from '@/lib/types'
import { ItemTile } from '@/features/templates/preview/ItemTile'

import { templateItem } from './messageContent'
import { eyebrowOf, messageTitle, tagsOf, type CardTag, type CardTagKind, type CardTagTone, type Gap, type Series } from '../dripSequence'

const TONE: Record<CardTagTone, string> = {
  neutral: 'bg-fill-subtle text-ink-800',
  amber: 'bg-warning-bg text-warning-text',
  red: 'bg-danger-bg text-danger-text',
  plum: 'bg-plum-100 text-plum-800',
}
const ICON: Record<CardTagKind, LucideIcon> = {
  ready: CircleCheck, template: FilePlus, subject: CircleAlert, text: CircleAlert, 'same-day': CircleX, 'same-subject': Copy, ab: Split, 'own-time': Clock,
}

function CardTagChip({ tag }: { tag: CardTag }) {
  const Icon = ICON[tag.kind]
  return (
    <span data-tag={tag.kind} className={`inline-flex h-[22px] items-center gap-1 rounded-sm px-1.5 text-xs font-semibold whitespace-nowrap ${TONE[tag.tone]}`}>
      <Icon size={12} strokeWidth={1.5} aria-hidden />{tag.label}
    </span>
  )
}

export function GapPill({ gap }: { gap: Gap }) {
  return (
    <div className="flex min-h-6 flex-wrap items-center gap-3" data-gap={gap.close ? 'close' : 'normal'}>
      <span className={`cep-num inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-xs font-medium whitespace-nowrap ${gap.close ? 'border-warning bg-warning-bg text-warning-text' : 'border-line-subtle bg-fill-subtle text-ink-800'}`}>
        <Clock size={12} strokeWidth={1.5} aria-hidden />{gap.label}
      </span>
      {gap.note && <span className="text-helper text-warning-text">{gap.note}</span>}
    </div>
  )
}

/** 56 × 72: the real email scaled down, a text bubble for SMS and MMS, a dashed box while there is no template */
export function Thumbnail({ step, email, size = 'card' }: { step: DripStep; email: boolean; size?: 'card' | 'row' }) {
  const box = size === 'card' ? 'h-[72px] w-14' : 'h-[52px] w-10'
  if (!step.template) {
    return (
      <span aria-hidden data-thumb="empty" className={`flex ${box} shrink-0 items-center justify-center rounded-sm border border-dashed border-ink-300`}>
        <FilePlus size={16} strokeWidth={1.5} className="text-ink-800" />
      </span>
    )
  }
  if (email) {
    return (
      <span aria-hidden data-thumb="email" className={`block ${box} shrink-0 overflow-hidden rounded-sm border border-line-subtle bg-surface`}>
        <ItemTile item={templateItem(step.template)} height={size === 'card' ? 72 : 52} />
      </span>
    )
  }
  return (
    <span aria-hidden data-thumb="text" className={`flex ${box} shrink-0 flex-col justify-center gap-1 rounded-sm border border-line-subtle bg-surface-subtle px-1.5 py-2`}>
      <span className="flex w-full flex-col gap-[3px] rounded-[6px] rounded-bl-[2px] bg-fill-muted p-[5px]">
        <span className="h-[3px] rounded-[1px] bg-ink-300" />
        <span className="h-[3px] w-[70%] rounded-[1px] bg-ink-300" />
      </span>
      {step.template.channel === 'MMS' && size === 'card' && <span className="h-5 w-full rounded-[2px] bg-fill-muted" />}
    </span>
  )
}

interface CardProps {
  step: DripStep
  steps: DripStep[]
  series: Series
  email: boolean
  open: boolean
  /** Continue was pressed while this message still needs something */
  flagged: boolean
  onOpen: () => void
}

export const MessageCard = forwardRef<HTMLButtonElement, CardProps>(function MessageCard({ step, steps, series, email, open, flagged, onOpen }, ref) {
  const subject = step.subject_line?.trim()
  const line = email
    ? subject || (step.problems.includes('NEEDS_SUBJECT') || !step.template ? 'No subject yet' : 'Uses the template’s subject line')
    : step.text_excerpt?.trim() || 'No message text yet'
  const border = open ? 'border-brand-600 shadow-focus' : flagged ? 'border-danger hover:border-danger' : 'border-line hover:border-ink-300'
  return (
    <button ref={ref} type="button" onClick={onOpen} aria-pressed={open} aria-label={`Open message ${step.position}, ${messageTitle(step)}`} data-step-card={step.position}
      data-flagged={flagged || undefined}
      className={`grid w-full grid-cols-[minmax(0,1fr)_20px] items-center gap-4 rounded-lg border bg-surface p-4 text-left transition-colors duration-fast ease-standard hover:bg-surface-subtle md:grid-cols-[56px_minmax(0,1fr)_20px] ${border}`}>
      <span className="hidden md:block"><Thumbnail step={step} email={email} /></span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="cep-num text-xs text-ink-800">{eyebrowOf(step, steps.length, series)}</span>
        <span className="text-[15px] leading-snug font-semibold text-pretty break-words text-ink-900">{messageTitle(step)}</span>
        <span className="truncate text-sm text-ink-800">{line}</span>
        <span className="mt-1 flex flex-wrap gap-1.5">
          {tagsOf(steps, step, email).map((tag) => <CardTagChip key={tag.kind} tag={tag} />)}
        </span>
      </span>
      <ChevronRight size={20} strokeWidth={1.5} aria-hidden className="text-ink-800" />
    </button>
  )
})

export function StartMarker({ text, label = 'Start' }: { text: string; /** "Started" once a published drip has begun */ label?: string }) {
  return (
    <div className="relative flex min-h-6 items-center gap-3.5">
      <span aria-hidden className="ml-[5px] h-3.5 w-3.5 shrink-0 rounded-full border-2 border-ink-800 bg-surface" />
      <span className="cep-num text-sm text-ink-800" data-start-marker><span className="font-semibold text-ink-900">{label}</span> · {text}</span>
    </div>
  )
}

export function AddMessageButton({ full, onAdd }: { full: boolean; onAdd: () => void }) {
  const helpId = 'add-message-help'
  return (
    <div className="flex flex-col gap-2 pl-8">
      <button type="button" onClick={onAdd} disabled={full} aria-describedby={helpId}
        className="flex h-12 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-300 bg-surface text-sm font-semibold text-brand-600 transition-colors duration-fast ease-standard hover:border-brand-600 hover:bg-brand-100 disabled:cursor-not-allowed disabled:border-line disabled:bg-fill-subtle disabled:text-ink-300">
        <Plus size={16} strokeWidth={1.5} aria-hidden />Add Message
      </button>
      <p id={helpId} className="text-helper text-ink-800">
        {full ? 'This drip has 30 messages, the most it can hold. Remove one to add another.' : 'Up to 30 messages, Day 0 to Day 365. Messages always run in day order.'}
      </p>
    </div>
  )
}

