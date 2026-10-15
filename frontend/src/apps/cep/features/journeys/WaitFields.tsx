/** The Wait step's panel: for a duration (as before), until a time of day in the customer's own time zone or the
 * workspace's, or until a date on the customer's record with an offset. The config it writes is what
 * apps/journeys/waits.py reads; a wait without `mode` is a duration wait. */
import { useAuth } from '@/auth/AuthContext'
import { Field, Select, TextInput } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import { formatNumber } from '@/lib/format'
import { useFieldRules } from '@/lib/fieldRules'

import { useConditionFields } from './conditions/ConditionBuilder'
import { AttributeField, TIMES } from './DateTimeFields'
import { WEEKDAYS, attributeLabel, clockText } from './entryTriggers'
import { RadioCard } from './RadioCard'

export const WAIT_UNITS = [
  { value: 'MINUTES', label: 'Minutes' },
  { value: 'HOURS', label: 'Hours' },
  { value: 'DAYS', label: 'Days' },
  { value: 'WEEKS', label: 'Weeks' },
]

export type WaitMode = 'DURATION' | 'TIME_OF_DAY' | 'DATE_ATTRIBUTE'
const MODES: { value: WaitMode; label: string }[] = [
  { value: 'DURATION', label: 'For a Duration' },
  { value: 'TIME_OF_DAY', label: 'Until a Time of Day' },
  { value: 'DATE_ATTRIBUTE', label: 'Until a Date on the Record' },
]
const OFFSETS = [-365, -180, -90, -60, -30, -21, -14, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 60, 90, 180, 365]
export const MAX_OFFSET = 365

export function waitMode(config: Record<string, unknown>): WaitMode {
  const mode = String(config.mode ?? 'DURATION').toUpperCase()
  return mode === 'TIME_OF_DAY' || mode === 'DATE_ATTRIBUTE' ? mode : 'DURATION'
}

function offsetLabel(days: number): string {
  if (days === 0) return 'On the day'
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ${days < 0 ? 'before' : 'after'}`
}

/** What a timed wait still needs before it can be saved, or null (a blank duration is left to readiness). */
export function waitProblem(config: Record<string, unknown>): string | null {
  const mode = waitMode(config)
  if (mode === 'DURATION') return null
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(config.time ?? ''))) return 'Choose a time of day.'
  if (mode === 'DATE_ATTRIBUTE') {
    if (!String(config.attribute ?? '').trim()) return 'Choose which date on the customer’s record.'
    const offset = Number(config.offset_days ?? 0)
    if (!Number.isInteger(offset) || Math.abs(offset) > MAX_OFFSET) return `A whole number of days within ${MAX_OFFSET} before or after.`
  }
  return null
}

export function isWaitConfigured(config: Record<string, unknown>): boolean {
  const mode = waitMode(config)
  if (mode === 'DURATION') return config.duration !== undefined && config.duration !== null && config.duration !== ''
  if (mode === 'TIME_OF_DAY') return waitProblem(config) === null
  return Boolean(config.attribute) && waitProblem(config) === null
}

/** "Wait until 9:00 AM, their time" / "Wait until 3 days before Renewal Date, 10:00 AM": the card's line. */
export function summarizeWait(config: Record<string, unknown>): string {
  const mode = waitMode(config)
  if (mode === 'DURATION') {
    if (config.duration === undefined || config.duration === null || config.duration === '') return 'No duration set'
    const unit = String(config.unit ?? 'DAYS').toLowerCase()
    return `Wait ${config.duration} ${Number(config.duration) === 1 ? unit.replace(/s$/, '') : unit}`
  }
  const clock = /^\d{1,2}:\d{2}$/.test(String(config.time ?? '')) ? clockText(String(config.time)) : null
  const whose = String(config.zone ?? 'CUSTOMER').toUpperCase() === 'WORKSPACE' ? 'workspace time' : 'their time'
  if (mode === 'TIME_OF_DAY') {
    if (!clock) return 'No time set'
    const days = Array.isArray(config.weekdays) ? WEEKDAYS.filter((day) => (config.weekdays as string[]).includes(day.value)) : []
    const on = days.length === 0 || days.length === 7 ? '' : ` on ${days.map((day) => day.short).join(', ')}`
    return `Wait until ${clock}${on}, ${whose}`
  }
  const attribute = String(config.attribute ?? '').trim()
  if (!attribute || !clock) return 'No date set'
  const offset = Number(config.offset_days ?? 0) || 0
  const relation = offset === 0 ? 'on' : `${Math.abs(offset)} day${Math.abs(offset) === 1 ? '' : 's'} ${offset < 0 ? 'before' : 'after'}`
  return `Wait until ${relation} ${attributeLabel(attribute)}, ${clock}`
}

/** The next moment a customer reaching the step now would continue, in `zone`, for the read-back line. */
export function nextTimeOfDay(time: string, weekdays: string[], zone: string, now = new Date()): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!match) return null
  const wanted = Number(match[1]) * 60 + Number(match[2])
  let parts: Intl.DateTimeFormat
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour12: false, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
  } catch {
    return null
  }
  const read = (at: Date) => Object.fromEntries(parts.formatToParts(at).map((part) => [part.type, part.value]))
  for (let ahead = 0; ahead < 8; ahead += 1) {
    const probe = new Date(now.getTime() + ahead * 86_400_000)
    const local = read(probe)
    const minutes = (Number(local.hour) % 24) * 60 + Number(local.minute)
    const weekday = local.weekday.slice(0, 3).toUpperCase()
    if ((ahead > 0 || minutes <= wanted) && (weekdays.length === 0 || weekdays.includes(weekday))) {
      // the moment itself: that day's wall clock at `wanted`, found by shifting the probe by the difference
      return new Date(probe.getTime() + (wanted - minutes) * 60_000)
    }
  }
  return null
}

function continuesAt(when: Date, zone: string): string {
  try {
    return when.toLocaleString('en-US', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  } catch {
    return when.toLocaleString('en-US')
  }
}

type SetFn = (patch: Record<string, unknown>) => void

function rangeError(value: unknown, min: number, max: number): string | undefined {
  if (value === '' || value === undefined || value === null) return undefined
  const number = Number(value)
  return Number.isInteger(number) && number >= min && number <= max ? undefined : `A whole number from ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}.`
}

export function WaitFields({ config, set }: { config: Record<string, unknown>; set: SetFn }) {
  const rule = useFieldRules('journey_step')
  const { me } = useAuth()
  const workspaceZone = me?.tenant.timezone || 'UTC'
  const fields = useConditionFields()
  const withZone = fields.data?.attributes.find((item) => item.key === 'attr:timezone')?.customers ?? 0
  const min = Number(rule('duration')?.min_value ?? 0)
  const max = Number(rule('duration')?.max_value ?? 999)
  const mode = waitMode(config)
  const time = String(config.time ?? '09:00')
  const times = TIMES.includes(time) ? TIMES : [...TIMES, time].sort()
  const zone = String(config.zone ?? 'CUSTOMER').toUpperCase() === 'WORKSPACE' ? 'WORKSPACE' : 'CUSTOMER'
  const weekdays = Array.isArray(config.weekdays) ? (config.weekdays as string[]) : []
  const ifPassed = String(config.if_passed ?? 'CONTINUE').toUpperCase() === 'EXIT' ? 'EXIT' : 'CONTINUE'
  const offset = Number(config.offset_days ?? 0) || 0
  const offsets = OFFSETS.includes(offset) ? OFFSETS : [...OFFSETS, offset].sort((a, b) => a - b)

  const switchMode = (next: WaitMode) => {
    if (next === mode) return
    if (next === 'DURATION') set({ mode: undefined, time: undefined, zone: undefined, weekdays: undefined, attribute: undefined, offset_days: undefined, if_passed: undefined })
    else set({ mode: next, time: config.time ?? '09:00', zone: config.zone ?? 'CUSTOMER', duration: undefined, unit: undefined })
  }

  const example = mode === 'TIME_OF_DAY' ? nextTimeOfDay(time, weekdays, workspaceZone) : null
  const zoneLine = zone === 'CUSTOMER'
    ? `From the timezone attribute on the customer’s record${fields.data ? `; ${formatNumber(withZone)} customer${withZone === 1 ? ' has' : 's have'} one` : ''}. Others use the workspace’s (${workspaceZone}).`
    : `${workspaceZone} for everyone.`

  return (
    <div className="space-y-4">
      <div>
        <p className="block text-sm font-medium text-ink-800">Wait</p>
        <div className="mt-1">
          <SegmentedControl label="How to wait" variant="solid" stretch options={MODES} value={mode} onChange={switchMode} />
        </div>
      </div>

      {mode === 'DURATION' && (
        <>
          <Field label="Duration" required error={rangeError(config.duration, min, max)}>
            {(ids) => <TextInput {...ids} type="number" min={min} max={max} step={1} value={String(config.duration ?? '')} onChange={(event) => set({ duration: event.target.value === '' ? '' : Number(event.target.value) })} />}
          </Field>
          <Field label="Unit">
            {(ids) => (
              <Select {...ids} value={String(config.unit ?? 'DAYS')} onChange={(event) => set({ unit: event.target.value })}>
                {WAIT_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
              </Select>
            )}
          </Field>
        </>
      )}

      {mode === 'DATE_ATTRIBUTE' && (
        <>
          <AttributeField value={String(config.attribute ?? '')} onPick={(attribute) => set({ attribute })} />
          <Field label="When" required>
            {(ids) => (
              <Select {...ids} value={String(offset)} onChange={(event) => set({ offset_days: Number(event.target.value) })}>
                {offsets.map((days) => <option key={days} value={days}>{offsetLabel(days)}</option>)}
              </Select>
            )}
          </Field>
        </>
      )}

      {mode !== 'DURATION' && (
        <>
          <Field label={mode === 'DATE_ATTRIBUTE' ? 'At' : 'Time'} required>
            {(ids) => (
              <Select {...ids} value={time} onChange={(event) => set({ time: event.target.value })}>
                {times.map((item) => <option key={item} value={item}>{clockText(item)}</option>)}
              </Select>
            )}
          </Field>
          <div>
            <p className="block text-sm font-medium text-ink-800">Time Zone</p>
            <div className="mt-1 space-y-2" role="radiogroup" aria-label="Time Zone">
              <RadioCard name="wait-zone" checked={zone === 'CUSTOMER'} onSelect={() => set({ zone: 'CUSTOMER' })} title="The customer’s"
                description={zone === 'CUSTOMER' ? zoneLine : 'From the timezone attribute on the customer’s record; others use the workspace’s.'} />
              <RadioCard name="wait-zone" checked={zone === 'WORKSPACE'} onSelect={() => set({ zone: 'WORKSPACE' })} title="The workspace’s"
                description={zone === 'WORKSPACE' ? zoneLine : `${workspaceZone} for everyone.`} />
            </div>
          </div>
        </>
      )}

      {mode === 'TIME_OF_DAY' && (
        <fieldset>
          <legend className="text-sm font-medium text-ink-800">On These Days</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day) => {
              const on = weekdays.includes(day.value)
              return (
                <button key={day.value} type="button" aria-pressed={on} aria-label={day.long}
                  onClick={() => set({ weekdays: on ? weekdays.filter((item) => item !== day.value) : WEEKDAYS.map((item) => item.value).filter((item) => item === day.value || weekdays.includes(item)) })}
                  className={`h-8 w-10 rounded-control-md border text-xs font-medium transition-colors duration-fast ease-standard ${
                    on ? 'border-link bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`}>
                  {day.short}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-xs text-ink-800">{weekdays.length === 0 ? 'Any day. Pick days to wait for one of them.' : 'Other days wait for the next one of these.'}</p>
        </fieldset>
      )}

      {mode === 'DATE_ATTRIBUTE' && (
        <div>
          <p className="block text-sm font-medium text-ink-800">If the Date Has Passed or Is Missing</p>
          <div className="mt-1 space-y-2" role="radiogroup" aria-label="If the Date Has Passed or Is Missing">
            <RadioCard name="wait-if-passed" checked={ifPassed === 'CONTINUE'} onSelect={() => set({ if_passed: 'CONTINUE' })} title="Continue at once" description="The customer moves to the next step." />
            <RadioCard name="wait-if-passed" checked={ifPassed === 'EXIT'} onSelect={() => set({ if_passed: 'EXIT' })} title="Exit the journey" description="Counted as exited early, with the reason." />
          </div>
        </div>
      )}

      {mode === 'TIME_OF_DAY' && (
        <p data-wait-read-back className="rounded-control-lg border border-line-subtle bg-surface-subtle px-3 py-2.5 text-sm text-ink-800">
          A customer reaching this step waits until {clockText(time)}{weekdays.length > 0 && weekdays.length < 7 ? ` on the next ${weekdays.map((value) => WEEKDAYS.find((day) => day.value === value)?.long ?? value).join(', ')}` : ''}, {zone === 'CUSTOMER' ? 'their time' : 'workspace time'}.
          {example && ` One reaching it now in ${workspaceZone} would continue ${continuesAt(example, workspaceZone)}.`}
        </p>
      )}
      {mode === 'DATE_ATTRIBUTE' && config.attribute ? (
        <p data-wait-read-back className="rounded-control-lg border border-line-subtle bg-surface-subtle px-3 py-2.5 text-sm text-ink-800">
          Each customer waits until {clockText(time)} {offset === 0 ? 'on' : `${Math.abs(offset)} day${Math.abs(offset) === 1 ? '' : 's'} ${offset < 0 ? 'before' : 'after'}`} their own {attributeLabel(String(config.attribute))}, {zone === 'CUSTOMER' ? 'their time' : 'workspace time'}.
          {ifPassed === 'EXIT' ? ' Those whose date has passed, or who have none, leave the journey.' : ' Those whose date has passed, or who have none, continue at once.'}
        </p>
      ) : null}
    </div>
  )
}
