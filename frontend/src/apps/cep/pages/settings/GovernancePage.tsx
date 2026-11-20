/**
 * Settings → Engagement → Governance (docs/mockups/governance.html, option A): how often marketing may reach a person, and what
 * the rules did. The platform's caps are shown locked; the workspace adds its own beside them, and every cap applies, so its
 * own can only make sending stricter. Transactional messages and e-receipts are never capped.
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
import type { GovernanceCap, GovernanceOverview } from '@/lib/types'

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
  const remove = useMutation({
    mutationFn: (cap: GovernanceCap) => api.delete(`/workspace/governance/caps/${cap.id}/`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })

  if (data.isError) return <ErrorState title="Governance could not be loaded" error={data.error} onRetry={() => void data.refetch()} />
  if (data.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const { caps, activity, text_quiet_hours: quiet, soft_bounces: softBounces } = data.data
  const platformCaps = caps.filter((cap) => cap.platform).length

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
          <Figure value={formatNumber(activity.capped)} label="Skipped by a Cap" />
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
        {platformCaps > 0 && <p className="mt-3 text-helper text-ink-800">{platformCaps === 1 ? 'One cap is' : `${platformCaps} caps are`} set by the platform for your workspace. Caps of your own apply as well, so they can only make sending stricter.</p>}
        {(toggle.isError || remove.isError) && <div className="mt-3"><ErrorState title="The cap was not changed" error={toggle.error ?? remove.error} /></div>}
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
