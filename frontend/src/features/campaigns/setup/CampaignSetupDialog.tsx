/**
 * Create Campaign: name it and pick a type and channel, over the Campaigns list. Creating stores the draft (as the old
 * wizard's first step did) and opens the setup at Audience, or at Content for an e-receipt. The same pop-up edits an
 * existing campaign's details ("Edit details"), with the type and channel fixed; saving there never moves the setup on.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, FileText, Image, Layers, Lock, Mail, Megaphone, MessageSquare, ReceiptText, Repeat } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Controller, useForm, type FieldErrors, type FieldPath } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { useAuth } from '@/auth/AuthContext'
import { Field, Select, TextArea, TextInput, buttonSecondary } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { SetupDialog } from '@/components/SetupDialog'
import { useFieldRules } from '@/lib/fieldRules'
import { api, ApiError } from '@/lib/api'
import { channelAllowed } from '@/lib/features'
import type { Campaign, CampaignFormOptions } from '@/lib/types'

import { ChoiceCard, ChoiceGroup } from '../parts'
import { campaignSchema, emptyValues, fromCampaign, toInput, type CampaignFormValues } from '../schema'
import { PROGRESS, setupHref, stepsFor, typeCanChange } from '../setupFlow'
import { SOLICITATION } from '../vocabulary'
import { timeInZone } from '../zone'
import { OwnerPicker } from './OwnerPicker'
import { TagInput } from './TagInput'

type CampaignType = CampaignFormValues['campaign_type']
type Channel = CampaignFormValues['channel']
type Purpose = CampaignFormValues['solicitation_type']

const ICON = { size: 20, strokeWidth: 1.5, 'aria-hidden': true } as const
const TYPES: { value: CampaignType; title: string; text: string; icon: ReactNode; badge?: string }[] = [
  { value: 'REGULAR_MARKETING', title: 'Regular Marketing', text: 'One-time or scheduled send', icon: <Megaphone {...ICON} />, badge: 'Most Common' },
  { value: 'DRIP', title: 'Drip', text: 'Multi-run scheduled pattern', icon: <Repeat {...ICON} /> },
  { value: 'E_RECEIPT', title: 'E-Receipt', text: 'Transactional receipt communication', icon: <ReceiptText {...ICON} /> },
  { value: 'OTHER', title: 'Other', text: 'Service or legal notices', icon: <FileText {...ICON} /> },
]
const CHANNELS: { value: Channel; title: string; text: string; icon: ReactNode }[] = [
  { value: 'EMAIL', title: 'Email', text: 'Rich layout, subject line and preview text', icon: <Mail {...ICON} /> },
  { value: 'SMS', title: 'SMS', text: '160 characters, text only', icon: <MessageSquare {...ICON} /> },
  { value: 'MMS', title: 'MMS', text: 'Text with an image', icon: <Image {...ICON} /> },
  { value: 'MULTI', title: 'Multiple Channels', text: 'One campaign, more than one channel', icon: <Layers {...ICON} /> },
]
/** what the message is for, until someone chooses otherwise */
const PURPOSE_OF: Record<CampaignType, Purpose> = { REGULAR_MARKETING: 'MARKETING', DRIP: 'MARKETING', E_RECEIPT: 'TRANSACTIONAL', OTHER: 'SERVICE' }

const shape = campaignSchema.shape
const chosen = <T extends z.ZodType>(schema: T, message: string) => z.union([schema, z.literal('')]).refine((value) => value !== '', message)
const setupSchema = z.object({
  name: shape.name, code: shape.code, description: shape.description, tags: shape.tags, owner_user: shape.owner_user,
  campaign_type: chosen(shape.campaign_type, 'Choose a campaign type.'),
  channel: chosen(shape.channel, 'Choose a channel.'),
  solicitation_type: chosen(shape.solicitation_type, 'Choose what the message is for.'),
})
type SetupValues = z.input<typeof setupSchema>

/** the order the pop-up shows its fields in: the first one with a problem gets focus */
const FIELD_ORDER = ['name', 'campaign_type', 'channel', 'solicitation_type', 'owner_user', 'description', 'code', 'tags'] as const
const IN_MORE_OPTIONS = new Set<string>(['code', 'tags'])

/** "CMP-2026-0012 is already used by Weekend Flash Sale", when the API names the campaign; otherwise "…by another campaign" */
function codeTakenMessage(message: string, code: string): string {
  const named = /already used by (.+?)\.?$/i.exec(message)
  if (named) return `${code} is already used by ${named[1]}`
  return /already (uses|used|has|taken)/i.test(message) ? `${code} is already used by another campaign` : message
}

function LockedChoice({ label, choice }: { label: string; choice: { title: string; text: string; icon: ReactNode } | undefined }) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink-900">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-subtle p-4 sm:min-w-60" data-locked={label}>
          <span aria-hidden className="shrink-0 text-ink-800">{choice?.icon}</span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-ink-900">{choice?.title ?? 'Not set'}</span>
            <span className="text-helper text-ink-800">{choice?.text}</span>
          </span>
        </div>
        <span className="flex items-center gap-1.5 text-helper text-ink-800"><Lock size={16} strokeWidth={1.5} aria-hidden />Fixed Once Content Is Chosen</span>
      </div>
    </div>
  )
}

interface CampaignSetupDialogProps {
  /** present: "Edit details" for this campaign; absent: Create Campaign */
  campaign?: Campaign
  onClose: () => void
  /** Edit details: the campaign as saved */
  onSaved?: (campaign: Campaign) => void
  /** Edit details: the stored campaign moved on under us (409); fetch it again */
  onReload?: () => void
  /** the API's messages about these fields from a save elsewhere (the setup's Continue), shown on opening */
  initialErrors?: Partial<Record<string, string>>
}

const FIXED_NOTE = 'The type and channel are fixed once you choose the content.'

export function CampaignSetupDialog({ campaign, onClose, onSaved, onReload, initialErrors }: CampaignSetupDialogProps) {
  const editing = Boolean(campaign)
  const { me, has } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const titleId = useId()
  const body = useRef<HTMLDivElement>(null)
  const zone = me?.tenant.timezone || 'UTC'
  const meId = me?.principal.id ?? ''

  const options = useQuery({
    queryKey: ['campaigns', 'form-options'],
    queryFn: ({ signal }) => api.get<CampaignFormOptions>('/campaigns/form-options/', undefined, signal),
    staleTime: 5 * 60_000,
  })

  const initial = (): SetupValues => {
    if (!campaign) return { name: '', code: '', description: '', tags: [], owner_user: meId, campaign_type: '', channel: '', solicitation_type: '' }
    const values = fromCampaign(campaign, zone)
    return { name: values.name, code: values.code, description: values.description, tags: values.tags, owner_user: values.owner_user, campaign_type: values.campaign_type, channel: values.channel, solicitation_type: values.solicitation_type }
  }
  const form = useForm<SetupValues>({ resolver: zodResolver(setupSchema), defaultValues: initial(), mode: 'onSubmit', reValidateMode: 'onChange' }) // no messages until Create or Save is pressed, then they follow the typing
  const { register, control, watch, setValue, formState: { errors } } = form
  const type = watch('campaign_type')
  const channel = watch('channel')
  const description = watch('description')
  const name = watch('name')
  const code = watch('code')
  const rule = useFieldRules('campaign')
  const receipt = type === 'E_RECEIPT'

  // Edit details: the type and channel stay open until the content is chosen
  const locked = Boolean(campaign && !typeCanChange(campaign))
  const [purposeChosen, setPurposeChosen] = useState(locked)
  const [ownerChanged, setOwnerChanged] = useState(editing)
  const hasDetails = Boolean(campaign && (campaign.code || campaign.tags.length))
  const [moreOpen, setMoreOpen] = useState(hasDetails)
  const [failedAt, setFailedAt] = useState<string | null>(null)

  // a problem inside "More Options" opens it
  const detailProblem = Boolean(errors.code || errors.tags)
  useEffect(() => {
    if (detailProblem) setMoreOpen(true)
  }, [detailProblem])

  useEffect(() => {
    if (!initialErrors) return
    const problems: FieldErrors<SetupValues> = {}
    Object.entries(initialErrors).forEach(([field, message]) => {
      if (!message || !FIELD_ORDER.includes(field as (typeof FIELD_ORDER)[number])) return
      form.setError(field as FieldPath<SetupValues>, { type: 'server', message })
      problems[field as keyof SetupValues] = { type: 'server', message }
    })
    focusFirst(problems)
    // once, on opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function focusFirst(problems: FieldErrors<SetupValues>) {
    const first = FIELD_ORDER.find((field) => problems[field])
    if (!first) return
    if (IN_MORE_OPTIONS.has(first)) setMoreOpen(true)
    requestAnimationFrame(() => {
      const holder = body.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)
      const target = holder?.querySelector<HTMLElement>('[role="radio"][tabindex="0"], input, select, textarea, button:not([data-field-note])')
      target?.focus()
    })
  }

  const save = useMutation({
    mutationFn: (values: SetupValues) => {
      const full: CampaignFormValues = {
        ...(campaign ? fromCampaign(campaign, zone) : emptyValues(zone, meId)),
        name: values.name, code: values.code, description: values.description, tags: values.tags, owner_user: values.owner_user,
        solicitation_type: values.solicitation_type as Purpose,
      }
      if (campaign) {
        const input = toInput(full, campaign.row_version)
        const basics = { name: input.name, code: input.code, description: input.description, solicitation_type: input.solicitation_type, owner_user: input.owner_user, tags: input.tags, row_version: input.row_version }
        if (locked) return api.patch<Campaign>(`/campaigns/${campaign.id}/`, basics)
        // today's rules for a new type: an e-receipt is an email with no lists; a drip sends as a series, and nothing else does
        const nextType = values.campaign_type as CampaignType
        const receipt = nextType === 'E_RECEIPT'
        const sendType = nextType === 'DRIP' ? 'DRIP' : receipt || campaign.send_type === 'DRIP' ? 'IMMEDIATE' : campaign.send_type
        return api.patch<Campaign>(`/campaigns/${campaign.id}/`, {
          ...basics, campaign_type: nextType, channel: receipt ? (values.channel === 'SMS' ? 'SMS' : 'EMAIL') : values.channel, send_type: sendType,
          ...(sendType !== campaign.send_type && sendType !== 'SCHEDULED' ? { scheduled_at: null } : {}),
          ...(sendType === 'DRIP' && !campaign.drip_config ? { drip_config: { time: '09:00', steps: [{ day: 0 }] } } : {}),
          ...(receipt ? { contact_lists: [], excluded_lists: [] } : {}),
        })
      }
      const created: CampaignFormValues = {
        ...full,
        campaign_type: values.campaign_type as CampaignType,
        channel: (values.campaign_type === 'E_RECEIPT' ? (values.channel === 'SMS' ? 'SMS' : 'EMAIL') : values.channel) as Channel,
        send_type: values.campaign_type === 'DRIP' ? 'DRIP' : 'IMMEDIATE',
      }
      return api.post<Campaign>('/campaigns/', { ...toInput(created), setup_step: PROGRESS.created })
    },
    onMutate: () => setFailedAt(null),
    onSuccess: (saved) => {
      queryClient.setQueryData(['campaigns', 'detail', saved.id], saved)
      void queryClient.invalidateQueries({ queryKey: ['campaigns'], refetchType: 'none' })
      if (campaign) {
        onSaved?.(saved)
        onClose()
      } else navigate(setupHref(saved.id, { step: stepsFor(saved.campaign_type)[0].key }))
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400) {
        const problems: FieldErrors<SetupValues> = {}
        Object.entries(error.problem.errors ?? {}).forEach(([field, messages]) => {
          if (!FIELD_ORDER.includes(field as (typeof FIELD_ORDER)[number])) return
          let text = String(Array.isArray(messages) ? messages[0] : messages)
          if (field === 'code') text = codeTakenMessage(text, form.getValues('code').trim().toUpperCase())
          form.setError(field as FieldPath<SetupValues>, { type: 'server', message: text })
          problems[field as keyof SetupValues] = { type: 'server', message: text }
        })
        focusFirst(problems)
      } else if (!(error instanceof ApiError && error.status === 409)) {
        setFailedAt(timeInZone(new Date().toISOString(), zone))
      }
    },
  })

  const busy = save.isPending
  const conflict = save.error instanceof ApiError && save.error.status === 409 ? save.error : null
  const submit = form.handleSubmit((values) => { if (!busy) save.mutate(values) }, focusFirst)

  function chooseType(next: CampaignType) {
    setValue('campaign_type', next, { shouldDirty: true, shouldValidate: Boolean(errors.campaign_type) })
    if (!purposeChosen) setValue('solicitation_type', PURPOSE_OF[next], { shouldDirty: true, shouldValidate: Boolean(errors.solicitation_type) })
    if (next === 'E_RECEIPT' && channel !== 'SMS') setValue('channel', 'EMAIL', { shouldDirty: true, shouldValidate: Boolean(errors.channel) })      // a receipt is email, or a text
    else if (type === 'E_RECEIPT') setValue('channel', '', { shouldDirty: true })
  }

  const typeChoice = TYPES.find((item) => item.value === type)
  const channelChoice = CHANNELS.find((item) => item.value === channel)
  const people = options.data?.owners ?? []

  return (
    <SetupDialog title={editing ? 'Edit Details' : 'Create Campaign'} onClose={onClose} locked={busy}
      primary={{ label: editing ? 'Save' : 'Create Campaign', form: `${titleId}-form`, busy, busyLabel: editing ? 'Saving' : 'Creating' }}
      error={failedAt ? { title: editing ? 'Changes Weren’t Saved' : 'Campaign Wasn’t Created', message: `Something went wrong on our side at ${failedAt}. Your entries are kept, so try again in a moment.`, onRetry: () => void submit() } : null}
      banner={conflict && (
        <Notice tone="warning" layout="banner" title={conflict.message}
          action={onReload && <button type="button" className={buttonSecondary} onClick={() => { save.reset(); onReload() }}>Reload the Latest Version</button>}>
          <p>Your changes here aren’t saved. Reloading shows what is stored now.</p>
        </Notice>
      )}>
      <form id={`${titleId}-form`} noValidate onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy} className="min-w-0">
          <div ref={body} className="flex flex-col gap-6">
            <div data-field="name">
              <Field label="Campaign Name" required strong error={errors.name?.message} help="Unique among the workspace's live campaigns. It names the campaign in the list, the reports and Home; the code is the short handle for the API and the engine's logs." hint="Internal name, visible to your team only" limit={{ used: name.length, max: rule('name')?.max ?? 200 }}>
                {(ids) => <TextInput {...ids} {...register('name')} maxLength={rule('name')?.max ?? 200} placeholder="e.g. Fall Promo Email" data-autofocus />}
              </Field>
            </div>

            <div data-field="campaign_type">
              {locked ? <LockedChoice label="Campaign Type" choice={typeChoice} /> : (
                <ChoiceGroup label="Campaign Type" required strong error={errors.campaign_type?.message} hint={receipt && !editing ? FIXED_NOTE : undefined} columns="grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
                  {TYPES.map((item) => (
                    <ChoiceCard key={item.value} tile selected={type === item.value} onSelect={() => chooseType(item.value)} title={item.title} text={item.text} icon={item.icon} badge={item.badge} />
                  ))}
                </ChoiceGroup>
              )}
            </div>

            {(
              <div data-field="channel">
                {locked ? <LockedChoice label="Channel" choice={channelChoice} /> : (
                  <ChoiceGroup label="Channel" required strong error={errors.channel?.message} hint={receipt ? 'An email receipt, or a text receipt for registers that ask for SMS.' : editing ? undefined : FIXED_NOTE} columns="grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
                    {CHANNELS.filter((item) => channelAllowed(has, item.value, channel) && (!receipt || item.value === 'EMAIL' || item.value === 'SMS')).map((item) => (
                      <ChoiceCard key={item.value} tile selected={channel === item.value} title={item.title} text={item.text} icon={item.icon}
                        onSelect={() => setValue('channel', item.value, { shouldDirty: true, shouldValidate: Boolean(errors.channel) })} />
                    ))}
                  </ChoiceGroup>
                )}
              </div>
            )}

            <div data-field="solicitation_type" className="sm:w-1/2 sm:pr-3">
              <Field label="Message Purpose" required strong error={errors.solicitation_type?.message} help="Marketing needs an opt-in and an unsubscribe link and counts against frequency limits. Transactional, service and legal skip the consent rules, but never a blocked or invalid address." hint="Decides which consent and frequency rules apply.">
                {(ids) => (
                  <Select {...ids} {...register('solicitation_type', { onChange: () => setPurposeChosen(true) })} disabled={!type || receipt}>
                    {!type && <option value="">Pick a Type First</option>}
                    {SOLICITATION.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </Select>
                )}
              </Field>
            </div>

            <hr className="border-line-subtle" />

            <Controller control={control} name="owner_user" render={({ field }) => (
              <OwnerPicker value={field.value} onChange={(id) => { field.onChange(id); setOwnerChanged(true) }} people={people} meId={meId} autoAssigned={!ownerChanged} disabled={busy} />
            )} />

              <div data-field="description">
                <Field label="Description (Optional)" strong error={errors.description?.message}
                  limit={{ used: description.length, max: rule('description')?.max ?? 2000 }}>
                  {(ids) => <TextArea {...ids} {...register('description')} rows={3} maxLength={rule('description')?.max ?? 2000} placeholder="e.g. Fall loyalty push to Gold and Platinum members" />}
                </Field>
              </div>
            <div>
              <button type="button" aria-expanded={moreOpen} aria-controls={`${titleId}-more`} onClick={() => setMoreOpen(!moreOpen)}
                className="flex items-center gap-1.5 rounded-control-sm text-sm font-semibold text-brand-600 hover:underline">
                {moreOpen ? <ChevronDown size={16} strokeWidth={1.5} aria-hidden /> : <ChevronRight size={16} strokeWidth={1.5} aria-hidden />}
                More Options <span className="font-normal text-ink-800">· Code and tags</span>
              </button>
              {moreOpen && (
                <div id={`${titleId}-more`} className="mt-4 flex flex-col gap-6">
                  <div data-field="code" className="sm:w-1/2 sm:pr-3">
                    <Field label="Code (Optional)" strong error={errors.code?.message} help="The short handle reports, the API and the engine's call log use for this campaign. Made for you when left blank; fixed once the campaign exists." hint="Leave blank to get one automatically · capitals, digits and hyphens" limit={{ used: code.length, max: rule('code')?.max ?? 40 }}>
                      {(ids) => <TextInput {...ids} {...register('code')} maxLength={rule('code')?.max ?? 40} placeholder="CMP-2026-0021" className="uppercase placeholder:normal-case" />}
                    </Field>
                  </div>
                  <div data-field="tags">
                    <Controller control={control} name="tags" render={({ field }) => (
                      <TagInput value={field.value} onChange={field.onChange} suggestions={options.data?.tags ?? []} disabled={busy}
                        error={errors.tags?.message ?? (Array.isArray(errors.tags) ? errors.tags.find(Boolean)?.message : undefined)} />
                    )} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </fieldset>
      </form>
    </SetupDialog>
  )
}
