/**
 * Switch Workspace (docs/mockups/switch-workspace.html, option B), for platform administrators: every workspace, searchable, with
 * its plan, users and status; the chosen one and a reason, then Switch. You enter as yourself with full rights; the visit and the
 * reason are recorded and shown to the workspace's administrators (apps/platform_ops/visits.py). The tab then works in that
 * workspace; its own Platform session stays stored for Back to Platform (lib/visit.ts).
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { buttonPrimary, buttonSecondary, Field, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { api, ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { PlatformWorkspace, VisitStart } from '@/lib/types'
import { enterVisit } from '@/lib/visit'

const REASON_MIN = 5

export function SwitchWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<PlatformWorkspace | null>(null)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const list = useQuery({
    queryKey: ['platform', 'workspaces', q.trim()],
    queryFn: ({ signal }) => api.get<{ workspaces: PlatformWorkspace[]; ready: boolean }>('/platform/workspaces/', q.trim() ? { q: q.trim() } : undefined, signal),
    placeholderData: (previous) => previous,
  })
  const go = useMutation({
    mutationFn: () => api.post<VisitStart>('/platform/visits/', { workspace: chosen?.code, reason: reason.trim() }),
    onSuccess: (visit) => enterVisit(visit),
    onError: (error) => setErrors(error instanceof ApiError ? { ...error.fieldErrors, ...(Object.keys(error.fieldErrors).length ? {} : { workspace: error.message }) } : { workspace: 'The switch did not go through.' }),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!chosen) { setErrors({ workspace: 'Choose a workspace.' }); return }
    if (reason.trim().length < REASON_MIN) { setErrors({ reason: 'Say in a few words why you are going in; the workspace’s administrators read it.' }); return }
    go.mutate()
  }
  const rows = list.data?.workspaces ?? []
  return (
    <Modal title="Switch Workspace" subtitle="You enter as yourself with full rights until you come back. The workspace’s administrators see the visit and your reason." onClose={onClose} size="picker"
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="switch-workspace" className={buttonPrimary} disabled={go.isPending}>{go.isPending ? <><Spinner size="sm" /> Switching</> : chosen ? `Switch to ${chosen.code}` : 'Switch'}</button>
      </>}>
      <form id="switch-workspace" className="flex flex-col gap-3" onSubmit={submit}>
        <label className="relative">
          <span className="sr-only">Search workspaces</span>
          <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-700" />
          <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search workspaces by code or name"
            className="h-8 w-full rounded-control-md border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-700 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
        </label>
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          : list.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading the workspaces</p>
          : list.data && !list.data.ready ? <p className="text-sm text-ink-800">Switching workspace needs database patch 0077 on this installation.</p>
          : (
            <div className="max-h-80 overflow-auto rounded-md border border-line">
              <table className="w-full text-sm" aria-label="Workspaces">
                <thead className="sticky top-0 bg-surface-subtle text-left text-[11px] font-semibold tracking-wide text-ink-800 uppercase">
                  <tr><th className="px-3 py-2">Workspace</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2 text-right">Users</th><th className="px-3 py-2">Status</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-ink-800">No workspace matches.</td></tr>}
                  {rows.map((w) => (
                    <tr key={w.id} className={`border-t border-line-subtle ${chosen?.id === w.id ? 'bg-callout-bg' : 'hover:bg-surface-hover'}`}>
                      <td className="px-3 py-1.5">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="radio" name="workspace" checked={chosen?.id === w.id} onChange={() => { setChosen(w); setErrors({}) }} />
                          <span><span className="font-semibold text-ink-900">{w.code}</span> <span className="text-ink-800">· {w.name}</span></span>
                        </label>
                      </td>
                      <td className="px-3 py-1.5 text-ink-900">{w.plan ?? '—'}</td>
                      <td className="cep-num px-3 py-1.5 text-right text-ink-900">{formatNumber(w.users)}</td>
                      <td className="px-3 py-1.5"><StatusBadge status={w.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED'} label={w.status === 'ACTIVE' ? 'Active' : w.status.charAt(0) + w.status.slice(1).toLowerCase()} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {errors.workspace && <p role="alert" className="text-sm text-danger-text">{errors.workspace}</p>}
        <Field label="Reason" hint="A few words; the workspace’s administrators read it." error={errors.reason} required>
          {({ id, describedBy }) => <TextInput id={id} describedBy={describedBy} invalid={Boolean(errors.reason)} value={reason} maxLength={500}
            onChange={(event) => setReason(event.target.value)} placeholder="Checking the demo before the customer call" />}
        </Field>
      </form>
    </Modal>
  )
}
