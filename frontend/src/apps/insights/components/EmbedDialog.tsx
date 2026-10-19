/**
 * Embed on Another Site: a secret link that shows a report or a dashboard read-only, without signing in, for an intranet or a
 * partner page. The link shows once, when it is made, with the iframe to paste; afterwards only its label, use and expiry
 * show, and Revoke stops it at once. What the link shows is what its maker may see, personal data always masked.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { useState } from 'react'

import { Field, Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/format'
import { usageApi } from '../api'
import type { EmbedLink } from '../types'

const EXPIRY = [{ value: '30', label: 'In 30 days' }, { value: '90', label: 'In 90 days' }, { value: '365', label: 'In a year' }, { value: '7', label: 'In 7 days' }, { value: '', label: 'Never' }]

export function EmbedDialog({ kind, id, name, onClose }: { kind: 'report' | 'dashboard'; id: string; name: string; onClose: () => void }) {
  const toast = useToast()
  const client = useQueryClient()
  const key = ['insights', 'embeds', kind, id]
  const links = useQuery({ queryKey: key, queryFn: () => usageApi.embeds(kind, id) })
  const [label, setLabel] = useState('')
  const [days, setDays] = useState('90')
  const [made, setMade] = useState<EmbedLink | null>(null)
  const create = useMutation({
    mutationFn: () => usageApi.createEmbed({ kind, item_id: id, label: label.trim() || undefined, days: days ? Number(days) : null }),
    onSuccess: (link) => { setMade(link); setLabel(''); void client.invalidateQueries({ queryKey: key }) },
    onError: (error) => toast.failure(error, 'The link was not made'),
  })
  const revoke = useMutation({
    mutationFn: (embedId: string) => usageApi.revokeEmbed(embedId),
    onSuccess: () => { toast.success('Link revoked', 'It stops working at once.'); void client.invalidateQueries({ queryKey: key }) },
    onError: (error) => toast.failure(error, 'The link was not revoked'),
  })
  const address = made?.path ? `${window.location.origin}${made.path}` : ''
  const frame = address ? `<iframe src="${address}" title="${name.replace(/"/g, '&quot;')}" width="100%" height="${kind === 'dashboard' ? 900 : 600}" style="border:0"></iframe>` : ''

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`, 'Paste it into the other site.')
    } catch (error) {
      toast.failure(error, `The ${what.toLowerCase()} was not copied`)
    }
  }

  const live = (links.data?.embeds ?? []).filter((link) => !link.revoked_at)
  return (
    <Modal title="Embed on Another Site" subtitle={name} size="lg" scrollBody onClose={onClose} footer={<div className="flex justify-end"><button type="button" className={buttonSecondary} onClick={onClose}>Done</button></div>}>
      {links.isPending ? <Spinner label="Loading the links" /> : links.isError ? <ErrorState error={links.error} onRetry={() => links.refetch()} /> : !links.data.ready ? (
        <p className="text-sm text-ink-800">Embed links need database patch 0061, which is not applied to this workspace yet.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="max-w-prose text-sm text-ink-800">
            Anyone with the link sees this {kind} read-only, without signing in, as you see it: your row access rules apply and personal data is always masked. Keep the link private and revoke it when it is no longer needed.
          </p>
          {made && (
            <section aria-label="The new link" className="flex flex-col gap-3 rounded-md border border-brand-600 bg-brand-100/40 p-3">
              <p className="text-sm font-semibold text-ink-900">Copy the link now. It is not shown again.</p>
              <Field label="Address">
                {(ids) => (
                  <div className="flex gap-2"><TextInput id={ids.id} readOnly value={address} onFocus={(event) => event.currentTarget.select()} />
                    <button type="button" className={buttonSecondary} onClick={() => copy(address, 'Address')}><Copy size={16} strokeWidth={1.5} aria-hidden />Copy</button></div>
                )}
              </Field>
              <Field label="Code to paste into a page">
                {(ids) => (
                  <div className="flex gap-2"><TextInput id={ids.id} readOnly value={frame} onFocus={(event) => event.currentTarget.select()} />
                    <button type="button" className={buttonSecondary} onClick={() => copy(frame, 'Code')}><Copy size={16} strokeWidth={1.5} aria-hidden />Copy</button></div>
                )}
              </Field>
            </section>
          )}
          <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); create.mutate() }}>
            <div className="min-w-48 flex-1"><Field label="Label" hint="Where it goes, so you know which to revoke">{(ids) => <TextInput id={ids.id} describedBy={ids.describedBy} value={label} maxLength={100} placeholder="Partner Portal" onChange={(event) => setLabel(event.target.value)} />}</Field></div>
            <div className="w-40"><Field label="Expires">{(ids) => <Select id={ids.id} value={days} onChange={(event) => setDays(event.target.value)}>{EXPIRY.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>}</Field></div>
            <button type="submit" className={buttonPrimary} disabled={create.isPending}>Make a Link</button>
          </form>
          <section aria-label="Links" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink-900">Links That Work Now</h3>
            {live.length === 0 ? <p className="text-sm text-ink-800">No link yet.</p> : (
              <ul className="divide-y divide-line-subtle rounded-md border border-line">
                {live.map((link) => (
                  <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="flex flex-col">
                      <span className="font-medium text-ink-900">{link.label ?? 'No label'}</span>
                      <span className="text-xs text-ink-800">
                        Made {formatDateTime(link.created_at)}{link.created_by_name ? ` by ${link.created_by_name}` : ''} · {link.expires_at ? `expires ${formatDateTime(link.expires_at)}` : 'never expires'} · opened {link.uses} {link.uses === 1 ? 'time' : 'times'}
                      </span>
                    </span>
                    <button type="button" className={buttonSecondary} onClick={() => revoke.mutate(link.id)} disabled={revoke.isPending}>Revoke</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
