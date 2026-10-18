/**
 * Share: who can open a report or a dashboard besides its owner. Everyone in the workspace, or only the people and roles
 * listed, each able to view it or to edit it (with the right to build reports). A role reaches everyone holding it. The
 * owner and report administrators share; the list is saved as a whole.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, User, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { IconButton } from '@/components/Button'
import { Select, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { sharingApi } from '../api'
import type { Principal, Share, ShareKind } from '../types'

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const t = window.setTimeout(() => setDebounced(value), ms); return () => window.clearTimeout(t) }, [value, ms])
  return debounced
}

export function ShareDialog({ kind, id, name, onClose }: { kind: ShareKind; id: string; name: string; onClose: () => void }) {
  const toast = useToast()
  const client = useQueryClient()
  const current = useQuery({ queryKey: ['insights', 'shares', kind, id], queryFn: () => sharingApi.shares(kind, id) })
  const [visibility, setVisibility] = useState<'PRIVATE' | 'WORKSPACE' | null>(null)
  const [shares, setShares] = useState<Share[] | null>(null)
  const [q, setQ] = useState('')
  const term = useDebounced(q.trim(), 250)
  const found = useQuery({ queryKey: ['insights', 'principals', term], queryFn: () => sharingApi.principals(term), enabled: term.length > 0 })
  const shown = shares ?? current.data?.shares ?? []
  const save = useMutation({
    mutationFn: () => sharingApi.saveShares(kind, id, { visibility: visibility ?? current.data?.visibility ?? 'PRIVATE', shares: shown.map((s) => ({ kind: s.kind, id: s.id, permission: s.permission })) }),
    onSuccess: () => {
      toast.success('Sharing saved', `${name} is shared as you set it.`)
      void client.invalidateQueries({ queryKey: ['insights'] })
      onClose()
    },
    onError: (error) => toast.failure(error, 'The sharing was not saved'),
  })
  const add = (who: Principal) => { if (!shown.some((s) => s.kind === who.kind && s.id === who.id)) setShares([...shown, { ...who, permission: 'view' }]); setQ('') }
  const results = [...(found.data?.roles ?? []), ...(found.data?.people ?? [])].filter((who) => !shown.some((s) => s.kind === who.kind && s.id === who.id))

  return (
    <Modal title={`Share ${kind === 'report' ? 'Report' : 'Dashboard'}`} subtitle={name} onClose={onClose} size="picker"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} onClick={() => save.mutate()} disabled={save.isPending || current.isPending || !current.data?.can_share}>Save</button>
        </div>
      )}>
      {current.isPending ? <Spinner label="Loading the sharing" /> : current.isError ? <ErrorState error={current.error} onRetry={() => void current.refetch()} /> : (
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-semibold text-ink-900">Who can open it</legend>
            {(['PRIVATE', 'WORKSPACE'] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm text-ink-900">
                <input type="radio" name="visibility" value={value} checked={(visibility ?? current.data.visibility) === value} onChange={() => setVisibility(value)} className="h-4 w-4 accent-brand-600" />
                {value === 'PRIVATE' ? 'You and the people and roles below' : 'Everyone in the workspace'}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2">
            <label className="relative">
              <span className="sr-only">Find a person or a role</span>
              <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-700" />
              <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Find a person or a role"
                className="h-8 w-full rounded-control-md border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-700 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
            </label>
            {term && (
              <ul aria-label="People and roles found" className="max-h-44 overflow-y-auto rounded-md border border-line">
                {found.isPending ? <li className="p-2"><Spinner size="sm" label="Looking" /></li> : results.length === 0 ? <li className="p-2 text-xs text-ink-800">No one matches “{term}”.</li> : results.map((who) => (
                  <li key={`${who.kind}:${who.id}`}>
                    <button type="button" onClick={() => add(who)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-hover">
                      {who.kind === 'role' ? <Users size={14} strokeWidth={1.5} aria-hidden className="text-ink-700" /> : <User size={14} strokeWidth={1.5} aria-hidden className="text-ink-700" />}
                      <span className="min-w-0 flex-1 truncate text-ink-900">{who.name}</span>
                      <span className="text-xs text-ink-700">{who.kind === 'role' ? `Role · ${who.detail}` : who.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ul aria-label="Shared with" className="flex flex-col divide-y divide-line-subtle rounded-md border border-line">
            {shown.length === 0 && <li className="p-3 text-sm text-ink-800">Not shared with anyone yet.</li>}
            {shown.map((share) => (
              <li key={`${share.kind}:${share.id}`} className="flex items-center gap-2 px-3 py-2">
                {share.kind === 'role' ? <Users size={14} strokeWidth={1.5} aria-hidden className="text-ink-700" /> : <User size={14} strokeWidth={1.5} aria-hidden className="text-ink-700" />}
                <span className="min-w-0 flex-1"><span className="block truncate text-sm text-ink-900">{share.name}</span><span className="block text-xs text-ink-700">{share.kind === 'role' ? `Role · ${share.detail}` : share.detail}</span></span>
                <span className="w-32"><Select aria-label={`${share.name} can`} controlSize="sm" value={share.permission}
                  onChange={(event) => setShares(shown.map((s) => (s.kind === share.kind && s.id === share.id ? { ...s, permission: event.target.value as Share['permission'] } : s)))}>
                  <option value="view">Can View</option><option value="edit">Can Edit</option>
                </Select></span>
                <IconButton label={`Stop sharing with ${share.name}`} icon={X} size="xs" onClick={() => setShares(shown.filter((s) => !(s.kind === share.kind && s.id === share.id)))} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-800">Can Edit lets someone who builds reports change it. Row access rules still apply: each person sees only the rows they may see.</p>
        </div>
      )}
    </Modal>
  )
}
