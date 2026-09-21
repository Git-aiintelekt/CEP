/**
 * Create (/campaigns/new) and edit (/campaigns/:id/edit) a campaign.
 * The rules here mirror the API's so people get feedback while typing; the API stays the authority and its field
 * errors are shown against the same fields.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary, buttonSecondary, Field, FormSection, Select, TextArea, TextInput } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { api, ApiError } from '@/lib/api'
import { channelAllowed } from '@/lib/features'
import { formatNumber, fromLocalInput, humanize, toLocalInput } from '@/lib/format'
import type { Campaign, CampaignInput, ContactList, Page, SenderProfile, Template } from '@/lib/types'

const EDITABLE_STATUSES = new Set(['DRAFT', 'TEST_PUBLISHED'])
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/

const CAMPAIGN_TYPES = [
  { value: 'REGULAR_MARKETING', label: 'Regular marketing', hint: 'One send, or a recurring send, to one or more contact lists.' },
  { value: 'DRIP', label: 'Drip', hint: 'A timed series; each step is its own run.' },
  { value: 'E_RECEIPT', label: 'E-receipt', hint: 'Transactional email triggered by a purchase. No contact list needed.' },
  { value: 'OTHER', label: 'Other', hint: 'Service or legal notices.' },
]
const CHANNELS = ['EMAIL', 'SMS', 'MMS', 'MULTI']
const SOLICITATION = [
  { value: 'MARKETING', hint: 'Needs consent; frequency caps and unsubscribe apply.' },
  { value: 'TRANSACTIONAL', hint: 'Needs a valid contact point only; exempt from caps.' },
  { value: 'SERVICE', hint: 'Account or service notices.' },
  { value: 'LEGAL', hint: 'Mandatory notices; sent regardless of marketing preferences.' },
]
/** which template / sender channels fit a campaign channel (same table as the API) */
const TEMPLATE_FIT: Record<string, string[]> = { EMAIL: ['EMAIL', 'E_RECEIPT'], SMS: ['SMS'], MMS: ['MMS'], MULTI: ['EMAIL', 'E_RECEIPT', 'SMS', 'MMS'] }
const SENDER_FIT: Record<string, string[]> = { EMAIL: ['EMAIL'], SMS: ['SMS'], MMS: ['MMS', 'SMS'], MULTI: ['EMAIL', 'SMS', 'MMS'] }

interface Values {
  name: string
  code: string
  description: string
  campaign_type: string
  channel: string
  solicitation_type: string
  template: string
  sender_profile: string
  contact_lists: string[]
  scheduled_at: string
}
type Errors = Partial<Record<keyof Values, string>>

const EMPTY: Values = {
  name: '', code: '', description: '', campaign_type: 'REGULAR_MARKETING', channel: 'EMAIL', solicitation_type: 'MARKETING',
  template: '', sender_profile: '', contact_lists: [], scheduled_at: '',
}

function fromCampaign(campaign: Campaign): Values {
  return {
    name: campaign.name,
    code: campaign.code ?? '',
    description: campaign.description ?? '',
    campaign_type: campaign.campaign_type,
    channel: campaign.channel,
    solicitation_type: campaign.solicitation_type,
    template: campaign.template ?? '',
    sender_profile: campaign.sender_profile ?? '',
    contact_lists: campaign.contact_lists,
    scheduled_at: toLocalInput(campaign.scheduled_at),
  }
}

function validate(values: Values, original: Values | null): Errors {
  const errors: Errors = {}
  if (values.name.trim().length < 3) errors.name = 'Use at least 3 characters.'
  if (values.code && !CODE_PATTERN.test(values.code.trim().toUpperCase())) {
    errors.code = '3 to 40 characters: capital letters, digits, hyphen or underscore.'
  }
  const changedSchedule = values.scheduled_at !== (original?.scheduled_at ?? '')
  if (values.scheduled_at && changedSchedule && new Date(values.scheduled_at).getTime() <= Date.now()) {
    errors.scheduled_at = 'Choose a time in the future.'
  }
  return errors
}

export function CampaignFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { me, can, has } = useAuth()

  const existing = useQuery({
    queryKey: ['campaigns', 'detail', id],
    queryFn: ({ signal }) => api.get<Campaign>(`/campaigns/${id}/`, undefined, signal),
    enabled: isEdit,
  })
  const templates = useQuery({
    queryKey: ['templates', 'options'],
    queryFn: ({ signal }) => api.get<Page<Template>>('/templates/', { page_size: 200 }, signal),
  })
  const senders = useQuery({
    queryKey: ['sender-profiles', 'options'],
    queryFn: ({ signal }) => api.get<SenderProfile[]>('/sender-profiles/', undefined, signal),
  })
  const lists = useQuery({
    queryKey: ['contact-lists', 'options'],
    queryFn: ({ signal }) => api.get<Page<ContactList>>('/contact-lists/', { status: 'ACTIVE', page_size: 200 }, signal),
  })

  const [values, setValues] = useState<Values>(EMPTY)
  const [original, setOriginal] = useState<Values | null>(null)
  const [rowVersion, setRowVersion] = useState<number | undefined>(undefined)
  const [errors, setErrors] = useState<Errors>({})
  const [listSearch, setListSearch] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  // Load the campaign into the form once per fetched version (a reload after a 409 replaces local edits on purpose).
  const loaded = existing.data
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null)
  if (loaded && loadedVersion !== loaded.row_version) {
    const next = fromCampaign(loaded)
    setLoadedVersion(loaded.row_version)
    setValues(next)
    setOriginal(next)
    setRowVersion(loaded.row_version)
    setErrors({})
  }

  const dirty = JSON.stringify(values) !== JSON.stringify(original ?? EMPTY)
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const isReceipt = values.campaign_type === 'E_RECEIPT'

  const templateOptions = useMemo(() => {
    const fit = isReceipt ? ['E_RECEIPT'] : (TEMPLATE_FIT[values.channel] ?? [])
    return (templates.data?.results ?? []).filter((item) => item.status !== 'ARCHIVED' && fit.includes(item.channel))
  }, [templates.data, values.channel, isReceipt])

  const senderOptions = useMemo(
    () => (senders.data ?? []).filter((item) => (SENDER_FIT[values.channel] ?? []).includes(item.channel)),
    [senders.data, values.channel],
  )

  const listOptions = lists.data?.results ?? []
  const visibleLists = listOptions.filter((item) => item.name.toLowerCase().includes(listSearch.trim().toLowerCase()))
  const audience = listOptions.filter((item) => values.contact_lists.includes(item.id)).reduce((total, item) => total + item.member_count, 0)

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => {
      const next = { ...current, [key]: value }
      if (key === 'campaign_type' && value === 'E_RECEIPT') {
        next.channel = 'EMAIL'
        next.solicitation_type = 'TRANSACTIONAL'
        next.contact_lists = []
      }
      if (key === 'campaign_type' && current.campaign_type === 'E_RECEIPT' && value !== 'E_RECEIPT') next.solicitation_type = 'MARKETING'
      if (key === 'channel' || key === 'campaign_type') {
        // a template / sender for another channel would be rejected by the API: clear it now, visibly
        const fit = next.campaign_type === 'E_RECEIPT' ? ['E_RECEIPT'] : (TEMPLATE_FIT[next.channel] ?? [])
        const template = templates.data?.results.find((item) => item.id === next.template)
        if (template && !fit.includes(template.channel)) next.template = ''
        const sender = senders.data?.find((item) => item.id === next.sender_profile)
        if (sender && !(SENDER_FIT[next.channel] ?? []).includes(sender.channel)) next.sender_profile = ''
      }
      return next
    })
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  function toggleList(listId: string) {
    set('contact_lists', values.contact_lists.includes(listId) ? values.contact_lists.filter((item) => item !== listId) : [...values.contact_lists, listId])
  }

  const save = useMutation({
    mutationFn: (input: CampaignInput) => (isEdit ? api.patch<Campaign>(`/campaigns/${id}/`, input) : api.post<Campaign>('/campaigns/', input)),
    onSuccess: async (campaign) => {
      setOriginal(values) // no "unsaved changes" prompt on the way out
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      queryClient.setQueryData(['campaigns', 'detail', campaign.id], campaign)
      navigate(`/campaigns/${campaign.id}`, { replace: true })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400) {
        setErrors(error.fieldErrors as Errors)
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      }
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const found = validate(values, original)
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    save.mutate({
      name: values.name.trim(),
      code: values.code.trim().toUpperCase() || undefined,
      description: values.description.trim() || null,
      campaign_type: values.campaign_type,
      channel: values.channel,
      solicitation_type: values.solicitation_type,
      template: values.template || null,
      sender_profile: values.sender_profile || null,
      contact_lists: values.contact_lists,
      scheduled_at: fromLocalInput(values.scheduled_at),
      row_version: isEdit ? rowVersion : undefined,
    })
  }

  // ---- guards
  if (!can('campaign.edit')) {
    return <ErrorState title="You cannot edit campaigns" error={new Error('Ask a Marketing Admin for the campaign.edit permission.')} />
  }
  if (isEdit && existing.isPending) {
    return (
      <p className="flex items-center gap-3 text-sm text-ink-500">
        <Spinner /> Loading campaign
      </p>
    )
  }
  if (isEdit && existing.isError) return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />
  if (loaded && (loaded.is_journey_generated || !EDITABLE_STATUSES.has(loaded.status))) {
    return (
      <section>
        <PageHeader title={loaded.name} />
        <div className="rounded-lg border border-warning bg-warning-bg px-5 py-4 text-sm text-warning-text">
          {loaded.is_journey_generated
            ? 'This campaign is generated by a journey. Change the journey instead.'
            : `A ${loaded.status_label.toLowerCase()} campaign can no longer be edited.`}
          <Link to={`/campaigns/${loaded.id}`} className="ml-2 font-medium underline underline-offset-2">
            Back to the campaign
          </Link>
        </div>
      </section>
    )
  }

  const conflict = save.error instanceof ApiError && save.error.status === 409 ? save.error : null
  const otherError = save.isError && !conflict && !(save.error instanceof ApiError && save.error.status === 400) ? save.error : null
  const typeHint = CAMPAIGN_TYPES.find((item) => item.value === values.campaign_type)?.hint
  const solicitationHint = SOLICITATION.find((item) => item.value === values.solicitation_type)?.hint
  const cancelTo = isEdit ? `/campaigns/${id}` : '/campaigns'

  return (
    <section className="max-w-4xl">
      <Link to={cancelTo} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline">
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> {isEdit ? 'Back to the campaign' : 'Campaigns'}
      </Link>
      <PageHeader
        title={isEdit ? `Edit ${loaded?.name ?? 'campaign'}` : 'New campaign'}
        description={isEdit ? undefined : 'Saved as a draft. Nothing is sent until the campaign is published.'}
      />

      {conflict && (
        <div role="alert" className="mb-4 rounded-lg border border-warning bg-warning-bg px-5 py-4 text-sm text-warning-text">
          <p className="font-medium">{conflict.message}</p>
          <button
            type="button"
            className="mt-2 font-medium underline underline-offset-2"
            onClick={() => {
              save.reset()
              void existing.refetch()
            }}
          >
            Reload the latest version (your unsaved changes here are discarded)
          </button>
        </div>
      )}
      {otherError !== null && (
        <div className="mb-4">
          <ErrorState title="Could not save the campaign" error={otherError} />
        </div>
      )}

      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
        <FormSection title="Basics">
          <Field label="Name" required error={errors.name}>
            {(ids) => <TextInput {...ids} value={values.name} onChange={(event) => set('name', event.target.value)} maxLength={200} autoFocus={!isEdit} />}
          </Field>
          <Field label="Code" error={errors.code} hint="Business key used in reports. Leave blank to generate one, e.g. CMP-2026-0042.">
            {(ids) => (
              <TextInput {...ids} value={values.code} onChange={(event) => set('code', event.target.value.toUpperCase())} maxLength={40} placeholder="Generated automatically" />
            )}
          </Field>
          <div className="lg:col-span-2">
            <Field label="Description" error={errors.description}>
              {(ids) => <TextArea {...ids} rows={3} value={values.description} onChange={(event) => set('description', event.target.value)} />}
            </Field>
          </div>
        </FormSection>

        <FormSection title="Type and channel">
          <Field label="Campaign type" required error={errors.campaign_type} hint={typeHint}>
            {(ids) => (
              <Select {...ids} value={values.campaign_type} onChange={(event) => set('campaign_type', event.target.value)}>
                {CAMPAIGN_TYPES.filter((item) => item.value !== 'E_RECEIPT' || has('ereceipt') || values.campaign_type === 'E_RECEIPT').map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Channel" required error={errors.channel} hint={isReceipt ? 'E-receipts are sent by email.' : undefined}>
            {(ids) => (
              <Select {...ids} value={values.channel} disabled={isReceipt} onChange={(event) => set('channel', event.target.value)}>
                {CHANNELS.filter((item) => channelAllowed(has, item, values.channel)).map((item) => (
                  <option key={item} value={item}>
                    {item === 'MULTI' ? 'Multiple channels' : item}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Message purpose" required error={errors.solicitation_type} hint={solicitationHint}>
            {(ids) => (
              <Select {...ids} value={values.solicitation_type} disabled={isReceipt} onChange={(event) => set('solicitation_type', event.target.value)}>
                {SOLICITATION.map((item) => (
                  <option key={item.value} value={item.value}>
                    {humanize(item.value)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormSection>

        <FormSection title="Content and sender" description="Both are needed before the campaign can be published, not to save a draft.">
          <Field
            label="Template"
            error={errors.template}
            hint={templates.isPending ? 'Loading templates' : templateOptions.length === 0 ? `No ${isReceipt ? 'e-receipt' : values.channel} templates yet.` : undefined}
          >
            {(ids) => (
              <Select {...ids} value={values.template} onChange={(event) => set('template', event.target.value)}>
                <option value="">Choose later</option>
                {templateOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.channel}
                    {item.status === 'DRAFT' ? ', draft' : ''})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Sender"
            error={errors.sender_profile}
            hint={senders.isPending ? 'Loading senders' : senderOptions.length === 0 ? `No ${values.channel} sender is set up yet.` : undefined}
          >
            {(ids) => (
              <Select {...ids} value={values.sender_profile} onChange={(event) => set('sender_profile', event.target.value)}>
                <option value="">Choose later</option>
                {senderOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name} · {item.from_address ?? item.sender_id ?? item.channel}
                    {item.provider_type === 'SMTP' ? ' · your mail server' : ''}
                    {item.verification_status === 'VERIFIED' ? '' : ' (not verified)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormSection>

        {!isReceipt && (
          <fieldset className="rounded-lg border border-line bg-surface p-5">
            <legend className="px-1 text-sm font-semibold text-ink-900">Audience</legend>
            <p className="mb-3 text-sm text-ink-500">
              Attach one or more contact lists. At send time they are merged into one frozen campaign list, one entry per customer, so
              overlapping lists never cause duplicate messages.
            </p>
            {errors.contact_lists && <p className="mb-3 text-xs font-medium text-danger-text">{errors.contact_lists}</p>}
            {lists.isPending ? (
              <p className="flex items-center gap-2 text-sm text-ink-500">
                <Spinner className="h-4 w-4" /> Loading contact lists
              </p>
            ) : lists.isError ? (
              <ErrorState error={lists.error} onRetry={() => void lists.refetch()} />
            ) : listOptions.length === 0 ? (
              <p className="text-sm text-ink-500">
                No active contact lists yet. <Link to="/contact-lists" className="font-medium text-brand-800 underline">Create one first</Link>.
              </p>
            ) : (
              <>
                {listOptions.length > 6 && (
                  <input
                    type="search"
                    value={listSearch}
                    onChange={(event) => setListSearch(event.target.value)}
                    placeholder="Filter lists"
                    aria-label="Filter contact lists"
                    className="mb-3 h-10 w-full rounded-sm border border-line px-3 text-sm sm:w-72"
                  />
                )}
                <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                  {visibleLists.map((item) => (
                    <li key={item.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-subtle">
                        <input type="checkbox" checked={values.contact_lists.includes(item.id)} onChange={() => toggleList(item.id)} className="h-4 w-4 accent-brand-600" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink-900">{item.name}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                            <Tag>{item.list_kind}</Tag>
                            {item.is_master && <Tag>MASTER</Tag>}
                            {item.list_environment === 'TEST' && <Tag>TEST</Tag>}
                          </span>
                        </span>
                        <span className="text-sm text-ink-700 tabular-nums">{formatNumber(item.member_count)}</span>
                      </label>
                    </li>
                  ))}
                  {visibleLists.length === 0 && <li className="px-3 py-3 text-sm text-ink-500">No list matches that filter.</li>}
                </ul>
                <p className="mt-2 text-sm text-ink-500" aria-live="polite">
                  {values.contact_lists.length === 0
                    ? 'No list attached yet.'
                    : `${values.contact_lists.length} list${values.contact_lists.length === 1 ? '' : 's'} attached, ${formatNumber(audience)} members before de-duplication and consent checks.`}
                </p>
              </>
            )}
          </fieldset>
        )}

        {!isReceipt && (
          <FormSection title="Schedule">
            <Field
              label="Send at"
              error={errors.scheduled_at}
              hint={`Your local time. Leave blank to decide when publishing. Workspace time zone: ${me?.tenant.timezone ?? 'not set'}.`}
            >
              {(ids) => <TextInput {...ids} type="datetime-local" value={values.scheduled_at} onChange={(event) => set('scheduled_at', event.target.value)} />}
            </Field>
          </FormSection>
        )}

        <div className="flex flex-wrap items-center gap-3 pb-8">
          <button type="submit" disabled={save.isPending || (isEdit && !dirty)} className={buttonPrimary}>
            {save.isPending && <Spinner className="h-4 w-4 border-brand-800 border-t-white" />}
            {isEdit ? 'Save changes' : 'Create draft'}
          </button>
          <Link to={cancelTo} className={buttonSecondary}>
            Cancel
          </Link>
          {isEdit && !dirty && <span className="text-sm text-ink-500">No changes to save.</span>}
        </div>
      </form>
    </section>
  )
}
