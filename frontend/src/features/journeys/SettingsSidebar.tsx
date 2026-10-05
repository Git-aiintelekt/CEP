/** Left collapsible sidebar: a read-only summary of what Setup chose for this journey; Edit Setup reopens it. */
import { ChevronRight, Settings } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { IconButton } from '@/components/Button'
import { buttonSecondary } from '@/components/Form'
import { titleize } from '@/lib/format'
import type { Journey, JourneyEntryRule } from '@/lib/types'

import { describeSchedule, referenceLabel } from './entryTriggers'

export const ENTRY_LABEL: Record<string, string> = {
  CUSTOMER_LIST: 'Customer List',
  EVENT: 'Event',
  DATE_TIME: 'Date / Time',
  SEGMENT_CHANGE: 'Segment or Customer Change',
}

/** Also used by JourneyDetailsPage's Setup card (the Trigger field) and Test Publish's approve summary: the same
 * entry-rule summary everywhere. A list or segment shows by name (referenceLabel), never by id. */
export function entrySummary(rule: JourneyEntryRule | undefined): string {
  if (!rule) return 'Not set'
  const label = ENTRY_LABEL[rule.entry_type] ?? titleize(rule.entry_type)
  const definition = rule.rule_definition as { event_type?: string; change?: string } | undefined
  const reference = referenceLabel(rule)
  let detail: string | null = null
  if (definition?.event_type) detail = titleize(definition.event_type)
  else if (rule.entry_type === 'DATE_TIME') detail = `${describeSchedule(rule.rule_definition as Record<string, unknown>, reference).when}${reference ? ` · ${reference}` : ''}`
  else if (rule.entry_type === 'SEGMENT_CHANGE' && reference) detail = `${definition?.change === 'LEFT' ? 'Exits' : 'Enters'} ${reference}`
  else detail = reference
  return detail ? `${label} · ${detail}` : label
}

function entryValue(rule: JourneyEntryRule): string {
  const definition = rule.rule_definition as { event_type?: string } | undefined
  if (definition?.event_type) return titleize(definition.event_type)
  return ENTRY_LABEL[rule.entry_type] ?? titleize(rule.entry_type)
}

const POPULATION_NOTE: Record<string, string> = {
  FIXED: 'Locked at launch, no one joins later',
  CONTINUOUSLY_QUALIFYING: 'Re-checked on a schedule, new matches join',
  EVENT_TRIGGERED: 'Enters the instant the event fires',
}

export function populationLabel(journey: Journey): string {
  return titleize(journey.population_mode)
}

export function reentryLabel(journey: Journey): string {
  return journey.reentry_policy === 'AFTER_X_DAYS' && journey.reentry_after_days ? `After ${journey.reentry_after_days} Days` : titleize(journey.reentry_policy)
}

function reentryNote(journey: Journey): string {
  switch (journey.reentry_policy) {
    case 'NEVER':
      return 'Customer can’t re-enter once done'
    case 'AFTER_X_DAYS':
      return journey.reentry_after_days ? `Eligible again after ${journey.reentry_after_days} days` : 'Eligible again after a set number of days'
    case 'EVERY_QUALIFYING_EVENT':
      return 'Re-enters every time they qualify'
    default:
      return ''
  }
}

function SettingBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-4 first:pt-1 last:border-b-0">
      <h3 className="text-xs font-semibold tracking-wide text-ink-800 uppercase">{label}</h3>
      <div className="mt-1.5 space-y-2">{children}</div>
    </section>
  )
}

function SettingValue({ value, note }: { value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold break-words text-ink-900">{value}</p>
      {note && <p className="mt-0.5 text-helper break-words text-ink-800">{note}</p>}
    </div>
  )
}

export function SettingsSidebar({ journey, entryRules, onEditSetup }: { journey: Journey; entryRules: JourneyEntryRule[]; onEditSetup: () => void }) {
  const [open, setOpen] = useState(true)

  if (!open) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center border-r border-line bg-surface pt-3">
        <IconButton label="Show Journey Settings" icon={ChevronRight} onClick={() => setOpen(true)} />
      </div>
    )
  }

  return (
    <aside aria-label="Journey Settings" className="flex w-72 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <h2 className="text-sm font-semibold text-ink-900">Journey Settings</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Hide Journey Settings" className="text-sm font-medium text-brand-600 hover:text-brand-800 hover:underline">
          Hide
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <SettingBlock label="Entry Criteria">
          {entryRules.length === 0 ? <SettingValue value="Not set" /> : entryRules.map((rule, index) => <SettingValue key={index} value={entryValue(rule)} note={entrySummary(rule)} />)}
        </SettingBlock>
        <SettingBlock label="Population Mode">
          <SettingValue value={populationLabel(journey)} note={POPULATION_NOTE[journey.population_mode]} />
        </SettingBlock>
        <SettingBlock label="Re-Entry Policy">
          <SettingValue value={reentryLabel(journey)} note={reentryNote(journey)} />
        </SettingBlock>
      </div>

      <div className="shrink-0 p-4">
        <button type="button" onClick={onEditSetup} className={`${buttonSecondary} w-full`}>
          <Settings size={16} strokeWidth={1.5} aria-hidden /> Edit Setup
        </button>
      </div>
    </aside>
  )
}
