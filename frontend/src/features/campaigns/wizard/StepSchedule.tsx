/**
 * Step 4: when the campaign goes out and how it is delivered. Times are wall-clock times in the campaign's time
 * zone. A recurring or drip campaign stays ONE campaign: every occurrence or step becomes a run of it (BRD 7).
 */
import { Plus, Trash2 } from 'lucide-react'
import { useFieldArray, useFormContext } from 'react-hook-form'

import { buttonSecondary, Field, Select, TextInput } from '@/components/Form'
import type { CampaignFormOptions } from '@/lib/types'

import { CheckRow, ChoiceCard, ChoiceGroup, Panel } from '../parts'
import type { CampaignFormValues } from '../schema'
import { SEND_TYPES, WEEKDAYS } from '../vocabulary'
import { formatInZone, zonedToIso } from '../zone'

export function StepSchedule({ options, workspaceZone, onChangeType }: { options: CampaignFormOptions | undefined; workspaceZone: string; onChangeType?: () => void }) {
  const { register, control, watch, setValue, formState: { errors } } = useFormContext<CampaignFormValues>()
  const steps = useFieldArray({ control, name: 'drip.steps' })
  const type = watch('campaign_type')
  const sendType = watch('send_type')
  const zone = watch('send_timezone') || workspaceZone
  const scheduledAt = watch('scheduled_at')
  const recurring = watch('recurring')
  const marketing = watch('solicitation_type') === 'MARKETING'
  const texts = ['SMS', 'MMS'].includes(watch('channel'))
  const touch = { shouldDirty: true, shouldValidate: true }

  if (type === 'E_RECEIPT') {
    return (
      <Panel title="This is an E-Receipt campaign, so there is no schedule to set">
        <p className="max-w-3xl text-sm text-ink-700">Once the campaign is published, each receipt goes out when the point of sale or the web shop asks for it. A send time, a recurrence or a series belongs to the other campaign types.</p>
        <p className="mt-4 flex flex-wrap items-center gap-3">
          {onChangeType && <button type="button" className={buttonSecondary} onClick={onChangeType}>Change the Campaign Type</button>}
          <span className="text-sm text-ink-500">Keeping E-Receipt: continue to the next step.</span>
        </p>
      </Panel>
    )
  }

  const isDrip = type === 'DRIP'
  const choices = SEND_TYPES.filter((item) => (isDrip ? item.value === 'DRIP' : item.value !== 'DRIP'))
  const zones = options?.timezones ?? [zone]
  const stepsError = errors.drip?.steps?.message ?? errors.drip?.steps?.root?.message

  function toggleDay(day: string) {
    setValue('recurring.weekdays', recurring.weekdays.includes(day) ? recurring.weekdays.filter((item) => item !== day) : WEEKDAYS.map((item) => item.value).filter((item) => item === day || recurring.weekdays.includes(item)), touch)
  }

  return (
    <div className="space-y-5">
      <Panel>
        <ChoiceGroup label="When to Send" error={errors.send_type?.message} columns={isDrip ? 'sm:grid-cols-1' : 'sm:grid-cols-3'}>
          {choices.map((item) => <ChoiceCard key={item.value} selected={sendType === item.value} onSelect={() => setValue('send_type', item.value, touch)} title={item.label} text={item.hint} />)}
        </ChoiceGroup>
        {isDrip && <p className="mt-2 text-xs text-ink-500">A drip campaign always sends as a series. To send once, change the campaign type on the first step.</p>}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Field label="Time Zone" error={errors.send_timezone?.message} hint={`Send times below are clock times in this zone. Workspace time zone: ${workspaceZone}.`}>
            {(ids) => (
              <Select key={options ? 'ready' : 'loading'} {...ids} {...register('send_timezone')}>
                {!zones.includes(zone) && <option value={zone}>{zone}</option>}
                {zones.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            )}
          </Field>

          {sendType === 'SCHEDULED' && (
            <Field label="Send At" required error={errors.scheduled_at?.message} hint={zonedToIso(scheduledAt, zone) ? `That is ${formatInZone(zonedToIso(scheduledAt, zone), workspaceZone)} for the workspace.` : undefined}>
              {(ids) => <TextInput {...ids} type="datetime-local" {...register('scheduled_at')} />}
            </Field>
          )}
        </div>

        {sendType === 'RECURRING' && (
          <div className="mt-5 space-y-4 border-t border-line pt-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Repeats" required error={errors.recurring?.frequency?.message}>
                {(ids) => (
                  <Select {...ids} {...register('recurring.frequency')}>
                    <option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option>
                  </Select>
                )}
              </Field>
              <Field label={`Every (${{ DAILY: 'Days', WEEKLY: 'Weeks', MONTHLY: 'Months' }[recurring.frequency]})`} error={errors.recurring?.interval?.message}>
                {(ids) => <TextInput {...ids} inputMode="numeric" {...register('recurring.interval')} />}
              </Field>
              <Field label="At" required error={errors.recurring?.time?.message}>
                {(ids) => <TextInput {...ids} type="time" {...register('recurring.time')} />}
              </Field>
            </div>
            {recurring.frequency === 'WEEKLY' && (
              <div>
                <p className="text-sm font-medium text-ink-700">On</p>
                <div role="group" aria-label="Days of the Week" className="mt-1 flex flex-wrap gap-2">
                  {WEEKDAYS.map((day) => (
                    <button key={day.value} type="button" aria-pressed={recurring.weekdays.includes(day.value)} onClick={() => toggleDay(day.value)}
                      className={`h-10 min-w-12 rounded-control-lg border px-3 text-sm font-medium transition-colors ${recurring.weekdays.includes(day.value) ? 'border-brand-600 bg-callout-bg text-brand-800' : 'border-line bg-surface text-ink-700 hover:bg-surface-subtle'}`}>
                      {day.label}
                    </button>
                  ))}
                </div>
                {errors.recurring?.weekdays?.message && <p className="mt-1 text-xs font-medium text-danger-text">{errors.recurring.weekdays.message}</p>}
              </div>
            )}
            {recurring.frequency === 'MONTHLY' && (
              <div className="sm:w-1/3">
                <Field label="Day of the Month" required error={errors.recurring?.day_of_month?.message} hint="In a shorter month, the last day is used.">
                  {(ids) => <TextInput {...ids} inputMode="numeric" {...register('recurring.day_of_month')} />}
                </Field>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Ends" error={errors.recurring?.ends?.message}>
                {(ids) => (
                  <Select {...ids} {...register('recurring.ends')}>
                    <option value="NEVER">Never (Until Paused or Archived)</option><option value="ON">On a Date</option><option value="AFTER">After a Number of Sends</option>
                  </Select>
                )}
              </Field>
              {recurring.ends === 'ON' && (
                <Field label="Last Day" required error={errors.recurring?.end_date?.message}>{(ids) => <TextInput {...ids} type="date" {...register('recurring.end_date')} />}</Field>
              )}
              {recurring.ends === 'AFTER' && (
                <Field label="Number of Sends" required error={errors.recurring?.max_runs?.message}>{(ids) => <TextInput {...ids} inputMode="numeric" {...register('recurring.max_runs')} />}</Field>
              )}
            </div>
          </div>
        )}

        {sendType === 'DRIP' && (
          <div className="mt-5 space-y-3 border-t border-line pt-5">
            <div className="sm:w-1/3">
              <Field label="Each Step Goes Out At" required error={errors.drip?.time?.message} hint="Day 0 goes out when you publish.">
                {(ids) => <TextInput {...ids} type="time" {...register('drip.time')} />}
              </Field>
            </div>
            <p className="text-sm font-medium text-ink-700">Steps</p>
            {stepsError && <p role="alert" className="text-xs font-medium text-danger-text">{stepsError}</p>}
            <ol className="space-y-3">
              {steps.fields.map((step, index) => (
                <li key={step.id} className="grid gap-3 rounded-lg border border-line bg-surface-subtle p-3 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-start">
                  <Field label={`Step ${index + 1}: Day`} required error={errors.drip?.steps?.[index]?.day?.message}>
                    {(ids) => <TextInput {...ids} inputMode="numeric" {...register(`drip.steps.${index}.day`)} />}
                  </Field>
                  <Field label="Label" error={errors.drip?.steps?.[index]?.label?.message} hint="Shown on the run, e.g. Welcome, Reminder.">
                    {(ids) => <TextInput {...ids} maxLength={60} {...register(`drip.steps.${index}.label`)} />}
                  </Field>
                  <button type="button" aria-label={`Remove Step ${index + 1}`} disabled={steps.fields.length === 1} onClick={() => steps.remove(index)}
                    className="mt-6 flex h-10 w-10 items-center justify-center rounded-control-lg border border-line bg-surface text-ink-700 transition-colors hover:bg-line-subtle disabled:text-ink-300">
                    <Trash2 size={18} strokeWidth={1.5} aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
            <button type="button" className={buttonSecondary} disabled={steps.fields.length >= 30}
              onClick={() => steps.append({ day: String(Math.max(0, ...watch('drip.steps').map((step) => Number(step.day) || 0)) + 3), label: '' })}>
              <Plus size={16} strokeWidth={1.5} aria-hidden /> Add a Step
            </button>
            <p className="text-xs text-ink-500">Every step uses the template chosen for this campaign. Per-step templates arrive with journeys.</p>
          </div>
        )}
      </Panel>

      <Panel title="Delivery" description="How the send engine treats this campaign.">
        <div className="space-y-4">
          <CheckRow id="respect-governance" checked={watch('respect_governance')} onChange={(value) => setValue('respect_governance', value, touch)}
            label="Apply Corporate Frequency Limits"
            hint={marketing ? 'Recommended. Switching this off is recorded in the activity log. Consent, unsubscribes and blocked addresses always apply.' : 'Service and transactional messages may be exempt. Unsubscribes of texts and blocked addresses always apply.'} />
          <CheckRow id="zone-optimization" checked={watch('timezone_optimization')} onChange={(value) => setValue('timezone_optimization', value, touch)}
            label="Send at Each Recipient's Local Time" hint="The same clock time in each recipient's own time zone. Stored with the campaign; it takes effect when the delivery engine integration is switched on." />
          <div className="sm:w-1/3">
            <Field label="Messages per Hour, at Most" error={errors.rate_limit_per_hour?.message} hint="Leave blank for no limit of your own. Takes effect with the delivery engine integration.">
              {(ids) => <TextInput {...ids} inputMode="numeric" {...register('rate_limit_per_hour')} />}
            </Field>
          </div>
          {texts && marketing && <p className="text-xs text-ink-500">Marketing texts are held during the workspace's quiet hours and start when they end.</p>}
        </div>
      </Panel>
    </div>
  )
}
