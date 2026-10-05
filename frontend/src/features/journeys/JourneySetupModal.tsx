/**
 * Journey Setup (phase 6e, the last unbuilt Journey screen): a 2-step modal from JourneysPage's "Create Journey" —
 * Step 1 names the journey and picks what qualifies a customer to enter; Step 2 picks the population mode and
 * re-entry policy. "Continue to Build" creates the journey (POST /journeys/, which makes version 1 with a lone
 * Start step and no entry rule) and then saves the chosen entry rule onto that version
 * (PUT /journeys/{id}/versions/1/graph/) — the backend has no single call that takes entry rules at creation time,
 * so this is two requests, same as JourneyBuildPage's own save. Then it navigates to the Build canvas.
 *
 * Trigger catalogues (entryTriggers.ts): Event reuses 6c's trigger-family vocabulary; Customer List is pulled live
 * from GET /contact-lists/, not hardcoded.
 *
 * Use This Template opens it pre-filled (templates/prefill.ts): POST /journeys/ then also names the starter, so
 * version 1 is a copy of its steps, and the PUT replaces only the entry rule with what Setup chose.
 *
 * Edit Setup (Build's sidebar and Back to Setup) opens the same pop-up filled from the journey (`edit`); saving is
 * the caller's job (JourneyBuildPage: PATCH the journey, PUT the draft's entry rule). On a published journey saving
 * starts a new draft version, and population and re-entry stay locked: they live on the journey, not on a version,
 * so changing them would change the live journey in place.
 *
 * Enters Segment / Exits Segment also need a Segment (GET /contact-lists/audiences/), saved as segment_id — what
 * apps/journeys/engine/enroll.py reads.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Calendar, CalendarClock, ChevronDown, Lock, Repeat, RefreshCw, Tags, Users, Zap, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { InputGroup } from '@/components/InputGroup'
import { Modal } from '@/components/Modal'
import { Field, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { controlClass } from '@/components/controlStyles'
import { Notice } from '@/components/Notice'
import { Popover } from '@/components/Popover'
import { Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { useSingleDropdown } from '@/lib/useSingleDropdown'
import { api, ApiError } from '@/lib/api'
import type { Audience, ContactList, Journey, JourneyEntryRule, JourneyVersionDetail, Page } from '@/lib/types'

import {
  DATE_TIME_TRIGGER_GROUPS, EVENT_TRIGGER_GROUPS, SEGMENT_CHANGE_TRIGGER_GROUPS, TRIGGER_PLACEHOLDER, dateTimeDefinition, dateTimeFromRule, dateTimeProblem,
  entryRuleFor, needsSegment, triggerFromRule, type DateTimeChoice,
  type Reference, type TriggerGroup,
} from './entryTriggers'
import { DateTimeFields } from './DateTimeFields'
import { ENTRY_LABEL } from './SettingsSidebar'
import { entrySetupNote } from './templates/templateMeta'
import type { SetupPrefill } from './templates/prefill'

/** What Edit Setup saves (JourneyBuildPage's saveSetup). */
export interface SetupValues {
  name: string
  populationMode: string
  reentryPolicy: string
  reentryAfterDays: number | null
  rule: JourneyEntryRule
}

export interface SetupEdit {
  journey: Journey
  /** the version's first entry rule, as it is now */
  rule: JourneyEntryRule | undefined
  /** the version on the canvas is published: saving starts a new draft version, and population/re-entry stay locked */
  published: boolean
  onSave: (values: SetupValues) => Promise<void>
}

type EntryType = 'CUSTOMER_LIST' | 'EVENT' | 'DATE_TIME' | 'SEGMENT_CHANGE'
const ENTRY_TYPES: EntryType[] = ['CUSTOMER_LIST', 'EVENT', 'DATE_TIME', 'SEGMENT_CHANGE']
const ENTRY_ICON: Record<EntryType, LucideIcon> = { CUSTOMER_LIST: Users, EVENT: Zap, DATE_TIME: Calendar, SEGMENT_CHANGE: Tags }

type PopulationMode = 'FIXED' | 'CONTINUOUSLY_QUALIFYING' | 'EVENT_TRIGGERED'
const POPULATION_OPTIONS: { value: PopulationMode; icon: LucideIcon; title: string; text: string }[] = [
  { value: 'FIXED', icon: Lock, title: 'Fixed', text: 'Population is locked at launch. No one joins later.' },
  { value: 'CONTINUOUSLY_QUALIFYING', icon: RefreshCw, title: 'Continuously Qualifying', text: 'Re-evaluated on a schedule; new matches join.' },
  { value: 'EVENT_TRIGGERED', icon: Zap, title: 'Event Triggered', text: 'Customers enter the moment the event fires.' },
]

type ReentryPolicy = 'NEVER' | 'AFTER_X_DAYS' | 'EVERY_QUALIFYING_EVENT'
// Every Qualifying Event is a real re-entry policy (Journey.ReentryPolicy) that two CEP starters use, so Setup offers it too
const REENTRY_OPTIONS: { value: ReentryPolicy; icon: LucideIcon; title: string; text: string }[] = [
  { value: 'NEVER', icon: Ban, title: 'Never', text: "Once a customer completes or exits, they can't re-enter." },
  { value: 'AFTER_X_DAYS', icon: CalendarClock, title: 'After X Days', text: 'Customer becomes eligible again after a cooldown period.' },
  { value: 'EVERY_QUALIFYING_EVENT', icon: Repeat, title: 'Every Qualifying Event', text: 'Customer enters again each time the trigger happens.' },
]

/** A selectable card for Step 2: icon + title on one row, the explanation beneath; the radio itself is visually hidden. */
function ChoiceCard({ name, option, checked, onPick, disabled = false, children }: { name: string; option: { value: string; icon: LucideIcon; title: string; text: string }; checked: boolean; onPick: () => void; disabled?: boolean; children?: ReactNode }) {
  const look = checked ? 'border-brand-600 bg-callout-bg' : disabled ? 'border-line bg-fill-subtle' : 'border-line hover:border-line-control'
  return (
    <label className={`flex h-full flex-col rounded-lg border p-4 transition-colors duration-fast ease-standard focus-within:ring-2 focus-within:ring-brand-600 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} ${look}`}>
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onPick} disabled={disabled} />
      <span className="flex items-center gap-2">
        <option.icon size={18} strokeWidth={1.5} aria-hidden className={`shrink-0 ${checked ? 'text-brand-600' : 'text-ink-800'}`} />
        <span className="font-semibold text-ink-900">{option.title}</span>
      </span>
      <span className="mt-1 text-sm text-ink-800">{option.text}</span>
      {children}
    </label>
  )
}

function StepProgress({ step }: { step: 1 | 2 }) {
  return (
    <div role="progressbar" aria-label="Setup Progress" aria-valuemin={1} aria-valuemax={2} aria-valuenow={step} className="flex gap-1.5 px-4 py-2 sm:px-6">
      {[1, 2].map((segment) => <span key={segment} aria-hidden className={`h-1 flex-1 rounded-full ${segment <= step ? 'bg-brand-600' : 'bg-fill-muted'}`} />)}
    </div>
  )
}

function DropdownOption({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" data-dropdown-item onClick={onPick}
      className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors duration-fast ease-standard ${selected ? 'bg-brand-100 font-semibold text-brand-800' : 'text-ink-900 hover:bg-surface-subtle'}`}>
      {label}
    </button>
  )
}

/** The grouped dropdown for Event / Date-Time / Segment-change: a static catalogue, grouped by family. */
function TriggerDropdown({ entryType, groups, value, label, onPick }: {
  entryType: EntryType; groups: TriggerGroup[]; value: string; label: string | null; onPick: (value: string, label: string) => void
}) {
  const dropdown = useSingleDropdown<'trigger'>()
  const open = dropdown.isOpen('trigger')
  const placeholder = TRIGGER_PLACEHOLDER[entryType]
  return (
    <div className="relative">
      <button type="button" {...dropdown.triggerProps('trigger')} className={`${controlClass()} flex items-center justify-between gap-2 text-left`}>
        <span className={`truncate ${label ? 'text-ink-900' : 'text-ink-300'}`}>{label ?? placeholder}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 text-ink-800 transition-transform duration-fast ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <Popover {...dropdown.panelProps('trigger')} label={placeholder} placement="bottom-start" width={320}>
          <div className="max-h-72 overflow-y-auto py-1">
            {groups.map((group) => (
              <div key={group.key}>
                <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-ink-800 uppercase">{group.label}</p>
                {group.options.map((option) => (
                  <DropdownOption key={option.value} label={option.label} selected={value === option.value}
                    onPick={() => { onPick(option.value, option.label); dropdown.close() }} />
                ))}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}

/** Customer List's dropdown: Uploaded / Synced, pulled live from GET /contact-lists/ rather than hardcoded. */
function CustomerListDropdown({ value, label, onPick }: { value: string; label: string | null; onPick: (value: string, label: string) => void }) {
  const dropdown = useSingleDropdown<'lists'>()
  const open = dropdown.isOpen('lists')
  const lists = useQuery({
    queryKey: ['contact-lists', 'journey-setup-options'],
    queryFn: ({ signal }) => api.get<Page<ContactList>>('/contact-lists/', { page_size: 200 }, signal),
    enabled: open,
  })
  const rows = lists.data?.results ?? []
  const uploaded = rows.filter((item) => item.source_type === 'UPLOAD')
  const synced = rows.filter((item) => item.source_type !== 'UPLOAD')
  const placeholder = TRIGGER_PLACEHOLDER.CUSTOMER_LIST
  return (
    <div className="relative">
      <button type="button" {...dropdown.triggerProps('lists')} className={`${controlClass()} flex items-center justify-between gap-2 text-left`}>
        <span className={`truncate ${label ? 'text-ink-900' : 'text-ink-300'}`}>{label ?? placeholder}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 text-ink-800 transition-transform duration-fast ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <Popover {...dropdown.panelProps('lists')} label={placeholder} placement="bottom-start" width={320}>
          <div className="max-h-72 overflow-y-auto py-1">
            {lists.isPending && <p className="flex items-center gap-2 px-3 py-2 text-sm text-ink-800"><Spinner size="sm" /> Loading Contact Lists</p>}
            {lists.isError && <p className="px-3 py-2 text-sm text-danger-text">Couldn’t load contact lists.</p>}
            {!lists.isPending && !lists.isError && rows.length === 0 && <p className="px-3 py-2 text-sm text-ink-800">No contact lists yet.</p>}
            {!lists.isPending && !lists.isError && uploaded.length > 0 && (
              <div>
                <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-ink-800 uppercase">Uploaded Lists</p>
                {uploaded.map((item) => (
                  <DropdownOption key={item.id} label={item.name} selected={value === item.id} onPick={() => { onPick(item.id, item.name); dropdown.close() }} />
                ))}
              </div>
            )}
            {!lists.isPending && !lists.isError && synced.length > 0 && (
              <div>
                <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-ink-800 uppercase">Synced Lists</p>
                {synced.map((item) => (
                  <DropdownOption key={item.id} label={item.name} selected={value === item.id} onPick={() => { onPick(item.id, item.name); dropdown.close() }} />
                ))}
              </div>
            )}
          </div>
        </Popover>
      )}
    </div>
  )
}

/** Enters / Exits Segment's Segment picker: the workspace's C360 segments (GET /contact-lists/audiences/), the same
 * source the canvas's segment steps use. */
function SegmentDropdown({ value, onPick }: { value: Reference | null; onPick: (segment: Reference) => void }) {
  const dropdown = useSingleDropdown<'segments'>()
  const open = dropdown.isOpen('segments')
  const segments = useQuery({
    queryKey: ['audiences', 'options'],
    queryFn: ({ signal }) => api.get<Audience[]>('/contact-lists/audiences/', undefined, signal),
    enabled: open,
  })
  const rows = segments.data ?? []
  const placeholder = 'Select a Segment'
  return (
    <div className="relative">
      <button type="button" {...dropdown.triggerProps('segments')} className={`${controlClass()} flex items-center justify-between gap-2 text-left`}>
        <span className={`truncate ${value ? 'text-ink-900' : 'text-ink-300'}`}>{value ? value.name ?? 'Unknown segment' : placeholder}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 text-ink-800 transition-transform duration-fast ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <Popover {...dropdown.panelProps('segments')} label={placeholder} placement="bottom-start" width={320}>
          <div className="max-h-72 overflow-y-auto py-1">
            {segments.isPending && <p className="flex items-center gap-2 px-3 py-2 text-sm text-ink-800"><Spinner size="sm" /> Loading Segments</p>}
            {segments.isError && <p className="px-3 py-2 text-sm text-danger-text">Couldn’t load segments.</p>}
            {!segments.isPending && !segments.isError && rows.length === 0 && <p className="px-3 py-2 text-sm text-ink-800">No segments yet.</p>}
            {!segments.isPending && !segments.isError && rows.map((item) => (
              <DropdownOption key={item.id} label={item.name} selected={value?.id === item.id} onPick={() => { onPick({ id: item.id, name: item.name }); dropdown.close() }} />
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}

function groupsFor(entryType: EntryType): TriggerGroup[] {
  if (entryType === 'DATE_TIME') return DATE_TIME_TRIGGER_GROUPS
  if (entryType === 'SEGMENT_CHANGE') return SEGMENT_CHANGE_TRIGGER_GROUPS
  return EVENT_TRIGGER_GROUPS
}

function isEntryType(value: string): value is EntryType {
  return (ENTRY_TYPES as string[]).includes(value)
}

export function JourneySetupModal({ onClose, prefill, edit }: { onClose: () => void; prefill?: SetupPrefill; edit?: SetupEdit }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const createdId = useRef<string | null>(null)

  // what the pop-up starts from: a starter's pre-fill, or (Edit Setup) the journey as it is now
  const originalRule = edit ? edit.rule : prefill?.rule
  const [initial] = useState(() => {
    const trigger = triggerFromRule(edit?.rule)
    return edit
      ? { name: edit.journey.name, entryType: trigger.entryType, triggerValue: trigger.value, triggerLabel: trigger.label, segment: trigger.segment,
          populationMode: edit.journey.population_mode, reentryPolicy: edit.journey.reentry_policy,
          reentryAfterDays: edit.journey.reentry_after_days ? String(edit.journey.reentry_after_days) : '' }
      : { name: prefill?.name ?? '', entryType: prefill?.entryType ?? '', triggerValue: prefill?.triggerValue ?? '', triggerLabel: prefill?.triggerLabel ?? null,
          segment: triggerFromRule(prefill?.rule).segment, populationMode: prefill?.populationMode ?? '', reentryPolicy: prefill?.reentryPolicy ?? 'NEVER',
          reentryAfterDays: prefill?.reentryAfterDays ?? '' }
  })
  const locked = Boolean(edit?.published)

  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState(initial.name)
  const [entryType, setEntryType] = useState<EntryType | ''>(isEntryType(initial.entryType) ? initial.entryType : '')
  const [triggerValue, setTriggerValue] = useState(initial.triggerValue)
  const [triggerLabel, setTriggerLabel] = useState<string | null>(initial.triggerLabel)
  const [segment, setSegment] = useState<Reference | null>(initial.segment)
  const [dateTime, setDateTime] = useState<DateTimeChoice>(() => dateTimeFromRule(originalRule))
  const [populationMode, setPopulationMode] = useState<PopulationMode | ''>(initial.populationMode as PopulationMode | '')
  const [reentryPolicy, setReentryPolicy] = useState<ReentryPolicy>(initial.reentryPolicy as ReentryPolicy)
  const [reentryAfterDays, setReentryAfterDays] = useState(initial.reentryAfterDays)

  const chooseEntryType = (next: EntryType) => {
    setEntryType(next)
    setTriggerValue('')
    setTriggerLabel(null)
    setSegment(null)
  }

  const chooseTrigger = (value: string, label: string) => {
    setTriggerValue(value)
    setTriggerLabel(label)
    if (!needsSegment(entryType, value)) setSegment(null)
  }

  const segmentNeeded = needsSegment(entryType, triggerValue)
  const timed = entryType === 'DATE_TIME' && triggerValue !== ''
  const step1Ready = name.trim() !== '' && entryType !== '' && triggerValue !== '' && (!segmentNeeded || segment !== null)
    && (!timed || dateTimeProblem(triggerValue, dateTime) === null)
  const step2Ready = populationMode !== '' && (reentryPolicy !== 'AFTER_X_DAYS' || Number(reentryAfterDays) > 0)

  /** The entry rule to save. An unchanged trigger keeps everything its rule already carried; only the segment comes
   * from the picker (a starter's "choose your segment" note is then done with). */
  const chosenRule = (): JourneyEntryRule => {
    if (entryType === 'DATE_TIME') return { entry_type: 'DATE_TIME', rule_definition: dateTimeDefinition(triggerValue, dateTime) }
    const original = triggerFromRule(originalRule)
    if (originalRule && entryType === original.entryType && triggerValue === original.value) {
      const definition: Record<string, unknown> = { ...originalRule.rule_definition }
      if (segmentNeeded && segment) {
        definition.segment_id = segment.id
        definition.segment_name = segment.name ?? undefined
        delete definition.setup_note
      }
      return { entry_type: originalRule.entry_type, rule_definition: definition }
    }
    return entryRuleFor(entryType, triggerValue, triggerLabel ?? undefined, segmentNeeded ? segment : null)
  }

  const create = useMutation({
    mutationFn: async (): Promise<Journey | null> => {
      if (edit) {
        await edit.onSave({
          name: name.trim(),
          populationMode,
          reentryPolicy,
          reentryAfterDays: reentryPolicy === 'AFTER_X_DAYS' ? Number(reentryAfterDays) : null,
          rule: chosenRule(),
        })
        return null
      }
      let journey: Journey
      if (createdId.current) {
        journey = await api.get<Journey>(`/journeys/${createdId.current}/`)
      } else {
        journey = await api.post<Journey>('/journeys/', {
          name: name.trim(),
          population_mode: populationMode,
          reentry_policy: reentryPolicy,
          reentry_after_days: reentryPolicy === 'AFTER_X_DAYS' ? Number(reentryAfterDays) : null,
          ...prefill?.source,
        })
        createdId.current = journey.id
      }
      // version 1 already holds the template's steps; only the entry rule comes from Setup
      const detail = await api.get<JourneyVersionDetail>(`/journeys/${journey.id}/versions/1/`)
      await api.put(`/journeys/${journey.id}/versions/1/graph/`, { row_version: detail.row_version, graph: { ...detail.graph, entry_rules: [chosenRule()] } })
      return journey
    },
    onSuccess: (journey) => {
      void queryClient.invalidateQueries({ queryKey: ['journeys'], refetchType: 'none' })
      if (journey) navigate(`/journeys/${journey.id}/build`)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) toast.error('Someone else saved this journey', error.message, { durationMs: 0 })
    },
  })

  const busy = create.isPending
  const problemErrors = create.error instanceof ApiError && create.error.status === 400 ? create.error.problem.errors : undefined
  const nameErrorRaw = problemErrors?.name
  const nameError = nameErrorRaw ? String(Array.isArray(nameErrorRaw) ? nameErrorRaw[0] : nameErrorRaw) : undefined
  const conflict = create.error instanceof ApiError && create.error.status === 409
  const genericError = create.error && !nameError && !conflict
    ? create.error instanceof ApiError ? create.error.message : 'Something went wrong on our side. Your entries are kept, so try again.'
    : null

  const close = () => { if (!busy) onClose() }
  // the mockup offers Never / After X Days; Every Qualifying Event shows only when a starter already uses it
  const reentryOptions = REENTRY_OPTIONS.filter((option) => option.value !== 'EVERY_QUALIFYING_EVENT' || initial.reentryPolicy === 'EVERY_QUALIFYING_EVENT')
  const setupNote = entrySetupNote(originalRule)

  // a name clash is step 1's own field — surface it there, not behind step 2's buttons
  useEffect(() => {
    if (nameError) setStep(1)
  }, [nameError])

  return (
    <Modal
      title={edit ? 'Edit Setup' : 'Create A Journey'}
      badge={<p className="-mb-2 text-sm font-medium text-ink-800">Step {step} of 2</p>}
      subtitle={step === 1 ? 'Name and entry' : 'Population and re-entry'}
      onClose={close}
      size="lg"
      toolbar={<StepProgress step={step} />}
      headerExtra={prefill && !edit && (
        <>
          <span className="inline-flex h-[22px] shrink-0 items-center rounded-sm bg-plum-100 px-2 text-xs font-semibold whitespace-nowrap text-plum-800">From Template</span>
          <span className="text-helper text-ink-800">{prefill.sourceName} · Pre-filled. Change anything before you build.</span>
        </>
      )}
      footer={
        step === 1 ? (
          <>
            <button type="button" className={buttonSecondary} onClick={close}>Cancel</button>
            <button type="button" className={buttonPrimary} disabled={!step1Ready} onClick={() => setStep(2)}>Next →</button>
          </>
        ) : (
          <>
            <button type="button" className={buttonSecondary} onClick={() => setStep(1)} disabled={busy}>Back</button>
            <button type="button" className={buttonPrimary} disabled={!step2Ready || busy} onClick={() => create.mutate()}>
              {busy && <Spinner size="sm" tone="onBrand" />} {edit ? 'Save Setup' : 'Continue to Build'}
            </button>
          </>
        )
      }
    >
      {genericError && (
        <Notice tone="error" layout="banner" title={edit ? 'Couldn’t Save Setup' : 'Couldn’t Create This Journey'} action={<button type="button" className={buttonSecondary} onClick={() => create.mutate()}>Try Again</button>}>
          <p>{genericError}</p>
        </Notice>
      )}

      {locked && (
        <Notice tone="info" layout="banner">
          <p>This journey is published, so saving starts a new draft version and customers already in it stay on theirs.</p>
        </Notice>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <Field label="Journey Name" required strong error={nameError}>
            {(ids) => <TextInput {...ids} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Welcome Series — New Loyalty Members" data-autofocus />}
          </Field>

          <div>
            <p className="text-sm font-semibold text-ink-900">What Qualifies a Customer to Enter This Journey?</p>
            <div role="radiogroup" aria-label="Entry Type" className="mt-1.5 flex flex-wrap gap-2">
              {ENTRY_TYPES.map((type) => {
                const TypeIcon = ENTRY_ICON[type]
                const selected = entryType === type
                return (
                  <button key={type} type="button" role="radio" aria-checked={selected} onClick={() => chooseEntryType(type)}
                    className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-fast ease-standard ${
                      selected ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-subtle'}`}>
                    <TypeIcon size={14} strokeWidth={1.5} aria-hidden />
                    {ENTRY_LABEL[type]}
                  </button>
                )
              })}
            </div>
          </div>

          {entryType && (
            <Field label="Specific Trigger" strong>
              {() => entryType === 'CUSTOMER_LIST'
                ? <CustomerListDropdown value={triggerValue} label={triggerLabel} onPick={(value, label) => { setTriggerValue(value); setTriggerLabel(label) }} />
                : <TriggerDropdown entryType={entryType} groups={groupsFor(entryType)} value={triggerValue} label={triggerLabel} onPick={chooseTrigger} />}
            </Field>
          )}

          {timed && <DateTimeFields schedule={triggerValue} value={dateTime} onChange={setDateTime} />}

          {segmentNeeded && (
            <Field label="Segment" required strong hint={segment ? undefined : setupNote ?? 'Customers enter when they join or leave this segment.'}>
              {() => <SegmentDropdown value={segment} onPick={setSegment} />}
            </Field>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          {locked && <p className="text-sm text-ink-800">Population and re-entry can’t change on a published journey yet.</p>}
          <div>
            <p className="text-sm font-semibold text-ink-900">Should new customers keep flowing in over time?</p>
            <div role="radiogroup" aria-label="Population Mode" className="mt-3 grid gap-3 sm:grid-cols-3">
              {POPULATION_OPTIONS.map((option) => (
                <ChoiceCard key={option.value} name="population-mode" option={option} checked={populationMode === option.value} disabled={locked} onPick={() => setPopulationMode(option.value)} />
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-ink-900">Can the same customer go through this journey again?</p>
            <div role="radiogroup" aria-label="Re-Entry Policy" className={`mt-3 grid items-start gap-3 ${reentryOptions.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              {reentryOptions.map((option) => (
                <ChoiceCard key={option.value} name="reentry-policy" option={option} checked={reentryPolicy === option.value} disabled={locked} onPick={() => setReentryPolicy(option.value)}>
                  {option.value === 'AFTER_X_DAYS' && reentryPolicy === 'AFTER_X_DAYS' && (
                    <InputGroup type="number" min={1} controlSize="md" className="mt-3 w-full" placeholder="e.g. 90" suffix="days" aria-label="Cooldown Days" disabled={locked}
                      value={reentryAfterDays} onChange={(event) => setReentryAfterDays(event.target.value)} />
                  )}
                </ChoiceCard>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
