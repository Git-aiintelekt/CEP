/**
 * Governance → Unengaged Contacts (docs/mockups/unengaged-contacts.html, option A): marketing email leaves out people with no
 * click, purchase or preference-page visit in the rule's days, once CEP has mailed them that long and sent them enough emails.
 * The card shows the rule as one sentence, what it does to the workspace's email contacts today, and what it did in the last
 * 30 days. Nobody is unsubscribed: the next engagement brings a person back. The platform may set a longest allowed.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Clock, Download, Lock } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { buttonClass } from '@/components/buttonStyles'
import { buttonPrimary, buttonSecondary, Field, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { Switch } from '@/components/Switch'
import { api } from '@/lib/api'
import { formatDay as dayLabel, formatNumber, formatPercent } from '@/lib/format'
import { saveFailure } from '@/lib/saveFeedback'
import { saveFile } from '@/lib/saveFile'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import type { GovernanceUnengaged, GovernanceUnengagedToday } from '@/lib/types'

const KEY = ['workspace', 'governance']
const MIN_DAYS = 30
const MAX_DAYS = 360
const MAX_EMAILS = 20
const ENGAGED = ['Email click', 'Text link click', 'Purchase or e-receipt', 'Preference page visit']

const emails = (count: number) => `${count} marketing email${count === 1 ? '' : 's'}`

function Split({ today }: { today: GovernanceUnengagedToday }) {
  const total = today.total || 1
  const parts = [
    { key: 'engaged', label: 'Engaged in the period', hint: '', value: today.engaged, tone: 'bg-brand-100' },
    { key: 'new', label: 'Too new to judge', hint: 'first email too recent, or too few emails', value: today.too_new, tone: 'bg-fill-muted' },
    { key: 'unengaged', label: 'Unengaged: left out', hint: '', value: today.unengaged, tone: 'bg-brand-800' },
  ]
  return (
    <div>
      <div className="mt-2 mb-2 flex h-2.5 overflow-hidden rounded-full bg-fill-subtle" aria-hidden>
        {parts.map((part) => part.value > 0 && <span key={part.key} className={part.tone} style={{ width: `${(100 * part.value) / total}%` }} />)}
      </div>
      <dl className="space-y-1 text-sm">
        {parts.map((part) => (
          <div key={part.key} className="flex items-center gap-2">
            <span className={`size-2.5 shrink-0 rounded-sm ${part.tone}`} aria-hidden />
            <dt className="text-ink-900">{part.label}{part.hint && <span className="ml-1.5 text-helper text-ink-800">{part.hint}</span>}</dt>
            <dd className="cep-num ml-auto font-medium text-ink-900">{formatNumber(part.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function UnengagedForm({ card, onClose }: { card: GovernanceUnengaged; onClose: () => void }) {
  const queryClient = useQueryClient()
  const start = card.own ?? card.applies ?? card.recommended
  const [days, setDays] = useState(String(start.days))
  const [minimum, setMinimum] = useState(String(start.min_emails))
  const topDays = Math.min(MAX_DAYS, card.limit?.days ?? MAX_DAYS)
  const topEmails = Math.min(MAX_EMAILS, card.limit?.min_emails ?? MAX_EMAILS)
  const wanted = useDebouncedValue({ days: Number(days), min_emails: Number(minimum) }, 400)
  const valid = Number.isInteger(wanted.days) && wanted.days >= MIN_DAYS && wanted.days <= MAX_DAYS && Number.isInteger(wanted.min_emails) && wanted.min_emails >= 1 && wanted.min_emails <= MAX_EMAILS
  const preview = useQuery({
    queryKey: [...KEY, 'unengaged-preview', wanted.days, wanted.min_emails],
    queryFn: ({ signal }) => api.get<GovernanceUnengagedToday>('/workspace/governance/unengaged/preview/', wanted, signal),
    enabled: valid,
  })
  const save = useMutation({
    mutationFn: () => api.put('/workspace/governance/unengaged/', { days: Number(days), min_emails: Number(minimum), is_active: card.own?.is_active ?? true }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: KEY }); onClose() },
  })
  const errors = save.isError ? saveFailure(save.error, 'The rule was not saved', ['days', 'min_emails']) : null
  const now = card.today
  return (
    <Modal title="Unengaged Contacts" onClose={onClose}
      footer={<><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><button type="submit" form="unengaged-form" className={buttonPrimary} disabled={save.isPending}>Save Rule</button></>}>
      <form id="unengaged-form" className="space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="No Engagement In" required error={errors?.fields.days} hint={`${MIN_DAYS} to ${topDays} days${card.limit ? " (the platform's longest)" : ''}.`}>
            {(ids) => <TextInput {...ids} inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />}
          </Field>
          <Field label="After at Least" required error={errors?.fields.min_emails} hint={`Marketing emails sent in those days. 1 to ${topEmails}.`}>
            {(ids) => <TextInput {...ids} inputMode="numeric" value={minimum} onChange={(event) => setMinimum(event.target.value)} />}
          </Field>
        </div>
        <div>
          <p className="text-sm font-medium text-ink-900">What Counts as Engaged</p>
          <p className="mt-1 text-sm text-ink-800">{ENGAGED.join(', ')}. Opens and clicks by security scanners are not counted.</p>
        </div>
        <div className="rounded-lg border border-line-subtle bg-surface-subtle px-4 py-3 text-sm text-ink-900" aria-live="polite" data-unengaged-preview>
          {!valid ? <span className="text-ink-800">Enter the days and the emails to see who would be left out.</span>
            : preview.data ? <>
              <span className="cep-num font-semibold">{formatNumber(preview.data.unengaged)}</span> would be left out today, of {formatNumber(preview.data.total)} email contacts
              {preview.data.total > 0 && <> ({formatPercent((100 * preview.data.unengaged) / preview.data.total)})</>}.
              {card.applies && <span className="text-ink-800"> Now: {formatNumber(now.unengaged)} at {card.applies.days} days.</span>}
              {preview.data.starts_on && <span className="block text-ink-800">Nobody can be left out before {dayLabel(preview.data.starts_on)}.</span>}
            </> : <span className="text-ink-800">Counting…</span>}
        </div>
        {errors && !Object.keys(errors.fields).length && <ErrorState title="The rule was not saved" error={save.error} />}
      </form>
    </Modal>
  )
}

function useChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { is_active: boolean } | { days: number; min_emails: number; is_active: boolean }) => api.put('/workspace/governance/unengaged/', body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

/** the card's header: when it starts, Edit and the switch (the workspace's own rule), or Make Stricter (the platform's alone) */
export function UnengagedActions({ card, editable, onEdit }: { card: GovernanceUnengaged; editable: boolean; onEdit: () => void }) {
  const change = useChange()
  const { own, applies, today } = card
  if (!applies && !own) return null
  return (
    <div className="flex items-center gap-3">
      {today.starts_on && applies && <Tag icon={Clock}>{`Starts ${dayLabel(today.starts_on)}`}</Tag>}
      {own && editable && <>
        <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} onClick={onEdit}>Edit</button>
        <Switch checked={own.is_active} disabled={change.isPending} onChange={() => change.mutate({ is_active: !own.is_active })} ariaLabel="Unengaged Contacts in use" />
      </>}
      {!own && editable && <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} onClick={onEdit}>Make Stricter</button>}
      {change.isError && <span className="text-helper text-danger-text">Not changed. Try again.</span>}
    </div>
  )
}

export function UnengagedContacts({ card, editable }: { card: GovernanceUnengaged; editable: boolean }) {
  const [downloading, setDownloading] = useState(false)
  const change = useChange()
  const { today, recent, applies, own, limit } = card
  const shown = applies ?? (own ? { days: own.days, min_emails: own.min_emails } : null)

  if (!shown) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-subtle bg-surface-subtle px-4 py-3">
        <p className="max-w-xl text-sm text-ink-800">No rule yet: every contact with consent gets marketing email, however long they have ignored it. Recommended: leave out anyone with no engagement in {card.recommended.days} days, after at least {emails(card.recommended.min_emails)}.</p>
        {editable && <button type="button" className={buttonPrimary} disabled={change.isPending}
          onClick={() => change.mutate({ days: card.recommended.days, min_emails: card.recommended.min_emails, is_active: true })}>Use {card.recommended.days} Days</button>}
      </div>
    )
  }

  const download = async () => {
    setDownloading(true)
    try { saveFile(await api.download('/workspace/governance/unengaged/people/'), 'unengaged-contacts.csv') } finally { setDownloading(false) }
  }

  return (
    <div className="space-y-4" aria-label="Unengaged Contacts" role="group">
      <p className={`text-sm ${applies ? 'text-ink-900' : 'text-ink-800'}`} data-unengaged-rule>
        Leave out of marketing email anyone with <span className="font-semibold">no engagement in <span className="cep-num">{shown.days}</span> days</span>, after at least <span className="cep-num font-semibold">{shown.min_emails}</span> marketing email{shown.min_emails === 1 ? '' : 's'} in that time.
        {!applies && <span className="ml-1">Switched off: nobody is left out.</span>}
      </p>

      {applies && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div>
            <p className="text-helper font-semibold tracking-wide text-ink-800 uppercase">Today</p>
            {today.unengaged === 0 && today.starts_on ? (
              <div className="mt-1">
                <p className="font-display text-card-heading font-semibold text-ink-900">Nobody is left out yet</p>
                <p className="mt-0.5 text-sm text-ink-800">A person is judged only after {applies.days} days of marketing email. The first can be left out on {dayLabel(today.starts_on)}; people added later each get their own {applies.days} days.</p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-ink-800">
                <span className="cep-num mr-1.5 font-display text-section-title font-semibold text-ink-900">{formatNumber(today.unengaged)}</span>
                of {formatNumber(today.total)} email contacts left out{today.total > 0 && ` (${formatPercent((100 * today.unengaged) / today.total)})`}
              </p>
            )}
            <Split today={today} />
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-helper font-semibold tracking-wide text-ink-800 uppercase">What Counts as Engaged</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">{ENGAGED.map((item) => <li key={item}><Tag>{item}</Tag></li>)}</ul>
              <p className="mt-1.5 text-helper text-ink-800">Opens are not counted: Apple Mail opens every message on its own. Clicks by security scanners are not counted either.</p>
            </div>
            <div>
              <p className="text-helper font-semibold tracking-wide text-ink-800 uppercase">Last {recent.days} Days</p>
              <p className="mt-1 text-sm text-ink-800"><span className="cep-num font-semibold text-ink-900">{formatNumber(recent.left_out)}</span> campaign recipients left out as unengaged; <span className="cep-num font-semibold text-ink-900">{formatNumber(recent.came_back)}</span> {recent.came_back === 1 ? 'person' : 'people'} came back after a click or purchase.</p>
            </div>
          </div>
        </div>
      )}

      {(limit || card.platform.length > 0 || today.unengaged > 0) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle pt-3 text-sm">
          {limit && <span className="inline-flex items-center gap-1 text-helper text-ink-800" title="Set by the platform for your workspace; changed in the back-office.">
            <Lock size={14} strokeWidth={1.5} aria-hidden />Platform: at most {limit.days} days and {emails(limit.min_emails)}</span>}
          {!own && card.platform.length > 0 && <Tag icon={Building2}>Platform</Tag>}
          {applies && today.unengaged > 0 && (
            <button type="button" className={`ml-auto ${buttonClass({ variant: 'link', size: 'sm' })}`} disabled={downloading} onClick={() => void download()}>
              <Download size={14} strokeWidth={1.5} aria-hidden />Download the {formatNumber(today.unengaged)} {today.unengaged === 1 ? 'Person' : 'People'}
            </button>
          )}
        </div>
      )}
      {change.isError && <ErrorState title="The rule was not changed" error={change.error} />}
    </div>
  )
}
