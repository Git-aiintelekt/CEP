/**
 * Settings → Engagement → Governance (docs/mockups/governance.html, option A): how often marketing may reach a person, and what
 * the rules did. The platform's caps are shown locked; the workspace adds its own beside them, and every cap applies, so its
 * own can only make sending stricter. A Gap Between Messages per channel skips a person who received marketing of that channel
 * within the last hours. Transactional messages and e-receipts are never capped.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Lock, Plus } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { buttonClass } from '@/components/buttonStyles'
import { buttonPrimary, buttonSecondary, Field, Select, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { Switch } from '@/components/Switch'
import { useAuth } from '@/auth/AuthContext'
import { api } from '@/lib/api'
import { formatNumber, formatPercent } from '@/lib/format'
import { saveFailure } from '@/lib/saveFeedback'
import type { GovernanceCap, GovernanceGapChannel, GovernanceOverview } from '@/lib/types'

const KEY = ['workspace', 'governance']
const CHANNELS = [['EMAIL', 'Email'], ['SMS', 'Text'], ['WHATSAPP', 'WhatsApp'], ['ALL', 'All Channels']] as const

function Card({ title, description, actions, children }: { title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h3 className="font-display text-card-heading font-semibold text-ink-900">{title}</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-ink-800">{description}</p>
        </div>
        {actions}
      </div>
      <div className="px-5 pt-3 pb-5">{children}</div>
    </section>
  )
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-line-subtle px-3 py-2.5">
      <p className="cep-num font-display text-section-title font-semibold text-ink-900">{value}</p>
      <p className="text-helper text-ink-800">{label}</p>
    </div>
  )
}

function CapForm({ cap, onClose }: { cap: GovernanceCap | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [channel, setChannel] = useState<string>(cap?.channel ?? 'EMAIL')
  const [most, setMost] = useState(String(cap?.max_messages ?? 3))
  const [days, setDays] = useState(String(cap?.period_days ?? 7))
  const save = useMutation({
    mutationFn: () => {
      const body = { channel, max_messages: Number(most), period_days: Number(days) }
      return cap ? api.patch<GovernanceCap>(`/workspace/governance/caps/${cap.id}/`, body) : api.post<GovernanceCap>('/workspace/governance/caps/', body)
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: KEY }); onClose() },
  })
  const errors = save.isError ? saveFailure(save.error, 'The cap was not saved', ['channel', 'max_messages', 'period_days']) : null
  return (
    <Modal title={cap ? 'Edit Cap' : 'Add Cap'} onClose={onClose}
      footer={<><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><button type="submit" form="cap-form" className={buttonPrimary} disabled={save.isPending}>{cap ? 'Save Cap' : 'Add Cap'}</button></>}>
      <form id="cap-form" className="space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
        <Field label="Channel" required error={errors?.fields.channel} hint="Text covers SMS and MMS. All Channels counts every email, text and WhatsApp message together.">
          {(ids) => <Select {...ids} value={channel} onChange={(event) => setChannel(event.target.value)}>{CHANNELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>}
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28"><Field label="Most" required error={errors?.fields.max_messages}>
            {(ids) => <TextInput {...ids} type="number" min={1} max={1000} inputMode="numeric" value={most} onChange={(event) => setMost(event.target.value)} />}
          </Field></div>
          <p className="pb-2 text-sm text-ink-800">messages per</p>
          <div className="w-28"><Field label="Days" required error={errors?.fields.period_days}>
            {(ids) => <TextInput {...ids} type="number" min={1} max={365} inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />}
          </Field></div>
        </div>
        <p className="text-sm text-ink-800">A person who has received this many marketing messages in the last {Number(days) === 1 ? 'day' : `${days || 'N'} days`} is skipped by the next marketing send, counted as Frequency Capped.</p>
        {errors && !Object.keys(errors.fields).length && <ErrorState title="The cap was not saved" error={save.error} />}
      </form>
    </Modal>
  )
}

const GAP_NOUN: Record<GovernanceGapChannel['channel'], string> = { EMAIL: 'email', SMS: 'text', WHATSAPP: 'WhatsApp message' }

function GapRow({ entry, editable }: { entry: GovernanceGapChannel; editable: boolean }) {
  const queryClient = useQueryClient()
  const own = entry.own
  const active = own?.is_active ?? false
  const [hours, setHours] = useState(String(own?.hours ?? entry.recommended_hours))
  const save = useMutation({
    mutationFn: (body: { hours?: number; is_active?: boolean }) => api.put<GovernanceGapChannel>(`/workspace/governance/gaps/${entry.channel}/`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })
  const errors = save.isError ? saveFailure(save.error, 'The gap was not saved', ['hours']) : null
  const commit = () => {
    if (active && own && Number(hours) !== own.hours) save.mutate({ hours: Number(hours) })
  }
  const noun = GAP_NOUN[entry.channel]
  return (
    <div className="flex flex-col gap-2 border-t border-line-subtle py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">{entry.channel_label}</p>
          <p className="text-sm text-ink-800">{active && own ? `Skip a person who received a marketing ${noun} in the last ${own.hours} ${own.hours === 1 ? 'hour' : 'hours'}.` : `Off: no gap of your own between ${noun}s.`}</p>
        </div>
        {editable ? (
          <div className="flex items-center gap-2 text-sm text-ink-800">
            <div className="w-20">
              <TextInput type="number" min={1} max={168} inputMode="numeric" aria-label={`${entry.channel_label} gap in hours`} value={hours} disabled={save.isPending}
                onChange={(event) => setHours(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') commit() }} />
            </div>
            hours
            <Switch checked={active} disabled={save.isPending} onChange={() => save.mutate(active ? { is_active: false } : { hours: Number(hours), is_active: true })}
              ariaLabel={`${entry.channel_label} gap in use`} />
          </div>
        ) : own && <span className="cep-num text-sm text-ink-900">{own.rule} · {own.is_active ? 'On' : 'Off'}</span>}
      </div>
      {errors && <p className="text-helper font-medium text-danger-text" role="alert">{errors.fields.hours ?? errors.short}</p>}
      {entry.covered_by && <p className="text-helper text-ink-800">The cap of {entry.covered_by} already keeps at least this gap, so the gap adds nothing while that cap applies.</p>}
      {entry.platform.map((gap) => (
        <p key={gap.id} className="flex flex-wrap items-center gap-2 text-helper text-ink-800">
          <Tag icon={Building2}>Platform</Tag><span className="cep-num text-ink-900">{gap.rule}</span>{!gap.is_active && <span>Off</span>}
          <span className="inline-flex items-center gap-1" title="Set by the platform for your workspace; changed in the back-office."><Lock size={14} strokeWidth={1.5} aria-hidden />Locked</span>
        </p>
      ))}
    </div>
  )
}

export function GovernancePage() {
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const editable = can('governance.edit')
  const [editing, setEditing] = useState<GovernanceCap | 'new' | null>(null)
  const data = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<GovernanceOverview>('/workspace/governance/', undefined, signal) })
  const toggle = useMutation({
    mutationFn: (cap: GovernanceCap) => api.patch<GovernanceCap>(`/workspace/governance/caps/${cap.id}/`, { is_active: !cap.is_active }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })
  const recommended = useMutation({
    mutationFn: () => api.post<{ added: string[] }>('/workspace/governance/standard/'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })
  const remove = useMutation({
    mutationFn: (cap: GovernanceCap) => api.delete(`/workspace/governance/caps/${cap.id}/`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })

  if (data.isError) return <ErrorState title="Governance could not be loaded" error={data.error} onRetry={() => void data.refetch()} />
  if (data.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const { caps, gaps, activity, text_quiet_hours: quiet, soft_bounces: softBounces } = data.data
  const platformCaps = caps.filter((cap) => cap.platform).length
  const ownCaps = caps.length - platformCaps

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">Governance</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-ink-800">How often marketing may reach a person. Every marketing send is checked against these rules; transactional messages and e-receipts are never held back.</p>
      </div>

      <Card title={`Last ${activity.days} Days`} description="What the rules did: one recipient for each person on each campaign send.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Figure value={formatNumber(activity.checked)} label="Recipients Checked" />
          <Figure value={activity.sent_percent === null ? '—' : formatPercent(activity.sent_percent)} label="Sent Within the Rules" />
          <Figure value={formatNumber(activity.capped)} label="Skipped by a Cap or Gap" />
        </div>
      </Card>

      <Card title="Frequency Caps" description="The most marketing one person receives in a period. A message over any cap is skipped for that person and counted as Frequency Capped."
        actions={editable && <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} onClick={() => setEditing('new')}><Plus size={14} strokeWidth={1.5} aria-hidden />Add Cap</button>}>
        {caps.length === 0 ? (
          <EmptyState variant="plain" title="No Caps Yet" hint="Without a cap, a person can receive every campaign they are on. A common start: 3 emails per 7 days and 4 texts per 30 days." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line-subtle">
            <table className="w-full text-sm" aria-label="Frequency Caps">
              <thead><tr className="border-b border-line bg-surface-subtle text-left text-helper font-semibold text-ink-800">
                <th className="px-3 py-2">Channel</th><th className="px-3 py-2">Most</th><th className="px-3 py-2">Set By</th><th className="px-3 py-2">In Use</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>
                {caps.map((cap) => (
                  <tr key={cap.id} className="border-b border-line-subtle last:border-b-0">
                    <td className="px-3 py-2.5 text-ink-900">{cap.channel_label}</td>
                    <td className="cep-num px-3 py-2.5 text-ink-900">{cap.rule}</td>
                    <td className="px-3 py-2.5">{cap.platform ? <Tag icon={Building2}>Platform</Tag> : <Tag>This Workspace</Tag>}</td>
                    <td className="px-3 py-2.5">
                      {cap.platform || !editable ? <span className="text-ink-800">{cap.is_active ? 'On' : 'Off'}</span>
                        : <Switch checked={cap.is_active} disabled={toggle.isPending} onChange={() => toggle.mutate(cap)} ariaLabel={`${cap.rule} in use`} />}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {cap.platform ? <span className="inline-flex items-center gap-1 text-helper text-ink-800" title="Set by the platform for your workspace; changed in the back-office."><Lock size={14} strokeWidth={1.5} aria-hidden />Locked</span>
                        : editable && <span className="inline-flex gap-3">
                          <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setEditing(cap)}>Edit</button>
                          <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={remove.isPending} onClick={() => window.confirm(`Remove the cap of ${cap.rule}?`) && remove.mutate(cap)}>Remove</button>
                        </span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editable && ownCaps === 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-subtle bg-surface-subtle px-4 py-3">
            <p className="max-w-xl text-sm text-ink-800">No caps of your own yet. The recommended start: 3 emails per 7 days, 4 texts per 30 days, 2 WhatsApp messages per 7 days and 5 messages per 7 days across all channels. Each can be changed or removed afterwards.</p>
            <button type="button" className={buttonPrimary} disabled={recommended.isPending} onClick={() => recommended.mutate()}>Use the Recommended Caps</button>
          </div>
        )}
        {recommended.isError && <div className="mt-3"><ErrorState title="The recommended caps were not added" error={recommended.error} /></div>}
        {platformCaps > 0 && <p className="mt-3 text-helper text-ink-800">{platformCaps === 1 ? 'One cap is' : `${platformCaps} caps are`} set by the platform for your workspace. Caps of your own apply as well, so they can only make sending stricter.</p>}
        {(toggle.isError || remove.isError) && <div className="mt-3"><ErrorState title="The cap was not changed" error={toggle.error ?? remove.error} /></div>}
      </Card>

      <Card title="Gap Between Messages" description="A person who received marketing recently is skipped by the next send of the same channel, counted as Frequency Capped. Like Klaviyo's Smart Sending.">
        <div aria-label="Gap Between Messages" role="group">
          {gaps.map((entry) => <GapRow key={`${entry.channel}-${entry.own?.row_version ?? 0}-${entry.own?.hours ?? ''}`} entry={entry} editable={editable} />)}
        </div>
      </Card>

      <Card title="Send Times" description="When marketing may arrive.">
        <ul className="space-y-2 text-sm text-ink-900">
          <li>{quiet ? <>Texts: quiet hours <span className="cep-num font-semibold">{quiet.start}–{quiet.end}</span> in the workspace's time zone. A text due inside them waits until they end. <Tag icon={Building2}>Platform</Tag></> : 'Texts: no quiet hours are set.'}</li>
          <li>A campaign can go out at the same clock time in each person's own time zone: Send at Each Recipient's Local Time on its Schedule step.</li>
        </ul>
      </Card>

      <Card title="Priority and Exemptions" description="What the caps leave alone.">
        <ul className="space-y-2 text-sm text-ink-900">
          <li><span className="font-semibold">Transactional messages and e-receipts</span> are never capped and do not count towards a cap.</li>
          <li><span className="font-semibold">A campaign</span> can be set to ignore the caps: Apply Corporate Frequency Limits on its Schedule step, on by default. Switching it off is recorded in the activity log.</li>
        </ul>
      </Card>

      <Card title="List Hygiene" description="Who stops getting messages, to protect the sending reputation.">
        <ul className="space-y-2 text-sm text-ink-900">
          <li>A <span className="font-semibold">hard bounce</span> or a <span className="font-semibold">spam complaint</span> blocks the address at once.</li>
          <li><span className="cep-num font-semibold">{softBounces}</span> soft bounces block an address.</li>
          <li>Blocked addresses and opt-outs are listed under <Link to="/settings/suppressions" className="font-semibold text-brand-800 hover:underline">Suppressions</Link>.</li>
        </ul>
      </Card>

      {editing && <CapForm cap={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
