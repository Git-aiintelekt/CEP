/**
 * Governance → Blackout Dates (docs/mockups/governance.html, option A): days with no marketing on any channel, in the
 * workspace's time zone. A send due on one waits for the next clear day, then for its send window; nobody is skipped. The
 * platform's dates are shown locked; the workspace adds its own beside them, one day or up to 31, once or every year.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Lock } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { buttonClass } from '@/components/buttonStyles'
import { Checkbox } from '@/components/Checkbox'
import { buttonPrimary, buttonSecondary, Field, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { EmptyState, ErrorState } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { Switch } from '@/components/Switch'
import { api } from '@/lib/api'
import { saveFailure } from '@/lib/saveFeedback'
import type { GovernanceBlackout } from '@/lib/types'

const KEY = ['workspace', 'governance']
const MAX_DAYS = 31

export function BlackoutForm({ blackout, onClose }: { blackout: GovernanceBlackout | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(blackout?.name ?? '')
  const [from, setFrom] = useState(blackout?.from ?? '')
  const [to, setTo] = useState(blackout && blackout.to !== blackout.from ? blackout.to : '')
  const [yearly, setYearly] = useState(blackout?.yearly ?? false)
  const save = useMutation({
    mutationFn: () => {
      const body = { name, from, to: to || from, yearly }
      return blackout ? api.patch(`/workspace/governance/blackouts/${blackout.id}/`, body) : api.post('/workspace/governance/blackouts/', body)
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: KEY }); onClose() },
  })
  const errors = save.isError ? saveFailure(save.error, 'The date was not saved', ['name', 'from', 'to']) : null
  return (
    <Modal title={blackout ? 'Edit Blackout Date' : 'Add Blackout Date'} onClose={onClose}
      footer={<><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><button type="submit" form="blackout-form" className={buttonPrimary} disabled={save.isPending}>{blackout ? 'Save Date' : 'Add Date'}</button></>}>
      <form id="blackout-form" className="space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
        <Field label="Name" required error={errors?.fields.name} hint="Shown in the list and in a waiting campaign's activity log, such as Christmas.">
          {(ids) => <TextInput {...ids} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-44"><Field label="From" required error={errors?.fields.from}>
            {(ids) => <TextInput {...ids} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />}
          </Field></div>
          <div className="w-44"><Field label="To" error={errors?.fields.to} hint={`Empty for one day. At most ${MAX_DAYS} days.`}>
            {(ids) => <TextInput {...ids} type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />}
          </Field></div>
        </div>
        <Checkbox label="Every Year, on the same dates" checked={yearly} onChange={(event) => setYearly(event.target.checked)} />
        <p className="text-sm text-ink-800">No marketing goes out on any channel on these days, in the workspace's time zone. A send due on one waits for the next day, then for its send window. Holidays that move, such as Thanksgiving or Eid, are added each year.</p>
        {errors && !Object.keys(errors.fields).length && <ErrorState title="The date was not saved" error={save.error} />}
      </form>
    </Modal>
  )
}

function BlackoutRow({ item, editable, onEdit }: { item: GovernanceBlackout; editable: boolean; onEdit: () => void }) {
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: (body: { is_active: boolean } | null) => body ? api.patch(`/workspace/governance/blackouts/${item.id}/`, body) : api.delete(`/workspace/governance/blackouts/${item.id}/`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })
  return (
    <li className="flex flex-col gap-1 border-t border-line-subtle py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`flex min-w-0 flex-wrap items-center gap-2 ${item.past ? 'text-ink-800' : ''}`}>
          <span className={`cep-num text-sm font-semibold ${item.past ? 'text-ink-800' : 'text-ink-900'}`}>{item.rule}</span>
          <span className="text-sm text-ink-800">· {item.name}</span>
          {item.platform && <Tag icon={Building2}>Platform</Tag>}
          {item.today && item.is_active && <Tag tone="warning">Today</Tag>}
          {item.past && <Tag>Passed</Tag>}
        </div>
        {item.platform ? (
          <span className="inline-flex items-center gap-2 text-helper text-ink-800">
            {!item.is_active && <span>Off</span>}
            <span className="inline-flex items-center gap-1" title="Set by the platform for your workspace; changed in the back-office."><Lock size={14} strokeWidth={1.5} aria-hidden />Locked</span>
          </span>
        ) : editable ? (
          <span className="inline-flex items-center gap-3">
            <Switch checked={item.is_active} disabled={change.isPending} onChange={() => change.mutate({ is_active: !item.is_active })} ariaLabel={`${item.name} in use`} />
            <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={onEdit}>Edit</button>
            <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={change.isPending}
              onClick={() => window.confirm(`Remove the blackout date ${item.name}?`) && change.mutate(null)}>Remove</button>
          </span>
        ) : <span className="text-sm text-ink-800">{item.is_active ? 'On' : 'Off'}</span>}
      </div>
      {change.isError && <p className="text-helper font-medium text-danger-text" role="alert">{saveFailure(change.error, 'The date was not changed', []).short}</p>}
    </li>
  )
}

export function BlackoutDates({ blackouts, editable, onEdit }: { blackouts: GovernanceBlackout[]; editable: boolean; onEdit: (item: GovernanceBlackout) => void }) {
  if (blackouts.length === 0) {
    return <EmptyState variant="plain" title="No Blackout Dates" hint="Every day is open to marketing. Common choices: Christmas Day and New Year's Day every year, or the day of a system change." />
  }
  return (
    <ul aria-label="Blackout Dates">
      {blackouts.map((item) => <BlackoutRow key={`${item.id}-${item.row_version}`} item={item} editable={editable} onEdit={() => onEdit(item)} />)}
    </ul>
  )
}
