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
 *
 * Customer Attribute Matches (SEGMENT_CHANGE {change_trigger: ATTRIBUTE_MATCH, rule}) takes a condition rule over the
 * customer's record, and every trigger can carry Only Customers Where filters ({filters}); both are written with the
 * condition builder (conditions/ConditionBuilder.tsx) and read by apps/journeys/conditions.py.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Calendar, CalendarClock, ChevronDown, Lock, Repeat, RefreshCw, Tags, Users, Zap, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { InputGroup } from '@/components/InputGroup'
import { Field, TextArea, TextInput } from '@/components/Form'
import { controlClass } from '@/components/controlStyles'
import { Notice } from '@/components/Notice'
import { Popover } from '@/components/Popover'
import { SetupDialog } from '@/components/SetupDialog'
import { Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { useSingleDropdown } from '@/lib/useSingleDropdown'
import { ChoiceCard, ChoiceGroup } from '@/features/campaigns/parts'
import { api, ApiError } from '@/lib/api'
import { useFieldRules } from '@/lib/fieldRules'
import { FIELDS_TITLE, saveFailure } from '@/lib/saveFeedback'
import type { Audience, ConditionRule, ContactList, Journey, JourneyEntryRule, JourneyVersionDetail, Page } from '@/lib/types'

import { ConditionBuilder, MatchCount, useConditionFields } from './conditions/ConditionBuilder'
import { countConditions, emptyRule, isRuleComplete, normalizeRule, ruleProblem } from './conditions/conditionModel'

import {
  DATE_TIME_TRIGGER_GROUPS, EVENT_TRIGGER_GROUPS, SEGMENT_CHANGE_TRIGGER_GROUPS, TRIGGER_PLACEHOLDER, conditionsFromRule, dateTimeDefinition, dateTimeFromRule, dateTimeProblem,
  entryRuleFor, isAttributeMatch, needsSegment, triggerFromRule, type DateTimeChoice,
  type Reference, type TriggerGroup,
} from './entryTriggers'
import { DateTimeFields } from './DateTimeFields'
import { ENTRY_LABEL } from './SettingsSidebar'
import { entrySetupNote } from './templates/templateMeta'
import type { SetupPrefill } from './templates/prefill'

/** What Edit Setup saves (JourneyBuildPage's saveSetup). */
export interface SetupValues {
  name: string
  description: string
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
const ENTRY_TEXT: Record<EntryType, string> = {
  CUSTOMER_LIST: 'Everyone on a chosen list',
  EVENT: 'Something the customer does',
  DATE_TIME: 'On a schedule or a date field',
  SEGMENT_CHANGE: 'Joins a segment or a field changes',
}

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
      ? { name: edit.journey.name, description: edit.journey.description ?? '', entryType: trigger.entryType, triggerValue: trigger.value, triggerLabel: trigger.label, segment: trigger.segment,
          populationMode: edit.journey.population_mode, reentryPolicy: edit.journey.reentry_policy,
          reentryAfterDays: edit.journey.reentry_after_days ? String(edit.journey.reentry_after_days) : '' }
      : { name: prefill?.name ?? '', description: prefill?.description ?? '', entryType: prefill?.entryType ?? '', triggerValue: prefill?.triggerValue ?? '', triggerLabel: prefill?.triggerLabel ?? null,
          segment: triggerFromRule(prefill?.rule).segment, populationMode: prefill?.populationMode ?? '', reentryPolicy: prefill?.reentryPolicy ?? 'NEVER',
          reentryAfterDays: prefill?.reentryAfterDays ?? '' }
  })
  const locked = Boolean(edit?.published)

  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const rule = useFieldRules('journey')
  const nameMax = rule('name')?.max ?? 200
  const descriptionMax = rule('description')?.max ?? 2000
  const daysMin = Number(rule('reentry_after_days')?.min_value ?? 1)
  const daysMax = Number(rule('reentry_after_days')?.max_value ?? 3650)
  const [entryType, setEntryType] = useState<EntryType | ''>(isEntryType(initial.entryType) ? initial.entryType : '')
  const [triggerValue, setTriggerValue] = useState(initial.triggerValue)
  const [triggerLabel, setTriggerLabel] = useState<string | null>(initial.triggerLabel)
  const [segment, setSegment] = useState<Reference | null>(initial.segment)
  const [dateTime, setDateTime] = useState<DateTimeChoice>(() => dateTimeFromRule(originalRule))
  const [matchRule, setMatchRule] = useState<ConditionRule>(() => conditionsFromRule(originalRule).rule ?? emptyRule())
  const [filters, setFilters] = useState<ConditionRule>(() => conditionsFromRule(originalRule).filters ?? emptyRule())
  const fields = useConditionFields()
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
  const attributeMatch = isAttributeMatch(entryType, triggerValue)
  const matchReady = isRuleComplete(matchRule, fields.data, true)
  const filtersUsed = countConditions(filters) > 0
  const filtersOk = ruleProblem(filters, fields.data, true) === null
  const step1Ready = name.trim() !== '' && entryType !== '' && triggerValue !== '' && (!segmentNeeded || segment !== null)
    && (!timed || dateTimeProblem(triggerValue, dateTime) === null) && (!attributeMatch || matchReady) && filtersOk
  const daysOk = Number.isInteger(Number(reentryAfterDays)) && Number(reentryAfterDays) >= daysMin && Number(reentryAfterDays) <= daysMax
  const step2Ready = populationMode !== '' && (reentryPolicy !== 'AFTER_X_DAYS' || daysOk)

  /** The entry rule to save. An unchanged trigger keeps everything its rule already carried; only the segment comes
   * from the picker (a starter's "choose your segment" note is then done with). */
  /** the attribute trigger's rule and the Only Customers Where filters, as the engine reads them */
  const withConditions = (rule: JourneyEntryRule): JourneyEntryRule => {
    const definition: Record<string, unknown> = { ...rule.rule_definition }
    if (attributeMatch) definition.rule = normalizeRule(matchRule, fields.data)
    else delete definition.rule
    if (filtersUsed) definition.filters = normalizeRule(filters, fields.data)
    else delete definition.filters
    return { ...rule, rule_definition: definition }
  }

  const chosenRule = (): JourneyEntryRule => {
    if (entryType === 'DATE_TIME') return withConditions({ entry_type: 'DATE_TIME', rule_definition: dateTimeDefinition(triggerValue, dateTime) })
    const original = triggerFromRule(originalRule)
    if (originalRule && entryType === original.entryType && triggerValue === original.value) {
      const definition: Record<string, unknown> = { ...originalRule.rule_definition }
      if (segmentNeeded && segment) {
        definition.segment_id = segment.id
        definition.segment_name = segment.name ?? undefined
        delete definition.setup_note
      }
      return withConditions({ entry_type: originalRule.entry_type, rule_definition: definition })
    }
    return withConditions(entryRuleFor(entryType, triggerValue, triggerLabel ?? undefined, segmentNeeded ? segment : null))
  }

  const create = useMutation({
    mutationFn: async (): Promise<Journey | null> => {
      if (edit) {
        await edit.onSave({
          name: name.trim(),
          description: description.trim(),
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
          description: description.trim() || null,
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
  const fieldError = (field: string) => {
    const raw = problemErrors?.[field]
    return raw ? String(Array.isArray(raw) ? raw[0] : raw) : undefined
  }
  const descriptionError = fieldError('description')
  const daysError = fieldError('reentry_after_days')
  const conflict = create.error instanceof ApiError && create.error.status === 409
  // what the name, description and re-entry fields do not say themselves, in CEP's words
  const failure = create.error && !conflict ? saveFailure(create.error, edit ? 'The setup was not saved' : 'The journey was not created', ['name', 'description', 'reentry_after_days']) : null
  const genericError = failure && !(failure.title === FIELDS_TITLE && failure.general.length === 0) ? failure : null
  const refused = create.error instanceof ApiError && create.error.status === 400

  // the mockup offers Never / After X Days; Every Qualifying Event shows only when a starter already uses it
  const reentryOptions = REENTRY_OPTIONS.filter((option) => option.value !== 'EVERY_QUALIFYING_EVENT' || initial.reentryPolicy === 'EVERY_QUALIFYING_EVENT')
  const setupNote = entrySetupNote(originalRule)

  // a name clash is step 1's own field — surface it there, not behind step 2's buttons
  useEffect(() => {
    if (nameError || descriptionError) setStep(1)
  }, [nameError, descriptionError])

  return (
    <SetupDialog
      title={edit ? 'Edit Setup' : 'Create Journey'}
      steps={['Name and Entry', 'Population and Re-Entry']}
      step={step}
      onClose={onClose}
      locked={busy}
      onBack={step === 2 ? () => setStep(1) : undefined}
      primary={step === 1
        ? { label: 'Next', disabled: !step1Ready, onClick: () => setStep(2) }
        : { label: edit ? 'Save Setup' : 'Create Journey', disabled: !step2Ready, busy, busyLabel: edit ? 'Saving' : 'Creating', onClick: () => create.mutate() }}
      error={genericError ? {
        title: genericError.title,
        message: [genericError.detail, ...(genericError.title === FIELDS_TITLE ? genericError.general : [])].join(' '),
        onRetry: refused ? undefined : () => create.mutate(),
      } : null}
      banner={(prefill?.source && !edit) || locked ? (
        <>
          {prefill?.source && !edit && (
            <p data-from-template className="flex flex-wrap items-center gap-2 text-helper text-ink-800">
              <span className="inline-flex h-[22px] shrink-0 items-center rounded-sm bg-plum-100 px-2 text-xs font-semibold whitespace-nowrap text-plum-800">From Template</span>
              {prefill.sourceName} · Pre-filled. Change anything before you build.
            </p>
          )}
          {locked && (
            <Notice tone="info" layout="banner">
              <p>This journey is published, so saving starts a new draft version and customers already in it stay on theirs.</p>
            </Notice>
          )}
        </>
      ) : undefined}
    >
      {step === 1 && (
        <>
          <Field label="Journey Name" required strong error={nameError} limit={{ used: name.length, max: nameMax }}>
            {(ids) => <TextInput {...ids} value={name} maxLength={nameMax} onChange={(event) => setName(event.target.value)} placeholder="e.g. Welcome Series — New Loyalty Members" data-autofocus />}
          </Field>

          <ChoiceGroup label="What Qualifies a Customer to Enter This Journey?" required strong columns="grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
            {ENTRY_TYPES.map((type) => {
              const TypeIcon = ENTRY_ICON[type]
              return (
                <ChoiceCard key={type} tile selected={entryType === type} onSelect={() => chooseEntryType(type)} title={ENTRY_LABEL[type]} text={ENTRY_TEXT[type]}
                  icon={<TypeIcon size={20} strokeWidth={1.5} />} badge={type === 'EVENT' ? 'Most Common' : undefined} />
              )
            })}
          </ChoiceGroup>

          {entryType && (
            <Field label="Specific Trigger" required strong hint="The journey starts for a customer each time this happens.">
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

          {attributeMatch && (
            <div data-attribute-match>
              <p className="block text-sm font-semibold text-ink-900">Customer Record Matches<span className="ml-0.5 text-danger-plain" aria-hidden>*</span></p>
              <p className="mt-1.5 mb-2 text-helper text-ink-800">Customers whose record matches enter, each once; with Every Qualifying Event, again when their record changes.</p>
              <ConditionBuilder rule={matchRule} onChange={setMatchRule} lead="Enter when" readBackLead="Customers enter when" atEntry />
            </div>
          )}

          {entryType !== '' && triggerValue !== '' && (
            <div data-entry-filters>
              <p className="block text-sm font-semibold text-ink-900">Only Customers Where (Optional)</p>
              <p className="mt-1.5 mb-2 text-helper text-ink-800">Narrows who enters: a customer the trigger would admit is checked against these first.</p>
              <ConditionBuilder rule={filters} onChange={setFilters} lead="Only customers where" readBackLead="Only customers where" atEntry />
            </div>
          )}

          {(attributeMatch || filtersUsed) && (
            <MatchCount rule={attributeMatch ? matchRule : null} filters={filtersUsed ? filters : null} ready={(!attributeMatch || matchReady) && filtersOk && (attributeMatch || filtersUsed)}
              wording={attributeMatch ? 'enter' : 'match'} />
          )}

          <Field label="Description (Optional)" strong hint="What this journey is for. Shown on its details page." error={descriptionError} limit={{ used: description.length, max: descriptionMax }}>
            {(ids) => <TextArea {...ids} rows={3} maxLength={descriptionMax} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="e.g. Greets new loyalty members and walks them through their first rewards" />}
          </Field>
        </>
      )}

      {step === 2 && (
        <>
          {locked && <p className="text-sm text-ink-800">Population and re-entry can’t change on a published journey yet.</p>}
          <ChoiceGroup label="Population" required strong hint="Whether new customers can keep joining after launch." columns="grid-cols-1 sm:grid-cols-3">
            {POPULATION_OPTIONS.map((option) => (
              <ChoiceCard key={option.value} tile selected={populationMode === option.value} disabled={locked} onSelect={() => setPopulationMode(option.value)}
                title={option.title} text={option.text} icon={<option.icon size={20} strokeWidth={1.5} />} />
            ))}
          </ChoiceGroup>

          <ChoiceGroup label="Re-Entry" required strong hint="Whether the same customer can go through this journey again." columns={`grid-cols-1 ${reentryOptions.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            {reentryOptions.map((option) => (
              <ChoiceCard key={option.value} tile selected={reentryPolicy === option.value} disabled={locked} onSelect={() => setReentryPolicy(option.value)}
                title={option.title} text={option.text} icon={<option.icon size={20} strokeWidth={1.5} />} />
            ))}
          </ChoiceGroup>

          {reentryPolicy === 'AFTER_X_DAYS' && (
            <Field label="Days Before Re-Entry" required strong error={daysError ?? (reentryAfterDays !== '' && !daysOk ? `A whole number from ${daysMin.toLocaleString('en-US')} to ${daysMax.toLocaleString('en-US')}.` : undefined)}
              hint="Counted from the day the customer finished or exited.">
              {(ids) => (
                <InputGroup {...ids} type="number" min={daysMin} max={daysMax} step={1} controlSize="md" className="w-40" placeholder="e.g. 90" suffix="days" aria-label="Cooldown Days" disabled={locked}
                  value={reentryAfterDays} onChange={(event) => setReentryAfterDays(event.target.value)} />
              )}
            </Field>
          )}
        </>
      )}
    </SetupDialog>
  )
}
