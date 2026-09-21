/** Step 1: what the campaign is. Type and channel are chosen on cards, as in the prototype's "New Campaign" dialog. */
import { FileText, Image, Mail, MessageSquare, Receipt, Repeat, Send, X } from 'lucide-react'
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Controller, useFormContext } from 'react-hook-form'

import { useAuth } from '@/auth/AuthContext'
import { Field, Select, TextArea, TextInput } from '@/components/Form'
import { iconButtonClass } from '@/components/buttonStyles'
import { channelAllowed } from '@/lib/features'
import type { CampaignFormOptions } from '@/lib/types'

import { ChoiceCard, ChoiceGroup, Panel } from '../parts'
import { TAG_PATTERN, type CampaignFormValues } from '../schema'
import { CAMPAIGN_TYPES, CHANNELS, SOLICITATION } from '../vocabulary'

const TYPE_ICON: Record<string, ReactNode> = {
  REGULAR_MARKETING: <Send size={18} strokeWidth={1.5} aria-hidden />, DRIP: <Repeat size={18} strokeWidth={1.5} aria-hidden />,
  E_RECEIPT: <Receipt size={18} strokeWidth={1.5} aria-hidden />, OTHER: <FileText size={18} strokeWidth={1.5} aria-hidden />,
}
const CHANNEL_ICON: Record<string, ReactNode> = {
  EMAIL: <Mail size={18} strokeWidth={1.5} aria-hidden />, SMS: <MessageSquare size={18} strokeWidth={1.5} aria-hidden />,
  MMS: <Image size={18} strokeWidth={1.5} aria-hidden />, MULTI: <Send size={18} strokeWidth={1.5} aria-hidden />,
}

function TagsInput({ value, onChange, suggestions, error }: { value: string[]; onChange: (tags: string[]) => void; suggestions: string[]; error?: string }) {
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState('')
  const id = useId()

  function add(raw: string) {
    const tag = raw.trim().replace(/\s+/g, ' ')
    if (!tag) return
    if (!TAG_PATTERN.test(tag)) return setProblem('A tag is up to 40 letters, digits and spaces.')
    if (value.length >= 20) return setProblem('Up to 20 tags.')
    if (!value.some((item) => item.toLowerCase() === tag.toLowerCase())) onChange([...value, tag])
    setDraft('')
    setProblem('')
  }
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault() // Enter must not submit the step
      add(draft)
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) onChange(value.slice(0, -1))
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">Tags</label>
      <div className={`mt-1 flex min-h-10 flex-wrap items-center gap-1.5 rounded-sm border bg-surface px-2 py-1 focus-within:border-brand-600 ${error || problem ? 'border-danger' : 'border-line'}`}>
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-sm bg-line-subtle py-0.5 pl-1.5 pr-0.5 text-xs font-semibold text-ink-700">
            {tag}
            <button type="button" aria-label={`Remove the tag ${tag}`} onClick={() => onChange(value.filter((item) => item !== tag))} className={`${iconButtonClass({ size: 'xs' })} -my-1 -mr-0.5`}>
              <X size={12} strokeWidth={1.5} aria-hidden />
            </button>
          </span>
        ))}
        <input id={id} list={`${id}-known`} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKey} onBlur={() => add(draft)}
          placeholder={value.length === 0 ? 'Type a tag and press Enter' : ''} className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm text-ink-900 outline-none" />
        <datalist id={`${id}-known`}>{suggestions.filter((tag) => !value.includes(tag)).map((tag) => <option key={tag} value={tag} />)}</datalist>
      </div>
      {error || problem
        ? <p className="mt-1 text-xs font-medium text-danger-text">{error || problem}</p>
        : <p className="mt-1 text-xs text-ink-500">For finding and filtering campaigns, e.g. Fall, VIP, Clearance.</p>}
    </div>
  )
}

export function StepBasics({ options, isNew }: { options: CampaignFormOptions | undefined; isNew: boolean }) {
  const { has } = useAuth()
  const { register, control, watch, setValue, formState: { errors } } = useFormContext<CampaignFormValues>()
  const type = watch('campaign_type')
  const channel = watch('channel')
  const purpose = watch('solicitation_type')
  const isReceipt = type === 'E_RECEIPT'

  function chooseType(next: CampaignFormValues['campaign_type']) {
    const touch = { shouldDirty: true }
    setValue('campaign_type', next, touch)
    if (next === 'E_RECEIPT') {
      // a receipt is a transactional email about a purchase: no list, no schedule
      setValue('channel', 'EMAIL', touch)
      setValue('solicitation_type', 'TRANSACTIONAL', touch)
      setValue('contact_lists', [], touch)
      setValue('excluded_lists', [], touch)
    } else if (type === 'E_RECEIPT') setValue('solicitation_type', 'MARKETING', touch)
    if (next === 'DRIP') setValue('send_type', 'DRIP', touch)
    else if (watch('send_type') === 'DRIP') setValue('send_type', 'IMMEDIATE', touch)
    // the template and the sender are checked against the channel on the Template step
  }

  return (
    <div className="space-y-5">
      <Panel>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Campaign name" required error={errors.name?.message} hint="Unique in this workspace. Shown in lists and reports, never to recipients.">
            {(ids) => <TextInput {...ids} {...register('name')} maxLength={200} autoFocus={isNew} />}
          </Field>
          <Field label="Code" error={errors.code?.message} hint="Business key used in reports. Leave blank to generate one, e.g. CMP-2026-0042.">
            {(ids) => <TextInput {...ids} {...register('code')} maxLength={40} placeholder="Generated automatically" className="uppercase placeholder:normal-case" />}
          </Field>
          <div className="lg:col-span-2">
            <Field label="Description" error={errors.description?.message}>
              {(ids) => <TextArea {...ids} {...register('description')} rows={3} />}
            </Field>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="space-y-5">
          <ChoiceGroup label="Campaign type" error={errors.campaign_type?.message} columns="sm:grid-cols-2 xl:grid-cols-4">
            {CAMPAIGN_TYPES.filter((item) => item.value !== 'E_RECEIPT' || has('ereceipt') || isReceipt).map((item) => (
              <ChoiceCard key={item.value} selected={type === item.value} onSelect={() => chooseType(item.value)} title={item.label} text={item.hint} icon={TYPE_ICON[item.value]}
                badge={'badge' in item ? item.badge : undefined} />
            ))}
          </ChoiceGroup>
          <ChoiceGroup label="Channel" error={errors.channel?.message} columns="sm:grid-cols-2 xl:grid-cols-4">
            {CHANNELS.filter((item) => channelAllowed(has, item.value, channel)).map((item) => (
              <ChoiceCard key={item.value} selected={channel === item.value} disabled={isReceipt && item.value !== 'EMAIL'} onSelect={() => setValue('channel', item.value, { shouldDirty: true })}
                title={item.label} text={isReceipt && item.value === 'EMAIL' ? 'E-receipts are sent by email.' : item.hint} icon={CHANNEL_ICON[item.value]} />
            ))}
          </ChoiceGroup>
        </div>
      </Panel>

      <Panel>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Message purpose" required error={errors.solicitation_type?.message} hint={SOLICITATION.find((item) => item.value === purpose)?.hint}>
            {(ids) => (
              <Select {...ids} {...register('solicitation_type')} disabled={isReceipt}>
                {SOLICITATION.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Owner" error={errors.owner_user?.message} hint="Who answers for this campaign. It starts as you.">
            {(ids) => (
              // keyed on the options: a select can only show a value whose option exists, so it re-reads the form once they arrive
              <Select key={options ? 'ready' : 'loading'} {...ids} {...register('owner_user')}>
                <option value="">No owner</option>
                {options?.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
              </Select>
            )}
          </Field>
          <div className="lg:col-span-2">
            <Controller control={control} name="tags" render={({ field }) => (
              <TagsInput value={field.value} onChange={field.onChange} suggestions={options?.tags ?? []} error={errors.tags?.message ?? (Array.isArray(errors.tags) ? errors.tags.find(Boolean)?.message : undefined)} />
            )} />
          </div>
        </div>
      </Panel>
    </div>
  )
}
